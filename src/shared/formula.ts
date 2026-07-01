/**
 * Formula language — the ASYNC evaluation lane (ADR-0014).
 *
 * `src/shared/expression.ts` is the pure, synchronous lane: identical verdicts on
 * client, server, and offline replica, used for guards/validation/visibility. It
 * must never do I/O.
 *
 * This lane adds cross-database reads (`@DbColumn`/`@DbLookup`, Notes-style) and is
 * therefore async and I/O-bound. Its results depend on which replica is read, so it
 * is allowed ONLY in tolerant contexts (formula fields, later formula view columns
 * and agent formulas) — never in the sync lane. Every lookup is filtered through the
 * shared access helpers, so a formula can never surface a document its caller could
 * not already read.
 */

import { canReadDocument, type PrincipalScope } from "./access";
import type { BusinessDocument } from "./types";

/**
 * Async source of another app's business documents. In the server it reads the
 * LOCAL CouchDB replica (offline-first); it is injected so the ACL boundary and the
 * replica choice live in one place and the evaluator stays portable/testable.
 */
export type DbReader = (appId: string, docType: string) => Promise<BusinessDocument[]>;

// Same sandbox posture as expression.ts, but `await` is permitted (it is a
// space-separated keyword, not one of these tokens) so lookups can be inlined.
const blockedTokens = [
  "constructor", "prototype", "__proto__", "globalThis", "global", "window",
  "document", "process", "Function", "eval", "import", "require", "fetch", "=>", ";"
];

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as (
  ...args: string[]
) => (...a: unknown[]) => Promise<unknown>;

export type FormulaContext = {
  payload?: Record<string, unknown>;
  doc?: Record<string, unknown>;
  user?: string;
  now?: string;
  /** Whose read rights the lookups run under — the security principal. */
  scope: PrincipalScope;
  /** ACL is enforced on this reader's output, never bypassed. */
  read: DbReader;
};

function getPath(obj: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), obj);
}

/** Reject a formula string that reaches for a sandbox escape. Exported so
 *  definition validation rejects bad formulas at authoring time, not at read time. */
export function formulaBlockedToken(formula: string): string | undefined {
  return blockedTokens.find((token) => formula.includes(token));
}

/**
 * Evaluate a formula in the async lane. The generated function is `async` so a
 * formula may `await DbColumn(...)` / `await DbLookup(...)` inline. Both readers
 * filter through `canReadDocument` against `ctx.scope` before returning anything.
 */
export async function evaluateFormulaAsync(formula: string | undefined, ctx: FormulaContext): Promise<unknown> {
  if (!formula?.trim()) return undefined;
  const bad = formulaBlockedToken(formula);
  if (bad) throw new Error(`Formula contains a blocked token: ${bad}`);

  // @DbColumn(appId; docType; column) — the column across every readable row.
  const DbColumn = async (appId: string, docType: string, column: string): Promise<unknown[]> => {
    const docs = await ctx.read(appId, docType);
    return docs.filter((doc) => canReadDocument(doc, ctx.scope)).map((doc) => getPath(doc, column));
  };

  // @DbLookup(appId; docType; keyColumn; key; valueColumn) — value from the first readable match.
  const DbLookup = async (
    appId: string,
    docType: string,
    keyColumn: string,
    key: unknown,
    valueColumn: string
  ): Promise<unknown> => {
    const docs = await ctx.read(appId, docType);
    const hit = docs.filter((doc) => canReadDocument(doc, ctx.scope)).find((doc) => getPath(doc, keyColumn) === key);
    return hit ? getPath(hit, valueColumn) : undefined;
  };

  const fn = AsyncFunction(
    "payload",
    "doc",
    "user",
    "now",
    "DbColumn",
    "DbLookup",
    `"use strict"; return (${formula});`
  );
  try {
    return await fn(ctx.payload ?? {}, ctx.doc ?? {}, ctx.user ?? "", ctx.now ?? "", DbColumn, DbLookup);
  } catch {
    // Fail closed to undefined, mirroring pure-handler semantics — a broken
    // formula shows no value, it never breaks the read path.
    return undefined;
  }
}
