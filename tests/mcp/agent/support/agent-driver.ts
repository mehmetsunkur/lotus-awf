import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Driver seam for the real-agent acceptance suite. A driver hands a natural-language
 * task plus a set of MCP servers to an autonomous coding agent and returns what the
 * agent produced. Only ClaudeCodeDriver exists today; a CodexDriver can implement the
 * same interface later (plan: out-of-scope follow-up).
 */

export type AgentMcpServer = {
  /** Surface URL, e.g. http://localhost:<port>/mcp/designer. */
  url: string;
  /** Authorization header value the agent replays (Basic alice:...). */
  authorization: string;
};

export type AgentTask = {
  /** Natural-language instruction. The agent must discover and compose tools itself. */
  prompt: string;
  /** MCP servers exposed to the agent, keyed by server name (becomes the mcp__<name>__ tool prefix). */
  mcpServers: Record<string, AgentMcpServer>;
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
};

export interface AgentDriver {
  readonly name: string;
  /** Whether this driver can run here (binary present + credentials + model configured). */
  isAvailable(): boolean;
  /** Why the driver is unavailable, for a readable test.skip reason. */
  unavailableReason(): string;
  run(task: AgentTask): Promise<AgentRun>;
}

/** Per-run cost ceiling passed to `claude --max-budget-usd`; override with LOTUS_AGENT_BUDGET_USD. */
const DEFAULT_BUDGET_USD = "2.00";

/**
 * Drives the `claude` CLI headlessly against the MCP HTTP host.
 *
 * Auth: nothing is stored in-repo. The CLI is already configured via the environment
 * (ANTHROPIC_BASE_URL -> LiteLLM proxy, ANTHROPIC_AUTH_TOKEN), which the child inherits.
 * Because this suite itself runs inside Claude Code, the child env is scrubbed of the
 * parent's nested-session orchestration vars so the spawned agent launches clean.
 */
export class ClaudeCodeDriver implements AgentDriver {
  readonly name = "claude-code";

  private model(): string | undefined {
    return process.env.LOTUS_AGENT_MODEL?.trim() || undefined;
  }

  private hasCredentials(): boolean {
    return Boolean(process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY);
  }

  private binaryPresent(): boolean {
    try {
      return spawnSync("claude", ["--version"], { stdio: "ignore" }).status === 0;
    } catch {
      return false;
    }
  }

  isAvailable(): boolean {
    return this.binaryPresent() && this.hasCredentials() && Boolean(this.model());
  }

  unavailableReason(): string {
    if (!this.binaryPresent()) return "claude CLI not found on PATH";
    if (!this.hasCredentials()) return "no ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY in env";
    if (!this.model()) return "LOTUS_AGENT_MODEL is not set";
    return "";
  }

  /**
   * Child env = parent env minus the nested-session orchestration vars Claude Code sets,
   * keeping ANTHROPIC_* so the proxy + token carry through.
   */
  private childEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key === "CLAUDECODE" || key.startsWith("CLAUDE_CODE_")) delete env[key];
    }
    return env;
  }

  async run(task: AgentTask): Promise<AgentRun> {
    const model = this.model();
    if (!model) throw new Error("LOTUS_AGENT_MODEL is required to run the agent");

    const dir = mkdtempSync(join(tmpdir(), "lotus-agent-mcp-"));
    const configPath = join(dir, "mcp-config.json");
    const mcpServers = Object.fromEntries(
      Object.entries(task.mcpServers).map(([serverName, server]) => [
        serverName,
        { type: "http", url: server.url, headers: { Authorization: server.authorization } }
      ])
    );
    writeFileSync(configPath, JSON.stringify({ mcpServers }, null, 2));

    // Allow exactly the tools from the servers we passed (mcp__<serverName>__*), nothing else.
    const allowedTools = Object.keys(task.mcpServers)
      .map((serverName) => `mcp__${serverName}__*`)
      .join(",");
    const budget = process.env.LOTUS_AGENT_BUDGET_USD?.trim() || DEFAULT_BUDGET_USD;

    const args = [
      "-p",
      task.prompt,
      "--mcp-config",
      configPath,
      "--strict-mcp-config",
      "--output-format",
      "json",
      "--dangerously-skip-permissions",
      "--allowedTools",
      allowedTools,
      "--model",
      model,
      "--max-budget-usd",
      budget
    ];

    try {
      const { stdout } = await this.spawnClaude(args);
      const raw = JSON.parse(stdout) as {
        is_error?: boolean;
        subtype?: string;
        result?: string;
        total_cost_usd?: number;
      };
      return {
        ok: raw.is_error === false && raw.subtype === "success",
        finalText: typeof raw.result === "string" ? raw.result : "",
        costUsd: raw.total_cost_usd,
        raw
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private spawnClaude(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn("claude", args, { env: this.childEnv(), stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(`claude exited ${code}: ${stderr || stdout}`));
      });
    });
  }
}
