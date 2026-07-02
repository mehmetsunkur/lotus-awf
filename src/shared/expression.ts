export type ExpressionContext = {
  payload: Record<string, unknown>;
  doc?: Record<string, unknown>;
  user?: string;
  now?: string;
  /**
   * ADR-0019: the actor's principal ids (person + groups), populated ONLY for
   * workflow guard evaluation so guards can express membership
   * (`principals.includes(payload.approver)`). Every other sync-lane context
   * compiles with an empty array by design.
   */
  principals?: string[];
};

const blockedTokens = [
  "constructor",
  "prototype",
  "__proto__",
  "globalThis",
  "global",
  "window",
  "document",
  "process",
  "Function",
  "eval",
  "import",
  "require",
  "fetch",
  "=>",
  ";"
];

export function evaluateExpression(expression: string | undefined, context: ExpressionContext): unknown {
  if (!expression?.trim()) return true;
  if (blockedTokens.some((token) => expression.includes(token))) {
    throw new Error(`Expression contains a blocked token: ${expression}`);
  }

  const fn = new Function(
    "payload",
    "doc",
    "user",
    "now",
    "principals",
    `"use strict"; return (${expression});`
  ) as (payload: unknown, doc: unknown, user: unknown, now: unknown, principals: unknown) => unknown;

  return fn(
    context.payload,
    context.doc ?? {},
    context.user ?? "",
    context.now ?? new Date().toISOString(),
    context.principals ?? []
  );
}

export function evaluateBoolean(expression: string | undefined, context: ExpressionContext, fallback = true): boolean {
  if (!expression?.trim()) return fallback;
  return Boolean(evaluateExpression(expression, context));
}
