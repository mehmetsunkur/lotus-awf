# 03 — Expression Runtime

## Decision

M2 uses a small constrained JavaScript expression evaluator.

Expressions run against this context:

```ts
{
  payload,
  doc,
  user,
  now
}
```

Example expressions:

```text
payload.amount > 0
payload.amount >= 1000
payload.category === "travel"
```

## M2 safety posture

M2 treats expressions as trusted developer-authored app definitions.

The evaluator blocks obvious unsafe tokens and exposes only the context values above, but it is not a
production citizen-author sandbox. Before untrusted citizen users can write expressions, this should
move to a hardened evaluator such as CEL or an isolated JavaScript runtime.

## Runtime uses

M2 expressions drive:

- field visibility;
- read-only state;
- conditional required state;
- validation rules.

The same validation module is used by the client and API save path.

## Non-goals

- Async expressions.
- Imports.
- Global access.
- Mutation.
- Workflow transition rules.

