import { describe, expect, it } from "vitest";
import { auditAction, eventIsExpired, shouldAudit } from "../../src/shared/audit";
import { validateAuditPolicy, validateDesignDefinition } from "../../src/shared/definition-validation";
import type { AuditPolicy } from "../../src/shared/types";

const policy = (overrides: Partial<AuditPolicy> = {}): AuditPolicy => ({
  _id: "audit:policy",
  kind: "auditpolicy",
  appId: "expense",
  retentionDays: 30,
  ...overrides
});

describe("auditAction", () => {
  it("infers create / update / delete from rev and the deleted flag", () => {
    expect(auditAction("1-abc", false)).toBe("created");
    expect(auditAction("2-abc", false)).toBe("updated");
    expect(auditAction(undefined, true)).toBe("deleted");
    expect(auditAction("3-abc", true)).toBe("deleted");
  });
});

describe("shouldAudit", () => {
  it("audits business documents and skips runtime/design docs", () => {
    expect(shouldAudit({ kind: "document", docType: "expense" })).toBe(true);
    expect(shouldAudit({ kind: "auditevent", docType: "" } as never)).toBe(false);
    expect(shouldAudit({ kind: "form", docType: "" } as never)).toBe(false);
  });
  it("honors a docTypes allowlist when set", () => {
    const p = policy({ docTypes: ["expense"] });
    expect(shouldAudit({ kind: "document", docType: "expense" }, p)).toBe(true);
    expect(shouldAudit({ kind: "document", docType: "vendor" }, p)).toBe(false);
  });
  it("audits all business types when no allowlist is set", () => {
    expect(shouldAudit({ kind: "document", docType: "vendor" }, policy())).toBe(true);
  });
});

describe("eventIsExpired", () => {
  const now = "2026-06-16T00:00:00.000Z";
  it("expires an event older than the retention horizon", () => {
    expect(eventIsExpired({ at: "2026-04-01T00:00:00.000Z" }, now, policy({ retentionDays: 30 }))).toBe(true);
    expect(eventIsExpired({ at: "2026-06-10T00:00:00.000Z" }, now, policy({ retentionDays: 30 }))).toBe(false);
  });
  it("disables retention with no policy or a non-positive horizon", () => {
    expect(eventIsExpired({ at: "2000-01-01T00:00:00.000Z" }, now)).toBe(false);
    expect(eventIsExpired({ at: "2000-01-01T00:00:00.000Z" }, now, policy({ retentionDays: 0 }))).toBe(false);
  });
});

describe("validateAuditPolicy / validateDesignDefinition", () => {
  it("accepts a valid policy via both entry points", () => {
    expect(validateAuditPolicy(policy())).toEqual([]);
    expect(validateDesignDefinition(policy())).toEqual([]);
    expect(validateDesignDefinition(policy({ docTypes: ["expense", "vendor"] }))).toEqual([]);
  });
  it("rejects a negative retention, a bad id, and a malformed docTypes", () => {
    expect(validateAuditPolicy(policy({ retentionDays: -1 })).some((e) => e.field === "retentionDays")).toBe(true);
    expect(validateAuditPolicy({ ...policy(), _id: "audit:wrong" } as AuditPolicy).some((e) => e.field === "_id")).toBe(true);
    expect(validateAuditPolicy(policy({ docTypes: [""] })).some((e) => e.field === "docTypes")).toBe(true);
  });
});
