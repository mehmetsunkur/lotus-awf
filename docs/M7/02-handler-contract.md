# 02 — Handler Contract

## Manifest

The manifest (`src/shared/handlers/manifest.ts`) is the portable, declared list of every handler:

```ts
type HandlerKind = "pure" | "effect";
type HandlerManifestEntry = { name: string; kind: HandlerKind; description: string };
```

It is imported by both client and server so that definition validation rejects a reference to an
unknown handler — or to a handler of the wrong kind — identically on every tier. A handler MUST be
declared here before a definition may reference it.

## Handler kinds

- **pure** — derives a value from a payload with no I/O and no host/global access, exactly the
  expression runtime's safety posture. Portable: runs identically on client and server, offline.
  Implementations: `src/shared/handlers/pure.ts`.
- **effect** — server-only code that may do I/O when a transition runs. Never portable, never runs on
  a client. Implementations: `src/server/handlers/effects.ts`.

The manifest declares both kinds (so `action` references can be validated everywhere); only the
implementations are split by where they may run.

## Definition references

Two optional, back-compatible fields:

- `FormField.compute?: string` — names a `pure` handler that derives the field's value.
- `WorkflowTransition.action?: string` — names an `effect` handler run after the transition.

Both are absent on every M1–M6 definition, so already-replicated documents stay valid (definitions
-as-data contract).

## Validation

`validateDesignDefinition` checks each reference and **fails closed**:

- a `compute` reference must name a declared **pure** handler;
- an `action` reference must name a declared **effect** handler;
- an unknown name or a kind mismatch is a validation error.

Because validation runs on both the client and the API definition-save path, a definition that
references a missing or wrong-kind handler cannot be saved on either tier.
