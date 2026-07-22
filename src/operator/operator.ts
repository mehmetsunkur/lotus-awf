import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LotusApiError, LotusClient } from "../mcp/lotus-client";
import { createAgentDiagnostics } from "./diagnostics";
import type { AgentDriver } from "./agent-driver";
import { assembleShiftPrompt } from "./prompt";

/**
 * M28 agent operator (ADR-0021): a standalone client daemon that works the agent-ops
 * app's `@me` queue. Everything goes through the public HTTP API under directory
 * identities — the operator's own for queue/claim/artifact writes, and each session's
 * PERSONA for prompt derivation (least privilege: the operator holds no read grants on
 * business apps; the derivation can only see what the persona sees). Sessions carry no
 * prompt text; the prompt is assembled from governed org data via the same
 * `assembleShiftPrompt` the M27 working-day spec asserts hygiene on.
 *
 * Claim dedupe is the workflow guard: `claim` is only offered from `requested`, so a
 * racing second operator gets a 422 and skips. Orphaned `running` sessions (a dead
 * operator) are swept to `failed(orphaned)` on startup — single-operator deployment.
 */

export type OperatorConfig = {
  apiUrl: string;
  username: string;
  password: string;
  /** Shared persona password for token minting (ADR-0021 recorded limitation). */
  personaPassword: string;
  /** MCP HTTP host workspace surface handed to drivers. */
  mcpWorkspaceUrl: string;
  appId: string;
  orgAppId: string;
  kbAppId: string;
  companyName: string;
  pollMs: number;
  maxSessionsPerDay: number;
  /** Disk root for full verbose diagnostics (documents get the capped copy). */
  diagnosticsRoot: string;
  log?: (message: string) => void;
};

/** Driver-produced diagnostics files that become artifact documents, in upload order.
 *  The prompt is NOT read back from disk — the operator derived it, so it uploads its
 *  own copy from memory (the artifact must reflect what was actually handed over). */
const ARTIFACT_FILES = ["final_message.txt", "events.jsonl", "tool-transcript.jsonl"];

export const ARTIFACT_CONTENT_CAP = 64 * 1024;

type SessionDocument = {
  _id: string;
  state?: string;
  payload: Record<string, unknown>;
};

export type TickResult =
  | { kind: "idle" }
  | { kind: "capped" }
  | { kind: "lost-claim"; sessionId: string }
  | { kind: "completed"; sessionId: string }
  | { kind: "failed"; sessionId: string; outcome: string };

const nowIso = () => new Date().toISOString();

/** Mint a persona `lotus_session` token — the personaBearer mechanism, daemon-side. */
export async function mintPersonaToken(apiUrl: string, username: string, password: string): Promise<string> {
  const response = await fetch(`${apiUrl.replace(/\/+$/, "")}/api/session/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  if (!response.ok) throw new Error(`persona login for ${username} failed with status ${response.status}`);
  const token = /lotus_session=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
  if (!token) throw new Error(`persona login for ${username} returned no lotus_session cookie`);
  return token;
}

/** Cap artifact content for document storage; the full file stays on disk. The cap is
 *  in BYTES (documents replicate to every reader's local replica), and truncation
 *  lands on a code-point boundary — a cut multibyte sequence decodes to U+FFFD, which
 *  is stripped from the tail rather than stored. */
export function capArtifactContent(content: string): string {
  if (Buffer.byteLength(content, "utf8") <= ARTIFACT_CONTENT_CAP) return content;
  const truncated = Buffer.from(content, "utf8")
    .subarray(0, ARTIFACT_CONTENT_CAP)
    .toString("utf8")
    .replace(/�+$/, "");
  return `${truncated}\n[truncated by operator: full file retained on the operator host]`;
}

export class AgentOperator {
  private readonly client: LotusClient;
  private readonly drivers: Map<string, AgentDriver>;
  private claimsToday = 0;
  private claimsDay = "";
  private stopping = false;

  constructor(
    private readonly config: OperatorConfig,
    drivers: AgentDriver[]
  ) {
    this.client = new LotusClient({ apiUrl: config.apiUrl, username: config.username, password: config.password });
    this.drivers = new Map(drivers.map((driver) => [driver.name, driver]));
  }

  private log(message: string): void {
    (this.config.log ?? console.log)(`[agent-operator] ${message}`);
  }

  /** Sessions left `running` by a dead operator fail as orphaned (startup sweep). */
  async sweepOrphans(): Promise<number> {
    const sessions = (await this.client.listDocuments(this.config.appId, "agent-session")) as SessionDocument[];
    const orphans = sessions.filter((doc) => doc.state === "running");
    for (const orphan of orphans) {
      this.log(`sweeping orphaned session ${orphan._id}`);
      await this.failSession(orphan, "orphaned");
    }
    return orphans.length;
  }

  /** One poll/claim/run cycle. Never throws for a failing session — only for harness-level faults. */
  async tick(): Promise<TickResult> {
    const day = nowIso().slice(0, 10);
    if (day !== this.claimsDay) {
      this.claimsDay = day;
      this.claimsToday = 0;
    }
    // Poll gate is the ADR-0022 cross-app aggregate, not a single per-app inbox view:
    // one question — "do I have work anywhere?" — answers spawn-worthiness and hands
    // back the routing refs. Same `@me`/assignee routing (ADR-0018/0020); the `claim`
    // transition below is still the authoritative dedupe (ADR-0021), this only decides
    // whether to attempt it. Filtered to this operator's own app (single-app daemon).
    const queue = await this.client.workQueue({ items: true });
    const items = queue.byApp.find((entry) => entry.appId === this.config.appId)?.items ?? [];
    const next = items
      .filter((item) => item.docType === "agent-session" && item.state === "requested")
      // Oldest-assigned first, `_id` (ULID, time-ordered) as a stable tiebreak.
      .sort((a, b) => (a.assignedAt ?? "").localeCompare(b.assignedAt ?? "") || a._id.localeCompare(b._id))[0];
    if (!next) return { kind: "idle" };
    if (this.claimsToday >= this.config.maxSessionsPerDay) {
      this.log(`daily session cap (${this.config.maxSessionsPerDay}) reached; not claiming ${next._id}`);
      return { kind: "capped" };
    }

    try {
      await this.client.transitionDocument(this.config.appId, next._id, "claim");
    } catch (error) {
      if (error instanceof LotusApiError && (error.status === 422 || error.status === 409)) {
        this.log(`lost claim race for ${next._id}`);
        return { kind: "lost-claim", sessionId: next._id };
      }
      throw error;
    }
    this.claimsToday += 1;

    const session = (await this.client.getDocument(this.config.appId, next._id)) as SessionDocument;
    try {
      const outcome = await this.runSession(session);
      return outcome;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.log(`session ${session._id} failed: ${reason}`);
      await this.failSession(session, "operator-error").catch((failError) => {
        this.log(`could not fail session ${session._id}: ${String(failError)}`);
      });
      return { kind: "failed", sessionId: session._id, outcome: "operator-error" };
    }
  }

  /** Run until stopped: poll, claim, run, repeat. */
  async run(): Promise<void> {
    this.log(`operator ${this.config.username} watching app ${this.config.appId} at ${this.config.apiUrl}`);
    await this.sweepOrphans();
    while (!this.stopping) {
      const result = await this.tick();
      // Sleep on everything that didn't just finish a session: idle/capped obviously,
      // and lost-claim too — a second instance winning races while the view still
      // reports `requested` must not spin claim -> 422 -> re-query without backoff.
      if (result.kind !== "completed" && result.kind !== "failed") {
        await new Promise((resolve) => setTimeout(resolve, this.config.pollMs));
      }
    }
  }

  /** Finish the in-flight session (tick is atomic per session), then stop looping. */
  stop(): void {
    this.stopping = true;
  }

  private async runSession(session: SessionDocument): Promise<TickResult> {
    const personaId = String(session.payload.persona ?? "");
    const username = personaId.replace(/^person:/, "");
    const driverName = String(session.payload.driver ?? "");
    const driver = this.drivers.get(driverName);
    if (!driver) return this.failWith(session, "unknown-driver");
    if (!driver.isAvailable()) {
      this.log(`driver ${driverName} unavailable: ${driver.unavailableReason()}`);
      return this.failWith(session, "driver-unavailable");
    }

    const startedAt = nowIso();
    // Derivation runs UNDER THE PERSONA'S OWN SESSION (ADR-0021): the operator needs
    // no read grants on org/kb, and can only derive what the persona could read.
    const token = await mintPersonaToken(this.config.apiUrl, username, this.config.personaPassword);
    const personaClient = new LotusClient({ apiUrl: this.config.apiUrl, sessionToken: token });
    const personaSession = await personaClient.getSession();
    const displayName = personaSession.person?.displayName ?? username;
    const employees = (await personaClient.listDocuments(this.config.orgAppId, "employee")) as SessionDocument[];
    const employee = employees.find((doc) => doc.payload.person === personaId);
    const jobDescription = typeof employee?.payload.jobDescription === "string" ? employee.payload.jobDescription : "";
    if (!jobDescription) return this.failWith(session, "no-job-description");
    const jobTitle = typeof employee?.payload.title === "string" ? employee.payload.title : "";

    const prompt = assembleShiftPrompt({
      displayName,
      jobTitle,
      companyName: this.config.companyName,
      kbAppId: this.config.kbAppId,
      jobDescription
    });

    const diagnostics = createAgentDiagnostics({
      rootDir: join(this.config.diagnosticsRoot, session._id.replace(/[^a-zA-Z0-9_-]/g, "_")),
      driverName,
      testTitle: `agent-ops session ${session._id}`
    });
    const authorization = `Bearer ${token}`;
    diagnostics.addSecrets([token, authorization]);

    this.log(`running ${session._id}: ${personaId} via ${driverName}`);
    let ok = false;
    let outcome = "ok";
    try {
      const run = await driver.run({
        prompt,
        mcpServers: { "lotus-workspace": { url: this.config.mcpWorkspaceUrl, authorization } },
        diagnostics
      });
      ok = run.ok;
      if (!ok) outcome = "driver-error";
    } catch (error) {
      this.log(`driver ${driverName} threw for ${session._id}: ${error instanceof Error ? error.message : String(error)}`);
      outcome = "driver-error";
    }

    await this.createArtifact(session, "prompt.txt", prompt);
    await this.uploadArtifacts(session, diagnostics.rootDir);
    await this.writeOutcomeArtifact(session, { outcome, startedAt, finishedAt: nowIso(), persona: personaId, driver: driverName });
    await this.client.transitionDocument(this.config.appId, session._id, ok ? "complete" : "fail");
    this.log(`${session._id} ${ok ? "completed" : `failed (${outcome})`}`);
    return ok ? { kind: "completed", sessionId: session._id } : { kind: "failed", sessionId: session._id, outcome };
  }

  /** One artifact document, capped; an upload failure never loses the session. */
  private async createArtifact(session: SessionDocument, name: string, content: string): Promise<void> {
    try {
      await this.client.createDocument(this.config.appId, {
        docType: "artifact",
        payload: { sessionId: session._id, name, content: capArtifactContent(content) }
      });
    } catch (error) {
      this.log(`artifact ${name} for ${session._id} failed to upload: ${String(error)}`);
    }
  }

  /** Artifact documents for the driver-produced diagnostics files (already redacted
   *  by the diagnostics writer). */
  private async uploadArtifacts(session: SessionDocument, diagnosticsDir: string): Promise<void> {
    for (const name of ARTIFACT_FILES) {
      const filePath = join(diagnosticsDir, name);
      if (!existsSync(filePath)) continue;
      await this.createArtifact(session, name, readFileSync(filePath, "utf8"));
    }
  }

  /**
   * Outcome facts live in an operator-AUTHORED artifact, never on the session payload:
   * `canEditDocument` is authors-only (the requester authored the session), and the
   * operator's only write authority over other people's documents is transitions.
   * State/assignee/history/audit on the session itself are stamped by the engine.
   */
  private async writeOutcomeArtifact(
    session: SessionDocument,
    facts: { outcome: string; startedAt?: string; finishedAt: string; persona?: string; driver?: string }
  ): Promise<void> {
    await this.createArtifact(session, "outcome.json", JSON.stringify(facts, null, 2));
  }

  private async failWith(session: SessionDocument, outcome: string): Promise<TickResult> {
    await this.failSession(session, outcome);
    return { kind: "failed", sessionId: session._id, outcome };
  }

  private async failSession(session: SessionDocument, outcome: string): Promise<void> {
    await this.writeOutcomeArtifact(session, {
      outcome,
      finishedAt: nowIso(),
      persona: typeof session.payload.persona === "string" ? session.payload.persona : undefined,
      driver: typeof session.payload.driver === "string" ? session.payload.driver : undefined
    });
    await this.client.transitionDocument(this.config.appId, session._id, "fail");
  }
}
