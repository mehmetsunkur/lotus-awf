import { describe, expect, it } from "vitest";
import expenseTemplate from "../../templates/expense/template.json";
import { validateTemplateDefinitions } from "../../src/shared/template-validation";
import type { TemplateArtifact, TemplateDiff } from "../../src/shared/types";
import { assertTemplateDiff, rewriteTemplateForApp, type AppTemplateFixture } from "../mcp/agent/support/testbed";

const fixture: AppTemplateFixture = {
  fixtureId: "expense-basic",
  sourceTemplate: expenseTemplate as TemplateArtifact,
  appId: "agent-expense",
  title: "Agent Expense",
  starterDocType: "expense",
  starterDocTypeTitle: "Expense"
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
