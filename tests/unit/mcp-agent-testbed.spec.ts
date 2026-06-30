import { describe, expect, it } from "vitest";
import { validateTemplateDefinitions } from "../../src/shared/template-validation";
import type { TemplateDiff } from "../../src/shared/types";
import { assertTemplateDiff, loadTemplateFixture, rewriteTemplateForApp, type AppTemplateFixture } from "../mcp/agent/support/testbed";

const fixture: AppTemplateFixture = {
  fixtureId: "expense-basic",
  sourceTemplate: loadTemplateFixture("templates/expense/template.json"),
  appId: "agent-expense",
  title: "Agent Expense",
  starterDocType: "expense",
  starterDocTypeTitle: "Expense"
};

const approvalsFixture: AppTemplateFixture = {
  fixtureId: "approvals-multi",
  sourceTemplate: loadTemplateFixture("tests/mcp/agent/fixtures/approvals/template.json"),
  appId: "agent-approvals",
  title: "Agent Approvals",
  starterDocType: "request",
  starterDocTypeTitle: "Request"
};

describe("MCP agent testbed", () => {
  it("rewrites a template fixture to an isolated app id and database", () => {
    const rewritten = rewriteTemplateForApp(fixture);

    expect(rewritten.appId).toBe("agent-expense");
    expect(rewritten.templateId).toBe("agent-expense:fixture:expense-basic");
    expect(rewritten.source).toBe("agent-fixture:expense-basic");
    for (const definition of rewritten.definitions) {
      if ("appId" in definition) expect(definition.appId).toBe("agent-expense");
      if (definition.kind === "app") {
        expect(definition.database).toBe("agent_expense_app");
        expect(definition.title).toBe("Expense Replica");
      }
    }
  });

  it("keeps the rewritten expense fixture valid", () => {
    const rewritten = rewriteTemplateForApp(fixture);
    expect(validateTemplateDefinitions(rewritten)).toEqual([]);
  });

  it("rewrites the approvals fixture to an isolated app id and database", () => {
    const rewritten = rewriteTemplateForApp(approvalsFixture);

    expect(rewritten.appId).toBe("agent-approvals");
    expect(rewritten.templateId).toBe("agent-approvals:fixture:approvals-multi");
    expect(rewritten.source).toBe("agent-fixture:approvals-multi");
    for (const definition of rewritten.definitions) {
      if ("appId" in definition) expect(definition.appId).toBe("agent-approvals");
      if (definition.kind === "app") expect(definition.database).toBe("agent_approvals_app");
    }
  });

  it("keeps the rewritten approvals fixture valid", () => {
    const rewritten = rewriteTemplateForApp(approvalsFixture);
    expect(validateTemplateDefinitions(rewritten)).toEqual([]);
  });

  it("asserts exact added changed and removed definition ids", () => {
    const diff: TemplateDiff = {
      added: [{ id: "view:new", kind: "view" }],
      changed: [{ id: "workflow:expense", kind: "workflow" }],
      removed: [],
      unchanged: [{ id: "form:expense", kind: "form" }]
    };

    expect(() =>
      assertTemplateDiff(diff, {
        added: ["view:new"],
        changed: ["workflow:expense"],
        removed: []
      })
    ).not.toThrow();

    expect(() => assertTemplateDiff(diff, { changed: ["form:expense"] })).toThrow(/Unexpected template diff/);
  });
});
