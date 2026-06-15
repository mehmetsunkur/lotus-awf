/**
 * Pure handler implementations. A pure handler derives a value from a document's
 * payload with NO I/O and NO host/global access — exactly the safety posture of
 * the expression runtime — so it runs identically on the client (live UX) and on
 * the server (authoritative save), offline included.
 *
 * Every name here must also be declared `kind: "pure"` in `manifest.ts`; the
 * unit tests assert the two stay in sync.
 */
export type PureHandlerContext = {
  payload: Record<string, unknown>;
  doc?: Record<string, unknown>;
};

export type PureHandler = (context: PureHandlerContext) => unknown;

const handlers: Record<string, PureHandler> = {
  "expense-total-with-tax": ({ payload }) => {
    const amount = Number(payload.amount);
    if (!Number.isFinite(amount)) return 0;
    // Round to cents deterministically; identical math on every tier.
    return Math.round(amount * 1.2 * 100) / 100;
  }
};

export function resolvePureHandler(name: string): PureHandler | undefined {
  return handlers[name];
}

export function pureHandlerNames(): string[] {
  return Object.keys(handlers);
}

/**
 * Run a pure handler, failing closed: an unknown name or a throwing handler
 * yields `undefined` rather than propagating, mirroring the guard/validation
 * fail-closed posture so a bad reference can never crash a render or a save.
 */
export function runPureHandler(name: string, context: PureHandlerContext): unknown {
  const handler = handlers[name];
  if (!handler) return undefined;
  try {
    return handler(context);
  } catch {
    return undefined;
  }
}
