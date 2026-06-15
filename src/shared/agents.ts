import type { AgentDefinition, BusinessDocument } from "./types";

/**
 * Portable agent matching/scheduling engine. Pure: no I/O, never mutates inputs.
 * Execution is server-authoritative and tick-driven (the server orchestrates the
 * `_changes` feed, the durable run store, and the clock around these functions),
 * but the *decisions* — is this scheduled agent due? does this change match this
 * agent? — live here so they are deterministic and unit-testable, exactly like
 * the workflow engine in `workflow.ts`.
 */

/** An agent fires unless explicitly disabled (`enabled: false`). */
export function agentIsEnabled(agent: AgentDefinition): boolean {
  return agent.enabled !== false;
}

/**
 * Whether a scheduled agent is due at `now`. A never-run agent (no `lastRunAt`)
 * is always due; otherwise it is due once `everyMs` has elapsed. Non-schedule
 * agents are never "due" (they fire from changes, not the clock).
 */
export function agentIsDue(agent: AgentDefinition, lastRunAt: string | undefined, now: string): boolean {
  if (!agentIsEnabled(agent) || agent.trigger.type !== "schedule") return false;
  if (!lastRunAt) return true;
  const elapsed = Date.parse(now) - Date.parse(lastRunAt);
  return Number.isFinite(elapsed) && elapsed >= agent.trigger.everyMs;
}

/**
 * Whether an on-change agent should run for a changed document. Only business
 * documents trigger agents; an agent with a `docType` filter matches only that
 * type. Non-on-change agents never match a change.
 */
export function agentMatchesChange(agent: AgentDefinition, doc: BusinessDocument): boolean {
  if (!agentIsEnabled(agent) || agent.trigger.type !== "on-change") return false;
  if (doc.kind !== "document") return false;
  return !agent.trigger.docType || agent.trigger.docType === doc.docType;
}

/** Stable dedupe key so an at-least-once tick never runs the same work twice. */
export function agentRunKey(agentId: string, sourceRev?: string): string {
  return sourceRev ? `${agentId}@${sourceRev}` : agentId;
}
