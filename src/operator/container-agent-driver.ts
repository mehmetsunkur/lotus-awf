import { execFileSync, spawnSync } from "node:child_process";
import { createWriteStream, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { GenericContainer, Wait, type StartedNetwork, type StartedTestContainer } from "testcontainers";
import type { AgentDiagnostics } from "./diagnostics";
import type { AgentDriver, AgentMcpServer, AgentRun, AgentTask } from "./agent-driver";

const RUNNER_IMAGE = "lotus-agent-runner:local";
const CODEX_BEARER_ENV = "LOTUS_MCP_BEARER";
const DEFAULT_CLAUDE_BUDGET_USD = "2.00";
const DEFAULT_RUNNER_TIMEOUT_MS = 15 * 60 * 1000;
export const CLAUDE_CONTAINER_DISALLOWED_TOOLS = [
  "Bash",
  "Read",
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "Glob",
  "Grep",
  "LS",
  "WebFetch",
  "WebSearch",
  "Task",
  "TodoRead",
  "TodoWrite",
  "ExitPlanMode",
  "CronCreate",
  "CronDelete",
  "CronList",
  "DesignSync",
  "EnterWorktree",
  "ExitWorktree",
  "ReportFindings",
  "ScheduleWakeup",
  "SendMessage",
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskOutput",
  "TaskStop",
  "TaskUpdate",
  "Workflow"
];

let runnerImageBuild: Promise<void> | undefined;

type RunnerArtifacts = {
  stdout: string;
  stderr: string;
  finalText: string;
  rawResult?: unknown;
  exitCode: number | null;
};

export type IsolationPolicyResult = {
  ok: boolean;
  violations: string[];
};

type ContainerDriverOptions = {
  network: StartedNetwork;
};

async function ensureRunnerImage(): Promise<void> {
  runnerImageBuild ??= GenericContainer.fromDockerfile(process.cwd(), "Dockerfile.agent-runner")
    .withBuildkit()
    .withCache(true)
    .build(RUNNER_IMAGE, { deleteOnExit: false })
    .then(() => undefined);
  await runnerImageBuild;
}

function dockerAvailable(): boolean {
  try {
    return spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

function bearerFrom(task: AgentTask): string {
  return Object.values(task.mcpServers)[0]?.authorization.replace(/^Bearer\s+/i, "") ?? "";
}

function mcpServerNames(task: AgentTask): string[] {
  return Object.keys(task.mcpServers);
}

function codexConfigToml(model: string, baseUrl: string, mcpServers: Record<string, AgentMcpServer>): string {
  const lines = [
    `model = ${JSON.stringify(model)}`,
    `model_provider = "litellm"`,
    ``,
    `[model_providers.litellm]`,
    `name = "litellm"`,
    `base_url = ${JSON.stringify(baseUrl)}`,
    `env_key = "LOTUS_AGENT_CODEX_TOKEN"`,
    `wire_api = "responses"`
  ];
  for (const [serverName, server] of Object.entries(mcpServers)) {
    lines.push(``, `[mcp_servers.${serverName}]`, `url = ${JSON.stringify(server.url)}`, `bearer_token_env_var = "${CODEX_BEARER_ENV}"`);
  }
  return lines.join("\n") + "\n";
}

function claudeMcpConfig(mcpServers: Record<string, AgentMcpServer>): Record<string, unknown> {
  return {
    mcpServers: Object.fromEntries(
      Object.entries(mcpServers).map(([serverName, server]) => [
        serverName,
        { type: "http", url: server.url, headers: { Authorization: server.authorization } }
      ])
    )
  };
}

function writeCommonSpawn(
  diagnostics: AgentDiagnostics | undefined,
  payload: Record<string, unknown>
): void {
  diagnostics?.writeJson("spawn.json", "spawn", payload, { attach: "always" });
  diagnostics?.event({
    event: "agent_spawned",
    driver: payload.driver,
    runner: "container",
    model: payload.model,
    mcpServers: payload.mcpServers
  });
}

async function copyDiagnostics(container: StartedTestContainer, tmpRoot: string): Promise<string> {
  const archive = await container.copyArchiveFromContainer("/diag");
  const tarPath = join(tmpRoot, "diag.tar");
  await finished(archive.pipe(createWriteStream(tarPath)));
  execFileSync("tar", ["-xf", tarPath, "-C", tmpRoot]);
  return join(tmpRoot, "diag");
}

function readOptional(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function readJsonOptional(path: string): unknown {
  const text = readOptional(path).trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { parseError: text.slice(0, 2000) };
  }
}

export function checkAgentIsolationPolicy(text: string): IsolationPolicyResult {
  const checks: Array<[string, RegExp]> = [
    ["repo workspace path", /\/workspace\/sunkur-ai\/lotus-notes/],
    ["agent fixture path", /tests\/mcp\/agent/],
    ["direct CouchDB URL", /https?:\/\/(?:admin:[^@\s]+@)?(?:localhost|127\.0\.0\.1|local-couchdb|server-couchdb):598[45]\b/],
    ["direct Lotus app API route", /\/api\/apps\//],
    ["direct work-queue API route", /\/api\/work-queue/]
  ];
  const violations = checks.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
  return { ok: violations.length === 0, violations };
}

async function runOneShotContainer(options: {
  network: StartedNetwork;
  env: Record<string, string>;
  files: Array<{ content: string; target: string; mode?: number }>;
  command: string;
  timeoutMs?: number;
}): Promise<RunnerArtifacts> {
  await ensureRunnerImage();
  const tmpRoot = mkdtempSync(join(tmpdir(), "lotus-container-agent-"));
  const timeoutMs = options.timeoutMs ?? Number(process.env.LOTUS_AGENT_RUNNER_TIMEOUT_MS ?? DEFAULT_RUNNER_TIMEOUT_MS);
  let container: StartedTestContainer | undefined;
  try {
    container = await new GenericContainer(RUNNER_IMAGE)
      .withNetwork(options.network)
      .withEnvironment(options.env)
      .withCopyContentToContainer([
        ...options.files,
        { content: options.command, target: "/runner/run.sh", mode: 0o755 }
      ])
      .withCommand(["sh", "/runner/run.sh"])
      .withWorkingDir("/work")
      .withUser("node")
      .withWaitStrategy(Wait.forLogMessage("LOTUS_RUNNER_STARTED"))
      .withStartupTimeout(timeoutMs)
      .start();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await container.exec(["sh", "-lc", "test -f /diag/exit-code.txt"]);
      if (result.exitCode === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const completed = await container.exec(["sh", "-lc", "test -f /diag/exit-code.txt"]);
    if (completed.exitCode !== 0) {
      await container.exec([
        "sh",
        "-lc",
        "printf 124 >/diag/exit-code.txt; printf 'container agent did not finish before timeout\\n' >>/diag/stderr.log"
      ]);
    }
    const diagDir = await copyDiagnostics(container, tmpRoot);
    const exitCodeText = readOptional(join(diagDir, "exit-code.txt")).trim();
    return {
      stdout: readOptional(join(diagDir, "stdout.log")),
      stderr: readOptional(join(diagDir, "stderr.log")),
      finalText: readOptional(join(diagDir, "final_message.txt")).trim(),
      rawResult: readJsonOptional(join(diagDir, "raw_result.json")),
      exitCode: exitCodeText ? Number(exitCodeText) : null
    };
  } finally {
    if (container) await container.stop({ remove: true, removeVolumes: true });
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function finalizeSuccess(options: {
  diagnostics?: AgentDiagnostics;
  driver: string;
  model: string;
  baseUrl: string;
  startedAt: number;
  artifacts: RunnerArtifacts;
  ok: boolean;
  costUsd?: number;
  resultSubtype?: string;
}): AgentRun {
  const { diagnostics, artifacts } = options;
  const policy = checkAgentIsolationPolicy([artifacts.stdout, artifacts.stderr, artifacts.finalText].join("\n"));
  const ok = options.ok && policy.ok;
  diagnostics?.writeText("stdout.log", "stdout", artifacts.stdout, { attach: "failure" });
  diagnostics?.writeText("stderr.log", "stderr", artifacts.stderr, { attach: "failure" });
  diagnostics?.writeText("final_message.txt", "final_message", artifacts.finalText, { attach: "always" });
  diagnostics?.writeJson("raw_result.json", "raw_result", artifacts.rawResult ?? {});
  diagnostics?.writeJson("isolation-policy.json", "policy", policy, { attach: "always" });
  diagnostics?.event({ event: "agent_exited", driver: options.driver, runner: "container", code: artifacts.exitCode, durationMs: Date.now() - options.startedAt });
  diagnostics?.finalizeExit({
    schemaVersion: 1,
    runId: diagnostics.runId,
    driver: options.driver,
    runner: "container",
    ok,
    code: artifacts.exitCode,
    startedAt: new Date(options.startedAt).toISOString(),
    durationMs: Date.now() - options.startedAt,
    model: options.model,
    baseUrl: options.baseUrl,
    costUsd: options.costUsd,
    resultSubtype: options.resultSubtype,
    stdoutBytes: Buffer.byteLength(artifacts.stdout),
    stderrBytes: Buffer.byteLength(artifacts.stderr),
    finalMessageBytes: Buffer.byteLength(artifacts.finalText)
  });
  return {
    ok,
    finalText: policy.ok ? artifacts.finalText : `Isolation policy violation: ${policy.violations.join(", ")}`,
    costUsd: options.costUsd,
    raw: artifacts.rawResult ?? {},
    diagnostics: diagnostics ? { runId: diagnostics.runId, rootDir: diagnostics.rootDir } : undefined
  };
}

export class ContainerCodexDriver implements AgentDriver {
  readonly name = "codex";

  constructor(private readonly options: ContainerDriverOptions) {}

  private model(): string | undefined {
    return process.env.LOTUS_AGENT_CODEX_MODEL?.trim() || undefined;
  }

  private baseUrl(): string | undefined {
    return process.env.LOTUS_AGENT_CODEX_BASE_URL?.trim() || undefined;
  }

  private hasCredentials(): boolean {
    return Boolean(process.env.LOTUS_AGENT_CODEX_TOKEN && this.baseUrl());
  }

  isAvailable(): boolean {
    return dockerAvailable() && Boolean(this.model()) && this.hasCredentials();
  }

  unavailableReason(): string {
    if (!dockerAvailable()) return "Docker is unavailable for containerized Codex";
    if (!this.model()) return "LOTUS_AGENT_CODEX_MODEL is not set";
    if (!this.hasCredentials()) return "no Codex credentials: set LOTUS_AGENT_CODEX_TOKEN + LOTUS_AGENT_CODEX_BASE_URL";
    return "";
  }

  async run(task: AgentTask): Promise<AgentRun> {
    const model = this.model();
    const baseUrl = this.baseUrl();
    if (!model || !baseUrl) throw new Error("LOTUS_AGENT_CODEX_MODEL and LOTUS_AGENT_CODEX_BASE_URL are required to run the agent");
    const diagnostics = task.diagnostics;
    const startedAt = Date.now();
    const config = codexConfigToml(model, baseUrl, task.mcpServers);
    diagnostics?.writeText("prompt.txt", "prompt", task.prompt, { attach: "always" });
    diagnostics?.writeText("codex-config.toml", "config", config, { attach: "failure", contentType: "application/toml" });
    writeCommonSpawn(diagnostics, {
      schemaVersion: 1,
      runId: diagnostics?.runId,
      driver: this.name,
      runner: "container",
      binary: "codex",
      image: RUNNER_IMAGE,
      model,
      baseUrl,
      mcpServers: mcpServerNames(task),
      workDir: "/work",
      codexHome: "/home/node/.codex"
    });

    try {
      const artifacts = await runOneShotContainer({
        network: this.options.network,
        env: {
          HOME: "/home/node",
          CODEX_HOME: "/home/node/.codex",
          CODEX_CI: "1",
          CI: "1",
          NO_COLOR: "1",
          LOTUS_AGENT_CODEX_TOKEN: process.env.LOTUS_AGENT_CODEX_TOKEN ?? "",
          [CODEX_BEARER_ENV]: bearerFrom(task)
        },
        files: [
          { content: task.prompt, target: "/runner/prompt.txt" },
          { content: config, target: "/runner/codex-config.toml" }
        ],
        command: `#!/bin/sh
set +e
mkdir -p /diag /home/node/.codex /work
cp /runner/codex-config.toml /home/node/.codex/config.toml
echo LOTUS_RUNNER_STARTED
codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --ephemeral -C /work -o /diag/final_message.txt "$(cat /runner/prompt.txt)" </dev/null >/diag/stdout.log 2>/diag/stderr.log
code=$?
printf '%s' "$code" >/diag/exit-code.txt
tail -c 2000 /diag/stdout.log 2>/dev/null | sed 's/^/[stdout] /' >/diag/raw-tail.txt
tail -c 2000 /diag/stderr.log 2>/dev/null | sed 's/^/[stderr] /' >>/diag/raw-tail.txt
printf '{"code":%s,"stdoutTail":%s,"stderrTail":%s}\\n' "$code" "$(node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync("/diag/stdout.log","utf8").slice(-2000)))')" "$(node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync("/diag/stderr.log","utf8").slice(-2000)))')" >/diag/raw_result.json
echo LOTUS_RUNNER_DONE
sleep 30
exit "$code"
`
      });
      const ok = artifacts.exitCode === 0 && artifacts.finalText.length > 0;
      return finalizeSuccess({ diagnostics, driver: this.name, model, baseUrl, startedAt, artifacts, ok });
    } catch (error) {
      diagnostics?.event({ event: "agent_spawn_failed", driver: this.name, runner: "container", error: error instanceof Error ? error.message : String(error) });
      diagnostics?.finalizeExit({
        schemaVersion: 1,
        runId: diagnostics.runId,
        driver: this.name,
        runner: "container",
        ok: false,
        startedAt: new Date(startedAt).toISOString(),
        durationMs: Date.now() - startedAt,
        model,
        baseUrl,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}

export class ContainerClaudeCodeDriver implements AgentDriver {
  readonly name = "claude-code";

  constructor(private readonly options: ContainerDriverOptions) {}

  private model(): string | undefined {
    return process.env.LOTUS_AGENT_CLAUDE_MODEL?.trim() || undefined;
  }

  private baseUrl(): string | undefined {
    return process.env.LOTUS_AGENT_CLAUDE_BASE_URL?.trim() || process.env.ANTHROPIC_BASE_URL?.trim() || undefined;
  }

  private token(): string | undefined {
    return process.env.LOTUS_AGENT_CLAUDE_TOKEN?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim() || undefined;
  }

  private apiKey(): string | undefined {
    return process.env.ANTHROPIC_API_KEY?.trim() || undefined;
  }

  private hasCredentials(): boolean {
    return Boolean(this.token() && this.baseUrl()) || Boolean(this.apiKey());
  }

  isAvailable(): boolean {
    return dockerAvailable() && Boolean(this.model()) && this.hasCredentials();
  }

  unavailableReason(): string {
    if (!dockerAvailable()) return "Docker is unavailable for containerized Claude Code";
    if (!this.model()) return "LOTUS_AGENT_CLAUDE_MODEL is not set";
    if (!this.hasCredentials()) return "no Claude credentials: set LOTUS_AGENT_CLAUDE_TOKEN + LOTUS_AGENT_CLAUDE_BASE_URL, or ANTHROPIC_API_KEY";
    return "";
  }

  async run(task: AgentTask): Promise<AgentRun> {
    const model = this.model();
    if (!model) throw new Error("LOTUS_AGENT_CLAUDE_MODEL is required to run the agent");
    const baseUrl = this.baseUrl() ?? "";
    const diagnostics = task.diagnostics;
    const startedAt = Date.now();
    const mcpConfig = claudeMcpConfig(task.mcpServers);
    const allowedTools = mcpServerNames(task).map((serverName) => `mcp__${serverName}__*`).join(",");
    const disallowedTools = CLAUDE_CONTAINER_DISALLOWED_TOOLS.join(",");
    const budget = process.env.LOTUS_AGENT_CLAUDE_BUDGET_USD?.trim() || DEFAULT_CLAUDE_BUDGET_USD;
    diagnostics?.writeText("prompt.txt", "prompt", task.prompt, { attach: "always" });
    diagnostics?.writeJson("mcp-config.json", "config", mcpConfig, { attach: "failure" });
    writeCommonSpawn(diagnostics, {
      schemaVersion: 1,
      runId: diagnostics?.runId,
      driver: this.name,
      runner: "container",
      binary: "claude",
      image: RUNNER_IMAGE,
      model,
      baseUrl,
      mcpServers: mcpServerNames(task),
      allowedTools,
      disallowedTools,
      budgetUsd: budget,
      workDir: "/work"
    });

    try {
      const env: Record<string, string> = {
        HOME: "/home/node",
        ANTHROPIC_BASE_URL: baseUrl,
        ANTHROPIC_AUTH_TOKEN: this.token() ?? "",
        ANTHROPIC_API_KEY: this.apiKey() ?? "",
        DISABLE_TELEMETRY: "1"
      };
      const artifacts = await runOneShotContainer({
        network: this.options.network,
        env,
        files: [
          { content: task.prompt, target: "/runner/prompt.txt" },
          { content: JSON.stringify(mcpConfig, null, 2), target: "/runner/mcp-config.json" }
        ],
        command: `#!/bin/sh
set +e
mkdir -p /diag /work
echo LOTUS_RUNNER_STARTED
claude -p "$(cat /runner/prompt.txt)" --disable-slash-commands --mcp-config /runner/mcp-config.json --strict-mcp-config --output-format stream-json --verbose --dangerously-skip-permissions --allowedTools "${allowedTools}" --disallowedTools "${disallowedTools}" --model "${model}" --max-budget-usd "${budget}" >/diag/stdout.log 2>/diag/stderr.log
code=$?
printf '%s' "$code" >/diag/exit-code.txt
node - <<'NODE' >/diag/raw_result.json
const fs = require("fs");
const lines = fs.readFileSync("/diag/stdout.log", "utf8").split("\\n").filter((line) => line.trim().startsWith("{"));
const parsed = [];
for (const line of lines) {
  try { parsed.push(JSON.parse(line)); } catch {}
}
const raw = [...parsed].reverse().find((entry) => entry.type === "result") ?? { is_error: true, subtype: "parse_error", result: "Claude stream output contained no result line" };
fs.writeFileSync("/diag/final_message.txt", typeof raw.result === "string" ? raw.result : "");
process.stdout.write(JSON.stringify(raw, null, 2));
NODE
echo LOTUS_RUNNER_DONE
sleep 30
exit "$code"
`
      });
      const raw = artifacts.rawResult as { is_error?: boolean; subtype?: string; total_cost_usd?: number } | undefined;
      const ok = artifacts.exitCode === 0 && raw?.is_error === false && raw.subtype === "success";
      return finalizeSuccess({
        diagnostics,
        driver: this.name,
        model,
        baseUrl,
        startedAt,
        artifacts,
        ok,
        costUsd: raw?.total_cost_usd,
        resultSubtype: raw?.subtype
      });
    } catch (error) {
      diagnostics?.event({ event: "agent_spawn_failed", driver: this.name, runner: "container", error: error instanceof Error ? error.message : String(error) });
      diagnostics?.finalizeExit({
        schemaVersion: 1,
        runId: diagnostics.runId,
        driver: this.name,
        runner: "container",
        ok: false,
        startedAt: new Date(startedAt).toISOString(),
        durationMs: Date.now() - startedAt,
        model,
        baseUrl,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}
