import type {
  BusinessDocument,
  TransitionEvent,
  ValidationError,
  WorkflowDefinition,
  WorkflowTransition
} from "./types";
import { evaluateBoolean } from "./expression";

/**
 * Portable workflow engine. Pure: no I/O, never mutates its inputs. Imported by
 * BOTH the client (to decide which actions to offer) and the server (to decide
 * whether a transition write is legal), so the two can never diverge (aspect A3).
 *
 * A document with no `state` is treated as the workflow's `initialState`, which
 * keeps every already-replicated M1/M2 document valid (aspect A1).
 */

export function currentState(doc: BusinessDocument, def: WorkflowDefinition): string {
  return doc.state ?? def.initialState;
}

export function isFinalState(state: string, def: WorkflowDefinition): boolean {
  return Boolean(def.states.find((candidate) => candidate.name === state)?.final);
}

function matchesFrom(transition: WorkflowTransition, state: string, def: WorkflowDefinition): boolean {
  if (transition.from === state) return true;
  return transition.from === "*" && !isFinalState(state, def);
}

function roleAllows(transition: WorkflowTransition, roles: string[]): boolean {
  return !transition.requiredRole || roles.includes(transition.requiredRole);
}

function guardAllows(transition: WorkflowTransition, doc: BusinessDocument, user: string, now: string): boolean {
  return evaluateBoolean(
    transition.guard,
    { payload: doc.payload, doc: doc as unknown as Record<string, unknown>, user, now },
    true
  );
}

/**
 * Transitions the given user may perform on the document right now: source state
 * matches, guard passes, and any required role is held. `roles` are the user's
 * roles from acl:rules.
 */
export function availableTransitions(
  doc: BusinessDocument,
  def: WorkflowDefinition,
  user: string,
  roles: string[],
  now = new Date().toISOString()
): WorkflowTransition[] {
  const state = currentState(doc, def);
  return def.transitions.filter(
    (transition) =>
      matchesFrom(transition, state, def) &&
      roleAllows(transition, roles) &&
      guardAllows(transition, doc, user, now)
  );
}

export type TransitionResult =
  | { ok: true; document: BusinessDocument }
  | { ok: false; errors: ValidationError[] };

/**
 * Apply a transition, returning the next document envelope (new state, stamps,
 * appended history) or the reasons it is not currently legal. Pure — the input
 * document is not mutated.
 */
export function applyTransition(
  doc: BusinessDocument,
  def: WorkflowDefinition,
  transitionId: string,
  user: string,
  roles: string[],
  now = new Date().toISOString()
): TransitionResult {
  const state = currentState(doc, def);
  const transition = def.transitions.find((candidate) => candidate.id === transitionId);

  if (!transition) {
    return { ok: false, errors: [{ field: "state", message: `Unknown transition: ${transitionId}` }] };
  }
  if (!matchesFrom(transition, state, def)) {
    return {
      ok: false,
      errors: [{ field: "state", message: `Cannot ${transition.label} from ${state}` }]
    };
  }
  if (!roleAllows(transition, roles)) {
    return {
      ok: false,
      errors: [{ field: "state", message: `${transition.label} requires ${transition.requiredRole}` }]
    };
  }
  if (!guardAllows(transition, doc, user, now)) {
    return {
      ok: false,
      errors: [{ field: "state", message: `${transition.label} is not allowed for this document` }]
    };
  }

  const event: TransitionEvent = {
    transition: transition.id,
    from: state,
    to: transition.to,
    at: now,
    by: user
  };

  return {
    ok: true,
    document: {
      ...doc,
      state: transition.to,
      stateUpdatedAt: now,
      stateUpdatedBy: user,
      history: [...(doc.history ?? []), event]
    }
  };
}
