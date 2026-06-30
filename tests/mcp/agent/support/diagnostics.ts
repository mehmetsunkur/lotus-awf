import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { TestInfo } from "@playwright/test";

type DiagnosticRole =
  | "events"
  | "exit"
  | "final_message"
  | "manifest"
  | "prompt"
  | "raw_result"
  | "spawn"
  | "stderr"
  | "stdout"
  | "config";

type AttachPolicy = "always" | "failure" | "full";

export type DiagnosticManifestEntry = {
  role: DiagnosticRole;
  relativePath: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  redaction: "exact_string_and_patterns_v1";
  attach: AttachPolicy;
};

type ArtifactRecord = Omit<DiagnosticManifestEntry, "sizeBytes" | "sha256"> & {
  absolutePath: string;
};

const SECRET_ENV_KEYS = [
  "LOTUS_AGENT_CLAUDE_TOKEN",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "LOTUS_AGENT_CODEX_TOKEN",
  "LOTUS_MCP_BEARER"
];

const SECRET_ENV_PREFIXES = ["REMOTE_AGENT_SECRET_"];
const MIN_SECRET_LENGTH = 8;

const TOKEN_PATTERNS: Array<[RegExp, string]> = [
  [/Authorization:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Authorization: Bearer [REDACTED]"],
  [/"Authorization"\s*:\s*"Bearer\s+[^"]+"/gi, '"Authorization":"Bearer [REDACTED]"'],
  [/bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]"],
  [/lotus_session=[^;\s"]+/gi, "lotus_session=[REDACTED]"],
  [/\bgh[pousr]_[A-Za-z0-9_]{8,}/g, "[REDACTED]"],
  [/\bgithub_pat_[A-Za-z0-9_]{8,}/g, "[REDACTED]"],
  [/\bsk-[A-Za-z0-9_.=-]{8,}/g, "[REDACTED]"]
];

export class AgentDiagnosticsRedactor {
  private readonly secretValues: string[];

  constructor(secretValues: string[]) {
    this.secretValues = [...new Set(secretValues.filter((value) => value.length >= MIN_SECRET_LENGTH))].sort(
      (a, b) => b.length - a.length
    );
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env, extraSecrets: string[] = []): AgentDiagnosticsRedactor {
    const values = [...extraSecrets];
    for (const key of SECRET_ENV_KEYS) {
      const value = env[key];
      if (value) values.push(value);
    }
    for (const [key, value] of Object.entries(env)) {
      if (value && SECRET_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) values.push(value);
    }
    return new AgentDiagnosticsRedactor(values);
  }

  redact(text: string): string {
    let redacted = text;
    for (const value of this.secretValues) {
      redacted = redacted.split(value).join("[REDACTED]");
    }
    for (const [pattern, replacement] of TOKEN_PATTERNS) {
      redacted = redacted.replace(pattern, replacement);
    }
    return redacted;
  }
}

export type AgentDiagnostics = {
  runId: string;
  rootDir: string;
  mode: "standard" | "full";
  event(payload: Record<string, unknown>): void;
  writeText(relativePath: string, role: DiagnosticRole, text: string, options?: { attach?: AttachPolicy; contentType?: string }): void;
  writeJson(relativePath: string, role: DiagnosticRole, payload: unknown, options?: { attach?: AttachPolicy }): void;
  finalizeExit(payload: unknown): void;
  manifest(): DiagnosticManifestEntry[];
  attachTo(testInfo: TestInfo, ok: boolean): Promise<void>;
  redact(text: string): string;
};

export function createAgentDiagnostics(options: {
  rootDir: string;
  driverName: string;
  testTitle: string;
  extraSecrets?: string[];
  mode?: "standard" | "full";
  runId?: string;
}): AgentDiagnostics {
  const rootDir = options.rootDir;
  mkdirSync(rootDir, { recursive: true });
  const runId = options.runId ?? randomUUID();
  const mode = options.mode ?? (process.env.LOTUS_AGENT_DIAGNOSTICS === "full" ? "full" : "standard");
  const redactor = AgentDiagnosticsRedactor.fromEnv(process.env, options.extraSecrets ?? []);
  const artifacts: ArtifactRecord[] = [];

  function record(
    relativePath: string,
    role: DiagnosticRole,
    contentType: string,
    attach: AttachPolicy,
    redactedText: string
  ): void {
    const absolutePath = join(rootDir, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, redactedText, "utf8");
    const existing = artifacts.find((artifact) => artifact.relativePath === relativePath);
    const recordValue = {
      role,
      relativePath,
      absolutePath,
      contentType,
      redaction: "exact_string_and_patterns_v1" as const,
      attach
    };
    if (existing) Object.assign(existing, recordValue);
    else artifacts.push(recordValue);
  }

  const diagnostics: AgentDiagnostics = {
    runId,
    rootDir,
    mode,
    event(payload) {
      const envelope = {
        schemaVersion: 1,
        ts: new Date().toISOString(),
        runId,
        driver: options.driverName,
        testTitle: options.testTitle,
        payload
      };
      const line = redactor.redact(JSON.stringify(envelope));
      const eventsPath = join(rootDir, "events.jsonl");
      mkdirSync(rootDir, { recursive: true });
      writeFileSync(eventsPath, line + "\n", { flag: "a", encoding: "utf8" });
      if (!artifacts.some((artifact) => artifact.relativePath === "events.jsonl")) {
        artifacts.push({
          role: "events",
          relativePath: "events.jsonl",
          absolutePath: eventsPath,
          contentType: "application/jsonl",
          redaction: "exact_string_and_patterns_v1",
          attach: "always"
        });
      }
    },
    writeText(relativePath, role, text, writeOptions = {}) {
      record(
        relativePath,
        role,
        writeOptions.contentType ?? contentTypeFor(relativePath),
        writeOptions.attach ?? "failure",
        redactor.redact(text)
      );
    },
    writeJson(relativePath, role, payload, writeOptions = {}) {
      record(relativePath, role, "application/json", writeOptions.attach ?? "failure", redactor.redact(JSON.stringify(payload, null, 2)));
    },
    finalizeExit(payload) {
      diagnostics.writeJson("exit.json", "exit", payload, { attach: "always" });
      diagnostics.writeJson("manifest.json", "manifest", diagnostics.manifest(), { attach: "always" });
    },
    manifest() {
      return artifacts
        .filter((artifact) => artifact.role !== "manifest")
        .map((artifact) => {
          const stat = statSync(artifact.absolutePath);
          const body = redactor.redact(readFileForHash(artifact.absolutePath));
          return {
            role: artifact.role,
            relativePath: artifact.relativePath,
            contentType: artifact.contentType,
            sizeBytes: stat.size,
            sha256: createHash("sha256").update(body).digest("hex"),
            redaction: artifact.redaction,
            attach: artifact.attach
          };
        });
    },
    async attachTo(testInfo, ok) {
      const manifestEntry = artifacts.find((artifact) => artifact.role === "manifest");
      const attachable = artifacts.filter((artifact) => {
        if (artifact.role === "manifest") return true;
        if (artifact.attach === "always") return true;
        if (artifact.attach === "failure") return !ok || mode === "full";
        return mode === "full";
      });
      if (manifestEntry && !attachable.includes(manifestEntry)) attachable.push(manifestEntry);
      for (const artifact of attachable) {
        await testInfo.attach(`agent-${options.driverName}-${basename(artifact.relativePath)}`, {
          path: artifact.absolutePath,
          contentType: artifact.contentType
        });
      }
    },
    redact(text) {
      return redactor.redact(text);
    }
  };

  diagnostics.event({ event: "diagnostics_started", mode });
  diagnostics.writeJson(
    "spawn.json",
    "spawn",
    {
      schemaVersion: 1,
      runId,
      driver: options.driverName,
      testTitle: options.testTitle,
      diagnosticsMode: mode
    },
    { attach: "always" }
  );
  return diagnostics;
}

function contentTypeFor(relativePath: string): string {
  if (relativePath.endsWith(".json")) return "application/json";
  if (relativePath.endsWith(".jsonl")) return "application/jsonl";
  if (relativePath.endsWith(".toml")) return "application/toml";
  return "text/plain";
}

function readFileForHash(path: string): string {
  return readFileSync(path, "utf8");
}
