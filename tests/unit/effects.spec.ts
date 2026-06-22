import { describe, expect, it } from "vitest";
import { runEffect, runEffectHandler, readEffectLog, clearEffectLog } from "../../src/server/handlers/effects";
import type { BusinessDocument, WorkflowTransition } from "../../src/shared/types";

const doc = { _id: "doc:expense:1", docType: "expense" } as unknown as BusinessDocument;
const transition: WorkflowTransition = { id: "submit", label: "Submit", from: "draft", to: "submitted", action: "audit-transition" };
const ctx = { document: doc, transition, user: "person:alice", now: "2026-06-15T00:00:00.000Z" };

describe("effect runtime", () => {
  it("returns null when the transition has no action", () => {
    expect(runEffect(undefined, ctx)).toBeNull();
  });

  it("runs the audit effect and records it in the log", () => {
    clearEffectLog();
    const result = runEffect("audit-transition", ctx);
    expect(result?.ok).toBe(true);
    expect(readEffectLog()).toHaveLength(1);
    expect(readEffectLog()[0]).toMatchObject({ docId: "doc:expense:1", transition: "submit", ok: true });
  });

  it("fails closed on an unknown handler without throwing", () => {
    const result = runEffect("ghost", ctx);
    expect(result).toEqual(expect.objectContaining({ ok: false, detail: "unknown effect handler" }));
  });

  it("swallows a throwing handler into a closed-fail result (never blocks the caller)", () => {
    const result = runEffectHandler("boom", () => {
      throw new Error("kaboom");
    }, ctx);
    expect(result.ok).toBe(false);
    expect(result.detail).toBe("kaboom");
  });
});
