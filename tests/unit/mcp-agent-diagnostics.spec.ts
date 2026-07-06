import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentDiagnosticsRedactor, createAgentDiagnostics } from "../../src/operator/diagnostics";

const tmpRoots: string[] = [];

function tmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "lotus-agent-diagnostics-test-"));
  tmpRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("MCP agent diagnostics", () => {
  it("redacts injected secrets and common token shapes", () => {
    const redactor = AgentDiagnosticsRedactor.fromEnv(
      {
        LOTUS_AGENT_CODEX_TOKEN: "codex-token-secret",
        ANTHROPIC_AUTH_TOKEN: "anthropic-token-secret",
        REMOTE_AGENT_SECRET_EXTRA: "caller-extra-secret"
      },
      ["minted-lotus-session-token"]
    );

    const text = redactor.redact(
      [
        "codex-token-secret",
        "anthropic-token-secret",
        "caller-extra-secret",
        "Authorization: Bearer minted-lotus-session-token",
        "lotus_session=minted-lotus-session-token",
        "sk-test-secret-value"
      ].join("\n")
    );

    expect(text).not.toContain("codex-token-secret");
    expect(text).not.toContain("anthropic-token-secret");
    expect(text).not.toContain("caller-extra-secret");
    expect(text).not.toContain("minted-lotus-session-token");
    expect(text).not.toContain("sk-test-secret-value");
    expect(text).toContain("[REDACTED]");
  });

  it("writes redacted artifacts and a manifest for durable report attachments", async () => {
    const diagnostics = createAgentDiagnostics({
      rootDir: tmpRoot(),
      driverName: "codex",
      testTitle: "agent builds things",
      extraSecrets: ["super-secret-bearer"]
    });

    diagnostics.writeText("stdout.log", "stdout", "hello super-secret-bearer", { attach: "failure" });
    diagnostics.writeJson("raw_result.json", "raw_result", { token: "super-secret-bearer" });
    diagnostics.finalizeExit({ ok: true, authorization: "Bearer super-secret-bearer" });
    diagnostics.writeJson("template-after-expense.json", "template_after", { token: "super-secret-bearer" }, { attach: "always" });
    await diagnostics.attachTo({ attach: async () => {} } as never, true);

    const stdout = readFileSync(join(diagnostics.rootDir, "stdout.log"), "utf8");
    const raw = readFileSync(join(diagnostics.rootDir, "raw_result.json"), "utf8");
    const exit = readFileSync(join(diagnostics.rootDir, "exit.json"), "utf8");
    const template = readFileSync(join(diagnostics.rootDir, "template-after-expense.json"), "utf8");
    const manifest = JSON.parse(readFileSync(join(diagnostics.rootDir, "manifest.json"), "utf8")) as Array<{
      role: string;
      relativePath: string;
      sha256: string;
    }>;

    expect(stdout).not.toContain("super-secret-bearer");
    expect(raw).not.toContain("super-secret-bearer");
    expect(exit).not.toContain("super-secret-bearer");
    expect(template).not.toContain("super-secret-bearer");
    expect(manifest.map((entry) => entry.relativePath)).toEqual(
      expect.arrayContaining([
        "events.jsonl",
        "spawn.json",
        "stdout.log",
        "raw_result.json",
        "exit.json",
        "template-after-expense.json"
      ])
    );
    expect(manifest.every((entry) => entry.sha256.length === 64)).toBe(true);
  });

  it("attaches full logs only on failure unless full diagnostics are enabled", async () => {
    const diagnostics = createAgentDiagnostics({
      rootDir: tmpRoot(),
      driverName: "claude-code",
      testTitle: "agent updates workflow",
      mode: "standard"
    });
    diagnostics.writeText("stdout.log", "stdout", "verbose output", { attach: "failure" });
    diagnostics.writeText("final_message.txt", "final_message", "done", { attach: "always" });
    diagnostics.finalizeExit({ ok: true });

    const attached: string[] = [];
    await diagnostics.attachTo(
      {
        attach: async (name: string) => {
          attached.push(name);
        }
      } as never,
      true
    );

    expect(attached.some((name) => name.endsWith("stdout.log"))).toBe(false);
    expect(attached.some((name) => name.endsWith("final_message.txt"))).toBe(true);
    expect(attached.some((name) => name.endsWith("manifest.json"))).toBe(true);
  });
});
