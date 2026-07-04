import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentDiagnostics } from "./diagnostics";

/**
 * Driver seam for the real-agent acceptance suite. A driver hands a natural-language
 * task plus a set of MCP servers to an autonomous coding agent and returns what the
 * agent produced. Two drivers implement it — ClaudeCodeDriver and CodexDriver — and the
 * spec runs both over the same scenarios via a driver matrix.
 */

export type AgentMcpServer = {
  /** Surface URL, e.g. http://localhost:<port>/mcp/designer. */
  url: string;
  /** Authorization header value the agent replays, e.g. `Bearer <lotus_session>`. */
  authorization: string;
};

export type AgentTask = {
  /** Natural-language instruction. The agent must discover and compose tools itself. */
  prompt: string;
  /** MCP servers exposed to the agent, keyed by server name (becomes the mcp__<name>__ tool prefix). */
  mcpServers: Record<string, AgentMcpServer>;
  /** Redacted report artifact writer for this agent turn. */
  diagnostics?: AgentDiagnostics;
};

export type AgentRun = {
  /** True when the agent completed the turn without erroring. */
  ok: boolean;
  /** The agent's final assistant text. */
  finalText: string;
  /** Reported spend for the run, when the model/proxy returns it. */
  costUsd?: number;
  /** Full parsed result envelope, for diagnostics/sanity checks (e.g. which model ran). */
  raw: unknown;
  /** Report artifact directory and id for this turn, when diagnostics were enabled. */
  diagnostics?: { runId: string; rootDir: string };
};

export interface AgentDriver {
  readonly name: string;
  /** Whether this driver can run here (binary present + credentials + model configured). */
  isAvailable(): boolean;
  /** Why the driver is unavailable, for a readable test.skip reason. */
  unavailableReason(): string;
  run(task: AgentTask): Promise<AgentRun>;
}

/** Per-run cost ceiling passed to `claude --max-budget-usd`; override with LOTUS_AGENT_CLAUDE_BUDGET_USD. */
const DEFAULT_BUDGET_USD = "2.00";

/**
 * Drives the `claude` CLI headlessly against the MCP HTTP host.
 *
 * Config is suite-namespaced under LOTUS_AGENT_CLAUDE_* and mapped to the provider-native
 * ANTHROPIC_* names the `claude` CLI actually reads. Each LOTUS_AGENT_CLAUDE_* var falls
 * back to its ANTHROPIC_* counterpart, so inside a Claude Code session (where ANTHROPIC_*
 * are pre-injected) the suite still runs with zero extra config. The child env is scrubbed
 * of the parent's nested-session orchestration vars so the spawned agent launches clean.
 */
export class ClaudeCodeDriver implements AgentDriver {
  readonly name = "claude-code";

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

  /**
   * Credentials are usable with either a direct ANTHROPIC_API_KEY, or a proxy token paired
   * with its endpoint. A token without a base URL would send a Bearer to api.anthropic.com
   * and fail, so we treat that as unavailable (skip) rather than letting it run and error.
   */
  private hasCredentials(): boolean {
    return Boolean(this.token() && this.baseUrl()) || Boolean(this.apiKey());
  }

  private binaryPresent(): boolean {
    try {
      return spawnSync("claude", ["--version"], { stdio: "ignore" }).status === 0;
    } catch {
      return false;
    }
  }

  isAvailable(): boolean {
    return this.binaryPresent() && Boolean(this.model()) && this.hasCredentials();
  }

  unavailableReason(): string {
    if (!this.binaryPresent()) return "claude CLI not found on PATH";
    if (!this.model()) return "LOTUS_AGENT_CLAUDE_MODEL is not set";
    if (!this.hasCredentials()) {
      if (this.token() && !this.baseUrl()) {
        return "a Claude token is set but no base URL (LOTUS_AGENT_CLAUDE_BASE_URL / ANTHROPIC_BASE_URL)";
      }
      return "no Claude credentials: set LOTUS_AGENT_CLAUDE_TOKEN + LOTUS_AGENT_CLAUDE_BASE_URL, or ANTHROPIC_API_KEY";
    }
    return "";
  }

  /**
   * Child env = parent env minus Claude Code's nested-session orchestration vars, with the
   * resolved LOTUS_AGENT_CLAUDE_* values mapped onto the ANTHROPIC_* names the CLI reads.
   */
  private childEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key === "CLAUDECODE" || key.startsWith("CLAUDE_CODE_")) delete env[key];
    }
    const baseUrl = this.baseUrl();
    const token = this.token();
    if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl;
    if (token) env.ANTHROPIC_AUTH_TOKEN = token;
    return env;
  }

  async run(task: AgentTask): Promise<AgentRun> {
    const model = this.model();
    if (!model) throw new Error("LOTUS_AGENT_CLAUDE_MODEL is required to run the agent");
    const startedAt = Date.now();
    const diagnostics = task.diagnostics;

    const dir = mkdtempSync(join(tmpdir(), "lotus-agent-mcp-"));
    const configPath = join(dir, "mcp-config.json");
    const mcpServers = Object.fromEntries(
      Object.entries(task.mcpServers).map(([serverName, server]) => [
        serverName,
        { type: "http", url: server.url, headers: { Authorization: server.authorization } }
      ])
    );
    writeFileSync(configPath, JSON.stringify({ mcpServers }, null, 2));
    diagnostics?.writeText("prompt.txt", "prompt", task.prompt, { attach: "always" });
    diagnostics?.writeJson("mcp-config.json", "config", { mcpServers }, { attach: "failure" });

    // Allow exactly the tools from the servers we passed (mcp__<serverName>__*), nothing else.
    const allowedTools = Object.keys(task.mcpServers)
      .map((serverName) => `mcp__${serverName}__*`)
      .join(",");
    const budget = process.env.LOTUS_AGENT_CLAUDE_BUDGET_USD?.trim() || DEFAULT_BUDGET_USD;

    const args = [
      "-p",
      task.prompt,
      "--mcp-config",
      configPath,
      "--strict-mcp-config",
      // stream-json (NDJSON, requires --verbose in -p mode) instead of json: the stream
      // carries every assistant turn including tool_use blocks, so the diagnostics can
      // keep a tool-by-tool transcript. The final `result` line is the same envelope the
      // plain json format used to print, so downstream parsing is unchanged in shape.
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--allowedTools",
      allowedTools,
      "--model",
      model,
      "--max-budget-usd",
      budget
    ];
    diagnostics?.writeJson(
      "spawn.json",
      "spawn",
      {
        schemaVersion: 1,
        runId: diagnostics.runId,
        driver: this.name,
        binary: "claude",
        args: args.map((arg) => (arg === task.prompt ? "[prompt omitted; see prompt.txt]" : arg)),
        model,
        baseUrl: this.baseUrl() ?? "",
        mcpServers: Object.keys(task.mcpServers),
        allowedTools,
        budgetUsd: budget
      },
      { attach: "always" }
    );
    diagnostics?.event({ event: "agent_spawned", driver: this.name, model, mcpServers: Object.keys(task.mcpServers) });

    try {
      const { code, stdout, stderr } = await this.spawnClaude(args);
      diagnostics?.writeText("stdout.log", "stdout", stdout, { attach: "failure" });
      diagnostics?.writeText("stderr.log", "stderr", stderr, { attach: "failure" });
      diagnostics?.event({ event: "agent_exited", driver: this.name, code, durationMs: Date.now() - startedAt });
      let raw: {
        is_error?: boolean;
        subtype?: string;
        result?: string;
        total_cost_usd?: number;
      };
      // stream-json stdout is NDJSON. The last `type: "result"` line is the same envelope
      // the plain json format printed; the assistant lines before it carry the tool_use
      // blocks we distill into a compact, always-attached transcript.
      const streamLines: Array<Record<string, unknown>> = [];
      for (const line of stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        try {
          streamLines.push(JSON.parse(trimmed) as Record<string, unknown>);
        } catch {
          // Non-JSON noise on stdout (e.g. a stray warning) — the raw line stays in stdout.log.
        }
      }
      const resultLine = [...streamLines].reverse().find((entry) => entry.type === "result");
      if (resultLine) {
        raw = resultLine as typeof raw;
      } else {
        raw = {
          is_error: true,
          subtype: "parse_error",
          result: `Claude stream output contained no result line (${streamLines.length} JSON lines parsed)`
        };
      }
      const toolTranscript = streamLines
        .filter((entry) => entry.type === "assistant")
        .flatMap((entry) => {
          const content = (entry as { message?: { content?: Array<Record<string, unknown>> } }).message?.content ?? [];
          return content
            .filter((block) => block.type === "tool_use")
            .map((block) => ({
              tool: String(block.name ?? ""),
              // Inputs are capped so one bulky payload can't bloat the report; the full
              // stream stays in stdout.log for verbose diagnostics.
              input: JSON.stringify(block.input ?? {}).slice(0, 2000)
            }));
        });
      diagnostics?.writeText(
        "tool-transcript.jsonl",
        "tool_transcript",
        toolTranscript.map((call) => JSON.stringify(call)).join("\n"),
        { attach: "always" }
      );
      const ok = code === 0 && raw.is_error === false && raw.subtype === "success";
      const finalText = typeof raw.result === "string" ? raw.result : "";
      diagnostics?.writeText("final_message.txt", "final_message", finalText, { attach: "always" });
      diagnostics?.writeJson("raw_result.json", "raw_result", raw);
      diagnostics?.finalizeExit({
        schemaVersion: 1,
        runId: diagnostics.runId,
        driver: this.name,
        ok,
        code,
        startedAt: new Date(startedAt).toISOString(),
        durationMs: Date.now() - startedAt,
        model,
        baseUrl: this.baseUrl() ?? "",
        costUsd: raw.total_cost_usd,
        resultSubtype: raw.subtype,
        stderrBytes: Buffer.byteLength(stderr),
        stdoutBytes: Buffer.byteLength(stdout)
      });
      return {
        ok,
        finalText: typeof raw.result === "string" ? raw.result : "",
        costUsd: raw.total_cost_usd,
        raw,
        diagnostics: diagnostics ? { runId: diagnostics.runId, rootDir: diagnostics.rootDir } : undefined
      };
    } catch (error) {
      diagnostics?.event({ event: "agent_spawn_failed", driver: this.name, error: error instanceof Error ? error.message : String(error) });
      diagnostics?.finalizeExit({
        schemaVersion: 1,
        runId: diagnostics.runId,
        driver: this.name,
        ok: false,
        startedAt: new Date(startedAt).toISOString(),
        durationMs: Date.now() - startedAt,
        model,
        baseUrl: this.baseUrl() ?? "",
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private spawnClaude(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn("claude", args, { env: this.childEnv(), stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", reject);
      child.on("close", (code) => {
        resolve({ code, stdout, stderr });
      });
    });
  }
}

/** Env var the generated Codex config reads the MCP Bearer token from at exec time. */
const CODEX_BEARER_ENV = "LOTUS_MCP_BEARER";

/**
 * Drives the `codex` CLI headlessly against the same MCP HTTP host as Claude.
 *
 * Differences from Claude that shaped this driver:
 * - Codex HTTP MCP authenticates with a Bearer token read from an env var
 *   (`--bearer-token-env-var` / `bearer_token_env_var`), not arbitrary headers — so the
 *   agent's `Authorization: Bearer <token>` is unpacked into CODEX_BEARER_ENV.
 * - Model auth is a custom (LiteLLM) provider written into an isolated CODEX_HOME so the
 *   user's global ~/.codex config is never touched. `wire_api = "responses"` (Codex
 *   0.142+ dropped "chat").
 * - `codex exec` reads stdin until EOF; without a closed stdin it hangs, so stdin is
 *   /dev/null (stdio "ignore").
 * - There is no per-run cost flag; the Playwright timeout + small task scope are the cap.
 */
export class CodexDriver implements AgentDriver {
  readonly name = "codex";

  private model(): string | undefined {
    return process.env.LOTUS_AGENT_CODEX_MODEL?.trim() || undefined;
  }

  private baseUrl(): string | undefined {
    return process.env.LOTUS_AGENT_CODEX_BASE_URL?.trim() || undefined;
  }

  private hasCredentials(): boolean {
    return Boolean(process.env.LOTUS_AGENT_CODEX_TOKEN && this.baseUrl());
  }

  private binaryPresent(): boolean {
    try {
      return spawnSync("codex", ["--version"], { stdio: "ignore" }).status === 0;
    } catch {
      return false;
    }
  }

  isAvailable(): boolean {
    return this.binaryPresent() && Boolean(this.model()) && this.hasCredentials();
  }

  unavailableReason(): string {
    if (!this.binaryPresent()) return "codex CLI not found on PATH";
    if (!this.model()) return "LOTUS_AGENT_CODEX_MODEL is not set";
    if (!this.hasCredentials()) return "no Codex credentials: set LOTUS_AGENT_CODEX_TOKEN + LOTUS_AGENT_CODEX_BASE_URL";
    return "";
  }

  /** TOML for an isolated CODEX_HOME: LiteLLM provider + one entry per MCP surface. */
  private configToml(model: string, baseUrl: string, mcpServers: Record<string, AgentMcpServer>): string {
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

  async run(task: AgentTask): Promise<AgentRun> {
    const model = this.model();
    const baseUrl = this.baseUrl();
    if (!model || !baseUrl) throw new Error("LOTUS_AGENT_CODEX_MODEL and LOTUS_AGENT_CODEX_BASE_URL are required to run the agent");
    const startedAt = Date.now();
    const diagnostics = task.diagnostics;

    // All surfaces share one minted token; unpack it from the Bearer authorization header.
    const bearer = Object.values(task.mcpServers)[0]?.authorization.replace(/^Bearer\s+/i, "") ?? "";

    const dir = mkdtempSync(join(tmpdir(), "lotus-codex-"));
    const codexHome = join(dir, "home");
    const workDir = join(dir, "work");
    mkdirSync(codexHome);
    mkdirSync(workDir);
    writeFileSync(join(codexHome, "config.toml"), this.configToml(model, baseUrl, task.mcpServers));
    const lastMessagePath = join(dir, "last.txt");
    diagnostics?.writeText("prompt.txt", "prompt", task.prompt, { attach: "always" });
    diagnostics?.writeText("codex-config.toml", "config", this.configToml(model, baseUrl, task.mcpServers), {
      attach: "failure",
      contentType: "application/toml"
    });

    const args = [
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "--ephemeral",
      "-C",
      workDir,
      "-o",
      lastMessagePath,
      task.prompt
    ];
    diagnostics?.writeJson(
      "spawn.json",
      "spawn",
      {
        schemaVersion: 1,
        runId: diagnostics.runId,
        driver: this.name,
        binary: "codex",
        args: args.map((arg) => (arg === task.prompt ? "[prompt omitted; see prompt.txt]" : arg)),
        model,
        baseUrl,
        mcpServers: Object.keys(task.mcpServers),
        codexHome,
        workDir
      },
      { attach: "always" }
    );
    diagnostics?.event({ event: "agent_spawned", driver: this.name, model, mcpServers: Object.keys(task.mcpServers) });

    try {
      const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: codexHome, [CODEX_BEARER_ENV]: bearer };
      const { code, stdout, stderr } = await this.spawnCodex(args, env);
      diagnostics?.writeText("stdout.log", "stdout", stdout, { attach: "failure" });
      diagnostics?.writeText("stderr.log", "stderr", stderr, { attach: "failure" });
      diagnostics?.event({ event: "agent_exited", driver: this.name, code, durationMs: Date.now() - startedAt });
      let finalText = "";
      try {
        finalText = readFileSync(lastMessagePath, "utf8").trim();
      } catch {
        // No last-message file written — treated as a failed run below.
      }
      const ok = code === 0 && finalText.length > 0;
      const raw = { code, stdoutTail: stdout.slice(-2000), stderrTail: stderr.slice(-2000) };
      diagnostics?.writeText("final_message.txt", "final_message", finalText, { attach: "always" });
      diagnostics?.writeJson("raw_result.json", "raw_result", raw);
      diagnostics?.finalizeExit({
        schemaVersion: 1,
        runId: diagnostics.runId,
        driver: this.name,
        ok,
        code,
        startedAt: new Date(startedAt).toISOString(),
        durationMs: Date.now() - startedAt,
        model,
        baseUrl,
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: Buffer.byteLength(stderr),
        finalMessageBytes: Buffer.byteLength(finalText)
      });
      return {
        ok,
        finalText,
        raw,
        diagnostics: diagnostics ? { runId: diagnostics.runId, rootDir: diagnostics.rootDir } : undefined
      };
    } catch (error) {
      diagnostics?.event({ event: "agent_spawn_failed", driver: this.name, error: error instanceof Error ? error.message : String(error) });
      diagnostics?.finalizeExit({
        schemaVersion: 1,
        runId: diagnostics.runId,
        driver: this.name,
        ok: false,
        startedAt: new Date(startedAt).toISOString(),
        durationMs: Date.now() - startedAt,
        model,
        baseUrl,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // stdio "ignore" on stdin gives codex exec immediate EOF; otherwise it blocks on stdin.
  private spawnCodex(
    args: string[],
    env: NodeJS.ProcessEnv
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn("codex", args, { env, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
  }
}
