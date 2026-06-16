import type { AuditAction, AuditEvent, AuditPolicy, BusinessDocument } from "./types";

/**
 * Portable audit/retention engine (M10). Pure: no I/O, never mutates inputs.
 * Execution is server-authoritative and CDC-driven (the server drains the
 * `_changes` feed, writes the durable event store, and prunes on the clock
 * around these functions), but the *decisions* — should this change be audited?
 * is this event past retention? — live here so they are deterministic and
 * unit-testable, exactly like the agent engine in `agents.ts`.
 */

/** Runtime kinds the recorder must never audit, or it would feed back on its own writes. */
const NON_AUDITED_KINDS = new Set(["auditevent", "auditstate", "auditpolicy", "agentrun", "agentstate"]);

/**
 * Infer the change action from a CouchDB `_changes` row. A deleted row is a
 * delete; a first-generation revision (`1-…`) is a create; anything else is an
 * update.
 */
export function auditAction(rev: string | undefined, deleted: boolean | undefined): AuditAction {
  if (deleted) return "deleted";
  return rev?.startsWith("1-") ? "created" : "updated";
}

/**
 * Whether a changed document should be audited. Only business documents are
 * audited (runtime/design docs are skipped — and skipping the audit kinds
 * prevents the recorder from auditing its own writes). When the policy sets a
 * `docTypes` allowlist, only those types are audited; absent means all.
 */
export function shouldAudit(doc: Pick<BusinessDocument, "kind" | "docType">, policy?: AuditPolicy): boolean {
  if (doc.kind !== "document") return false;
  if (NON_AUDITED_KINDS.has(doc.kind)) return false;
  const allow = policy?.docTypes;
  if (allow && allow.length > 0) return allow.includes(doc.docType);
  return true;
}

/**
 * Whether an event is past the policy's retention horizon at `now`. With no
 * policy or a non-positive `retentionDays`, retention is disabled (nothing
 * expires), so an absent policy never silently deletes history.
 */
export function eventIsExpired(event: Pick<AuditEvent, "at">, now: string, policy?: AuditPolicy): boolean {
  const days = policy?.retentionDays;
  if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) return false;
  const age = Date.parse(now) - Date.parse(event.at);
  if (!Number.isFinite(age)) return false;
  return age > days * 24 * 60 * 60 * 1000;
}
