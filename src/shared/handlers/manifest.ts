import type { HandlerKind, HandlerManifestEntry } from "../types";

/**
 * The portable plugin manifest: the single declared source of truth for which
 * handlers exist and what kind each is. Imported by BOTH client and server so
 * definition validation can reject a reference to an unknown handler — or to a
 * handler of the wrong kind — identically on every tier (validation parity).
 *
 * Implementations live elsewhere and are split by where they may run: `pure`
 * handlers in `src/shared/handlers/pure.ts` (portable, offline), `effect`
 * handlers in `src/server/handlers/effects.ts` (server-only I/O). A handler
 * MUST be declared here before a definition may reference it; the unit tests
 * assert every declared handler has a matching implementation.
 */
export const HANDLER_MANIFEST: HandlerManifestEntry[] = [
  {
    name: "expense-total-with-tax",
    kind: "pure",
    description: "Gross amount including 20% tax, derived from payload.amount."
  },
  {
    name: "audit-transition",
    kind: "effect",
    description: "Append a server-side audit-log entry recording a workflow transition."
  }
];

const byName = new Map(HANDLER_MANIFEST.map((entry) => [entry.name, entry]));

export function findHandler(name: string): HandlerManifestEntry | undefined {
  return byName.get(name);
}

/** True only if `name` is a declared handler AND its declared kind matches. */
export function handlerHasKind(name: string, kind: HandlerKind): boolean {
  const entry = byName.get(name);
  return Boolean(entry && entry.kind === kind);
}
