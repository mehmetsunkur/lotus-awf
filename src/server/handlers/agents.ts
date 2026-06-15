import type { AgentDefinition, AgentTrigger, BusinessDocument } from "../../shared/types";

/**
 * Agent handlers (M8): server-only plugin code an agent runs when its trigger
 * fires. Like effect handlers they may do I/O and never run on a client; unlike
 * effects they fire from the agent tick (a schedule or a document change), not a
 * transition. `runAgentHandler` never throws — a throwing handler becomes a
 * closed-fail result the orchestrator records as a failed run, so one bad agent
 * can never crash the tick or its siblings.
 *
 * Every name here must be declared `kind: "agent"` in `manifest.ts`; the unit
 * tests assert the two stay in sync.
 */
export type AgentHandlerContext = {
  agent: AgentDefinition;
  trigger: AgentTrigger["type"];
  /** The changed document, for on-change runs; absent for scheduled runs. */
  document?: BusinessDocument;
  now: string;
};

export type AgentHandlerResult = { ok: boolean; detail: string };

export type AgentHandler = (context: AgentHandlerContext) => AgentHandlerResult | Promise<AgentHandlerResult>;

const handlers: Record<string, AgentHandler> = {
  "record-activity": ({ agent, trigger, document, now }) => ({
    ok: true,
    detail:
      trigger === "on-change" && document
        ? `${agent._id} observed change to ${document._id} @ ${now}`
        : `${agent._id} scheduled tick @ ${now}`
  })
};

export function resolveAgentHandler(name: string): AgentHandler | undefined {
  return handlers[name];
}

export function agentHandlerNames(): string[] {
  return Object.keys(handlers);
}

/**
 * Run a resolved handler, swallowing any throw into a closed-fail result.
 * Exposed so the failure path is unit-testable with an injected handler.
 */
export async function runAgentHandlerFn(
  handler: AgentHandler,
  context: AgentHandlerContext
): Promise<AgentHandlerResult> {
  try {
    return await handler(context);
  } catch (cause) {
    return { ok: false, detail: cause instanceof Error ? cause.message : "agent handler failed" };
  }
}

/** Resolve an agent handler by name and run it best-effort (unknown → closed-fail). */
export async function runAgentHandler(name: string, context: AgentHandlerContext): Promise<AgentHandlerResult> {
  const handler = handlers[name];
  if (!handler) return { ok: false, detail: `unknown agent handler: ${name}` };
  return runAgentHandlerFn(handler, context);
}
