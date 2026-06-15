import type { BusinessDocument, WorkflowTransition } from "../../shared/types";

/**
 * Effect handlers (M7): server-only plugin code that may do I/O when a workflow
 * transition runs. Unlike pure handlers they are NOT portable and never run on a
 * client — they are invoked only on the online transition route, AFTER the
 * authoritative state change is persisted. They are best-effort: `runEffect`
 * never throws and never reverts the transition, so a failing effect can degrade
 * a side-channel but can never block or corrupt the document lifecycle.
 *
 * For this foundation milestone the only effect appends to an in-memory audit
 * log (observable via GET /api/plugins/log). Persisting effects as replicated
 * documents and firing them on reconcile of offline transitions are deferred.
 */
export type EffectContext = {
  document: BusinessDocument;
  transition: WorkflowTransition;
  user: string;
  now: string;
};

export type EffectResult = { name: string; ok: boolean; detail: string };

export type EffectHandler = (context: EffectContext) => EffectResult;

export type EffectLogEntry = EffectResult & { at: string; docId: string; transition: string };

const effectLog: EffectLogEntry[] = [];

export function readEffectLog(): EffectLogEntry[] {
  return [...effectLog];
}

/** Cleared on /api/reset so the log does not bleed across test runs. */
export function clearEffectLog(): void {
  effectLog.length = 0;
}

const handlers: Record<string, EffectHandler> = {
  "audit-transition": ({ document, transition, user, now }) => ({
    name: "audit-transition",
    ok: true,
    detail: `${user} ${transition.id}: ${transition.from}->${transition.to} on ${document._id} @ ${now}`
  })
};

function record(entry: EffectLogEntry): void {
  effectLog.push(entry);
}

/**
 * Run a single resolved effect handler, swallowing any throw into a closed-fail
 * result. Exposed so the failure path is unit-testable with an injected handler.
 */
export function runEffectHandler(name: string, handler: EffectHandler, context: EffectContext): EffectResult {
  let result: EffectResult;
  try {
    result = handler(context);
  } catch (cause) {
    result = { name, ok: false, detail: cause instanceof Error ? cause.message : "effect failed" };
  }
  record({ ...result, at: context.now, docId: context.document._id, transition: context.transition.id });
  return result;
}

/**
 * Resolve and run a transition's effect by name. Returns null when there is no
 * action to run, a closed-fail result for an unknown handler, or the handler's
 * result (logged either way). Defensive on the unknown-name case even though
 * definition validation already rejects unknown references.
 */
export function runEffect(name: string | undefined, context: EffectContext): EffectResult | null {
  if (!name) return null;
  const handler = handlers[name];
  if (!handler) {
    const result: EffectResult = { name, ok: false, detail: "unknown effect handler" };
    record({ ...result, at: context.now, docId: context.document._id, transition: context.transition.id });
    return result;
  }
  return runEffectHandler(name, handler, context);
}
