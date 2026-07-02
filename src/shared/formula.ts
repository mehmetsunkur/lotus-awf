/**
 * Formula language — the ASYNC evaluation lane (ADR-0014).
 *
 * `src/shared/expression.ts` is the pure, synchronous lane: identical verdicts on
 * client, server, and offline replica, used for guards/validation/visibility. It
 * must never do I/O.
 *
 * This lane adds cross-database reads (`@DbColumn`/`@DbLookup`, Notes-style) and is
 * therefore async and I/O-bound. Its results depend on which replica is read, so it
 * is allowed ONLY in contexts with a defined fail-mode — never in the sync lane:
 * formula fields (tolerant display), and since ADR-0017/0018 two server-side
 * transition-route contexts with fail-closed contracts — approver-gate resolution
 * (empty result falls back to requiredRole or denies) and assignee resolution
 * (empty result falls back to the static responsible or stamps nothing; never
 * fails the transition). Every lookup is filtered through the shared access
 * helpers, so a formula can never surface a document its caller could not
 * already read.
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

function compileFormula(formula: string) {
  return AsyncFunction(
    "payload",
    "doc",
    "user",
    "now",
    "DbColumn",
    "DbLookup",
    `"use strict"; return (${formula});`
  );
}

/**
 * A syntax (compile) error for a formula, or undefined if it compiles. Exported so
 * authoring validation rejects an unparseable formula BEFORE it can reach the read
 * path — the read path itself also fails closed, but rejecting at authoring keeps a
 * broken formula out of the document entirely.
 */
export function formulaSyntaxError(formula: string): string | undefined {
  try {
    compileFormula(formula);
    return undefined;
  } catch (cause) {
    return cause instanceof Error ? cause.message : "Invalid formula";
  }
}

/**
 * Evaluate a formula in the async lane. The generated function is `async` so a
 * formula may `await DbColumn(...)` / `await DbLookup(...)` inline. Both readers
 * filter through `canReadDocument` against `ctx.scope` before returning anything.
 *
 * NEVER throws: a blocked token, a compile error, or a runtime error all fail
 * closed to `undefined`, so one broken formula can neither break the read path nor
 * (with `Promise.allSettled` at the call site) drop its siblings' values.
 */
export async function evaluateFormulaAsync(formula: string | undefined, ctx: FormulaContext): Promise<unknown> {
  if (!formula?.trim()) return undefined;
  if (formulaBlockedToken(formula)) return undefined; // authoring validation surfaces the reason

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

  try {
    // Compile INSIDE the try: a syntactically-invalid formula must fail closed too.
    const fn = compileFormula(formula);
    return await fn(ctx.payload ?? {}, ctx.doc ?? {}, ctx.user ?? "", ctx.now ?? "", DbColumn, DbLookup);
  } catch {
    return undefined;
  }
}
