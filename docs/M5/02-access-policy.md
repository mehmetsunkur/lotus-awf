# 02 — Access Policy

> **Superseded in part by ADR-0026 (2026-10-19):** per-document `readers` are removed — document visibility is the app ACL. The `authors` edit rules below still apply (Layer 2 now also requires app Author+).

## Principals

M18 supersedes the original fixed `APP_USER` model. The current actor is now resolved from an
authenticated session as:

```ts
{
  person: "person:<username>";
  groups: string[];
  principals: string[];
  accessLevel: "reader" | "author" | "editor" | "designer" | "manager";
}
```

The effective principal set is `[person, ...groups, ...principals]`. Built-in directory principals
use Notes-like ids such as `person:alice` and `group:finance`.

## Reads

A business document is readable when at least one document `readers` entry appears in the actor's
principal set. View filters can narrow results, but cannot widen access.

## Writes

Payload edits and deletes require the actor's person id to appear in `authors`.

Workflow transitions require the actor to read the document and then pass the workflow transition's
existing guard/role rules. Approval-style transitions are not limited to `authors`; they are governed
by workflow principals such as `group:finance`.

## Creates

New documents are authored by the current actor. Their readers are derived from the actor's principal
set. Expense documents also include `group:finance` so finance approvers can see submitted work.

## App ACL levels

`acl:rules` remains a design document, but entries now grant app-level access to a principal:

```json
{
  "_id": "acl:rules",
  "kind": "acl",
  "entries": [
    { "principal": "group:finance", "level": "manager" },
    { "principal": "person:bob", "level": "author" }
  ]
}
```

Runtime data routes require at least `reader`; document creation requires `author`; design/template
routes require `designer`; admin/demo routes require `manager`.
