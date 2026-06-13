export type ExpressionContext = {
  payload: Record<string, unknown>;
  doc?: Record<string, unknown>;
  user?: string;
  now?: string;
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
    `"use strict"; return (${expression});`
  ) as (payload: unknown, doc: unknown, user: unknown, now: unknown) => unknown;

  return fn(context.payload, context.doc ?? {}, context.user ?? "", context.now ?? new Date().toISOString());
}

export function evaluateBoolean(expression: string | undefined, context: ExpressionContext, fallback = true): boolean {
  if (!expression?.trim()) return fallback;
  return Boolean(evaluateExpression(expression, context));
}
