import { describe, expect, it } from "vitest";
import { agentIsDue, agentMatchesChange, agentRunKey } from "../../src/shared/agents";
import { validateDesignDefinition } from "../../src/shared/definition-validation";
import type { AgentDefinition, BusinessDocument } from "../../src/shared/types";

const scheduled: AgentDefinition = {
  _id: "agent:daily",
  kind: "agent",
  appId: "expense",
  title: "Daily",
  handler: "record-activity",
  trigger: { type: "schedule", everyMs: 1000 }
};

const onChange: AgentDefinition = {
  _id: "agent:on-expense",
  kind: "agent",
  appId: "expense",
  title: "On expense",
  handler: "record-activity",
  trigger: { type: "on-change", docType: "expense" }
};

const doc = (docType: string) => ({ kind: "document", docType } as unknown as BusinessDocument);

describe("agentIsDue", () => {
  it("a never-run scheduled agent is due", () => {
    expect(agentIsDue(scheduled, undefined, "2026-06-15T00:00:00.000Z")).toBe(true);
  });
  it("is not due within the interval and due after it", () => {
    expect(agentIsDue(scheduled, "2026-06-15T00:00:00.000Z", "2026-06-15T00:00:00.500Z")).toBe(false);
    expect(agentIsDue(scheduled, "2026-06-15T00:00:00.000Z", "2026-06-15T00:00:02.000Z")).toBe(true);
  });
  it("never marks an on-change or disabled agent due", () => {
    expect(agentIsDue(onChange, undefined, "2026-06-15T00:00:00.000Z")).toBe(false);
    expect(agentIsDue({ ...scheduled, enabled: false }, undefined, "2026-06-15T00:00:00.000Z")).toBe(false);
  });
});

describe("agentMatchesChange", () => {
  it("matches a document of the filtered type", () => {
    expect(agentMatchesChange(onChange, doc("expense"))).toBe(true);
  });
  it("does not match a different docType, a non-document, or a schedule agent", () => {
    expect(agentMatchesChange(onChange, doc("vendor"))).toBe(false);
    expect(agentMatchesChange(onChange, { kind: "form" } as unknown as BusinessDocument)).toBe(false);
    expect(agentMatchesChange(scheduled, doc("expense"))).toBe(false);
  });
  it("matches any document when no docType filter is set", () => {
    const any = { ...onChange, trigger: { type: "on-change" } } as AgentDefinition;
    expect(agentMatchesChange(any, doc("vendor"))).toBe(true);
  });
});

describe("agentRunKey", () => {
  it("includes the source rev when present", () => {
    expect(agentRunKey("agent:x", "2-abc")).toBe("agent:x@2-abc");
    expect(agentRunKey("agent:x")).toBe("agent:x");
  });
});

describe("validateDesignDefinition for agents", () => {
  it("accepts valid schedule and on-change agents", () => {
    expect(validateDesignDefinition(scheduled)).toEqual([]);
    expect(validateDesignDefinition(onChange)).toEqual([]);
  });
  it("rejects an unknown or wrong-kind handler", () => {
    expect(validateDesignDefinition({ ...scheduled, handler: "ghost" }).some((e) => e.field === "handler")).toBe(true);
    expect(validateDesignDefinition({ ...scheduled, handler: "audit-transition" }).some((e) => /not a agent handler/.test(e.message))).toBe(true);
  });
  it("rejects a negative schedule interval", () => {
    const bad = { ...scheduled, trigger: { type: "schedule", everyMs: -5 } } as AgentDefinition;
    expect(validateDesignDefinition(bad).some((e) => e.field === "trigger.everyMs")).toBe(true);
  });
  it("rejects an unknown trigger type", () => {
    const bad = { ...scheduled, trigger: { type: "cron" } } as unknown as AgentDefinition;
    expect(validateDesignDefinition(bad).some((e) => e.field === "trigger.type")).toBe(true);
  });
});
