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

export function createVendorDoc(
  payload: Record<string, unknown>,
  user = config.appUser,
  readers = ["user:alice", "role:finance"]
): BusinessDocument {
  const timestamp = now();
  return {
    _id: `doc:vendor:${ulid()}`,
    kind: "document",
    appId: "expense",
    docType: "vendor",
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
      sections: [
        { title: "Spend", fields: ["amount", "description", "category", "vendorId"] },
        { title: "Accounting", fields: ["spentAt", "reimbursable", "notes"] }
      ],
      fields: [
        {
          name: "amount",
          type: "number",
          label: "Amount",
          required: true,
          validate: [{ expression: "payload.amount > 0", message: "Amount must be greater than zero" }]
        },
        { name: "description", type: "text", label: "Description", required: true },
        {
          name: "category",
          type: "select",
          label: "Category",
          required: true,
          defaultValue: "travel",
          options: [
            { label: "Travel", value: "travel" },
            { label: "Meals", value: "meals" },
            { label: "Supplies", value: "supplies" }
          ]
        },
        {
          name: "vendorId",
          type: "select",
          label: "Vendor",
          helpText: "Loaded from local vendor documents.",
          source: { docType: "vendor", labelField: "payload.name" }
        },
        { name: "spentAt", type: "date", label: "Spent date" },
        { name: "reimbursable", type: "boolean", label: "Reimbursable", defaultValue: true },
        {
          name: "notes",
          type: "textarea",
          label: "Notes",
          visibleWhen: "payload.amount >= 100"
        }
      ]
    },
    {
      _id: "form:vendor",
      kind: "form",
      appId: "expense",
      docType: "vendor",
      title: "Vendor",
      sections: [{ title: "Vendor", fields: ["name", "category", "preferred", "contactEmail"] }],
      fields: [
        { name: "name", type: "text", label: "Name", required: true },
        {
          name: "category",
          type: "select",
          label: "Category",
          defaultValue: "travel",
          options: [
            { label: "Travel", value: "travel" },
            { label: "Meals", value: "meals" },
            { label: "Supplies", value: "supplies" }
          ]
        },
        { name: "preferred", type: "boolean", label: "Preferred", defaultValue: false },
        {
          name: "contactEmail",
          type: "text",
          label: "Contact email",
          validate: [
            {
              expression: "!payload.contactEmail || payload.contactEmail.includes('@')",
              message: "Contact email must include @"
            }
          ]
        }
      ]
    },
    {
      _id: "view:my-expenses",
      kind: "view",
      appId: "expense",
      docType: "expense",
      title: "My Expenses",
      columns: [
        { field: "payload.category", label: "Category" },
        { field: "payload.description", label: "Description" },
        { field: "payload.amount", label: "Amount" },
        { field: "payload.spentAt", label: "Spent" },
        { field: "updatedAt", label: "Updated" }
      ],
      filters: [
        { field: "kind", op: "eq", value: "document" },
        { field: "docType", op: "eq", value: "expense" },
        { field: "readers", op: "in", value: ["user:alice", "role:finance"] }
      ],
      sort: [{ field: "updatedAt", direction: "desc" }]
    },
    {
      _id: "view:all-expenses",
      kind: "view",
      appId: "expense",
      docType: "expense",
      title: "All Expenses",
      columns: [
        { field: "payload.description", label: "Description" },
        { field: "payload.category", label: "Category" },
        { field: "payload.amount", label: "Amount" },
        { field: "updatedAt", label: "Updated" }
      ],
      filters: [
        { field: "kind", op: "eq", value: "document" },
        { field: "docType", op: "eq", value: "expense" }
      ],
      sort: [{ field: "updatedAt", direction: "desc" }]
    },
    {
      _id: "view:vendors",
      kind: "view",
      appId: "expense",
      docType: "vendor",
      title: "Vendors",
      columns: [
        { field: "payload.name", label: "Name" },
        { field: "payload.category", label: "Category" },
        { field: "payload.preferred", label: "Preferred" },
        { field: "updatedAt", label: "Updated" }
      ],
      filters: [
        { field: "kind", op: "eq", value: "document" },
        { field: "docType", op: "eq", value: "vendor" }
      ],
      sort: [{ field: "payload.name", direction: "asc" }]
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
      category: "supplies",
      spentAt: "2026-06-10"
    }),
    createExpenseDoc({
      amount: 125.5,
      description: "Train ticket",
      category: "travel",
      reimbursable: true,
      spentAt: "2026-06-11"
    }),
    createExpenseDoc(
      {
        amount: 220,
        description: "Client dinner",
        category: "meals",
        reimbursable: true,
        spentAt: "2026-06-12"
      },
      "user:bob",
      ["user:bob", "role:finance"]
    ),
    createVendorDoc({ name: "National Rail", category: "travel", preferred: true, contactEmail: "accounts@rail.example" }),
    createVendorDoc({ name: "Paper Market", category: "supplies", preferred: false, contactEmail: "orders@paper.example" })
  ];
}
