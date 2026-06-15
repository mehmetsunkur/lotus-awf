import { describe, expect, it } from "vitest";
import { HANDLER_MANIFEST } from "../../src/shared/handlers/manifest";
import { agentHandlerNames, runAgentHandler, runAgentHandlerFn } from "../../src/server/handlers/agents";
import type { AgentDefinition, BusinessDocument } from "../../src/shared/types";

const agent: AgentDefinition = {
  _id: "agent:daily",
  kind: "agent",
  appId: "expense",
  title: "Daily",
  handler: "record-activity",
  trigger: { type: "schedule", everyMs: 1000 }
};
const ctx = { agent, trigger: "schedule" as const, now: "2026-06-15T00:00:00.000Z" };

describe("agent handler manifest sync", () => {
  it("declares every implemented agent handler and vice versa", () => {
    const declared = HANDLER_MANIFEST.filter((e) => e.kind === "agent").map((e) => e.name).sort();
    expect(agentHandlerNames().sort()).toEqual(declared);
  });
});

describe("agent handler runtime", () => {
  it("runs the activity handler for a scheduled tick", async () => {
    const result = await runAgentHandler("record-activity", ctx);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("scheduled tick");
  });

  it("describes the changed document on an on-change run", async () => {
    const document = { _id: "doc:expense:1", docType: "expense" } as unknown as BusinessDocument;
    const result = await runAgentHandler("record-activity", { agent, trigger: "on-change", document, now: ctx.now });
    expect(result.detail).toContain("doc:expense:1");
  });

  it("fails closed on an unknown handler", async () => {
    expect((await runAgentHandler("ghost", ctx)).ok).toBe(false);
  });

  it("swallows a throwing handler into a closed-fail result", async () => {
    const result = await runAgentHandlerFn(() => {
      throw new Error("boom");
    }, ctx);
    expect(result).toEqual({ ok: false, detail: "boom" });
  });
});
