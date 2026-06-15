# 02 — Access Policy

## Principals

The current actor is represented as:

```ts
{ user: string; roles: string[] }
```

The effective principal set is `[user, ...roles]`.

## Reads

A business document is readable when at least one document `readers` entry appears in the actor's
principal set. View filters can narrow results, but cannot widen access.

## Writes

Payload edits and deletes require the actor's user id to appear in `authors`.

Workflow transitions require the actor to read the document and then pass the workflow transition's
existing guard/role rules. Approval-style transitions are not limited to `authors`; they are governed
by workflow roles such as `role:finance`.

## Creates

New documents are authored by the current actor. Their readers are derived from the actor's principal
set. Expense documents also include `role:finance` so finance approvers can see submitted work.
