import { ulid } from "ulid";
import type { AclRules, AppConfig, BusinessDocument, FormDefinition, ViewDefinition } from "../shared/types";
import { config } from "./config";

const now = () => new Date().toISOString();

export function createExpenseDoc(
  payload: Record<string, unknown>,
  user = config.appUser,
  readers = ["user:alice", "role:finance"]
): BusinessDocument {
  const timestamp = now();
  return {
    _id: `doc:expense:${ulid()}`,
    kind: "document",
    appId: "expense",
    docType: "expense",
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: user,
    updatedBy: user,
    readers,
    authors: [user],
    payload
  };
}

export function seedDocuments(): Array<AppConfig | FormDefinition | ViewDefinition | AclRules | BusinessDocument> {
  return [
    {
      _id: "app:config",
      kind: "app",
      appId: "expense",
      title: "Expense Replica",
      database: config.appDb
    },
    {
      _id: "form:expense",
      kind: "form",
      appId: "expense",
      docType: "expense",
      title: "Expense",
      fields: [
        { name: "amount", type: "number", label: "Amount", required: true },
        { name: "description", type: "text", label: "Description", required: true },
        { name: "spentAt", type: "date", label: "Spent date" }
      ]
    },
    {
      _id: "view:my-expenses",
      kind: "view",
      appId: "expense",
      docType: "expense",
      title: "My Expenses",
      columns: [
        { field: "payload.description", label: "Description" },
        { field: "payload.amount", label: "Amount" },
        { field: "payload.spentAt", label: "Spent" },
        { field: "updatedAt", label: "Updated" }
      ],
      sort: [{ field: "updatedAt", direction: "desc" }]
    },
    {
      _id: "acl:rules",
      kind: "acl",
      appId: "expense",
      policy: "M1 spike: filtered replication uses document readers entries matching user id or role.",
      users: [
        { user: "user:alice", roles: ["role:finance"] },
        { user: "user:bob", roles: ["role:sales"] }
      ]
    },
    createExpenseDoc({
      amount: 42.5,
      description: "Stationery",
      spentAt: "2026-06-10"
    }),
    createExpenseDoc({
      amount: 125.5,
      description: "Train ticket",
      spentAt: "2026-06-11"
    }),
    createExpenseDoc(
      {
        amount: 220,
        description: "Client dinner",
        spentAt: "2026-06-12"
      },
      "user:bob",
      ["user:bob", "role:finance"]
    )
  ];
}
