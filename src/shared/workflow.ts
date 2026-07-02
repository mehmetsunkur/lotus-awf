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
 * whether a transition write is legal). For the SYNC lane (states, guards,
 * requiredRole) the two can never diverge (aspect A3). ADR-0017 adds a
 * server-resolved ASYNC gate (`approverFormula`): the engine consumes only the
 * pre-resolved result, the client offers such transitions advisorily (it cannot
 * run async lookups), and the server is authoritative — a refused dynamic gate
 * is a 422, never a divergence in the shared semantics themselves.
 *
 * A document with no `state` is treated as the workflow's `initialState`, which
 * keeps every already-replicated M1/M2 document valid (aspect A1).
 *
 * ADR-0018: the engine also owns the assignment envelope (`assignee`,
 * `assignedAt`, `TransitionEvent.assignee`) — routing metadata stamped on state
 * entry from the target state's resolved/static responsibility, cleared on
 * final states, and never consulted as a gate.
 */

/** A principal id the workflow envelope/gate may carry. */
export function isPrincipalId(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith("person:") || value.startsWith("group:"));
}

/**
 * Normalize an async-formula result to principal ids: a principal string becomes
 * a singleton, an array keeps only its principal-shaped strings, anything else
 * is empty. Shared by the ADR-0017 approver gate and the ADR-0018 assignee stamp
 * so a malformed formula result can never reach the envelope or the gate.
 */
export function normalizeResolvedPrincipals(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter(isPrincipalId);
  return isPrincipalId(value) ? [value] : [];
}

/** Pre-resolved async-lane inputs (server-side); absent in advisory contexts. */
export type ResolvedTransitionContext = {
  /** ADR-0017: normalized approverFormula result. Empty array = resolution ran
   *  and yielded nothing; undefined = resolution was not run. Both fall back. */
  approvers?: string[];
  /** ADR-0018: normalized responsibleFormula result for the TARGET state. */
  assignee?: string;
};

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

/**
 * ADR-0017 dynamic approver gate. With a non-empty resolution the resolved
 * principals REPLACE requiredRole (union would let any role-holder approve and
 * defeat per-approver enforcement). With an empty/absent resolution the static
 * requiredRole is the fallback — and when the author declared approverFormula
 * with NO requiredRole, the transition is DENIED: an authored restriction must
 * fail closed, never degrade to no gate at all.
 */
function approverAllows(
  transition: WorkflowTransition,
  roles: string[],
  resolvedApprovers: string[] | undefined
): boolean {
  if (!transition.approverFormula) return roleAllows(transition, roles);
  if (resolvedApprovers && resolvedApprovers.length > 0) {
    return resolvedApprovers.some((principal) => roles.includes(principal));
  }
  if (transition.requiredRole) return roles.includes(transition.requiredRole);
  return false;
}

function guardAllows(transition: WorkflowTransition, doc: BusinessDocument, user: string, now: string): boolean {
  // Fail closed: a malformed or blocked-token guard denies the transition rather
  // than throwing into the server route (500) or the client render. Mirrors the
  // try/catch posture in validation.ts. An empty guard already returns the
  // fallback (true) inside evaluateBoolean.
  try {
    return evaluateBoolean(
      transition.guard,
      { payload: doc.payload, doc: doc as unknown as Record<string, unknown>, user, now },
      true
    );
  } catch {
    return false;
  }
}

/**
 * Transitions the given user may perform on the document right now: source state
 * matches, guard passes, and the static role is held OR the transition carries an
 * approverFormula (ADR-0017 advisory offering: this function cannot resolve async
 * formulas, so it offers the action and the authoritative server decides — hiding
 * it would make a formula-resolved approver outside requiredRole unable to act
 * from the UI at all). `roles` are the user's principals.
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
      (roleAllows(transition, roles) || Boolean(transition.approverFormula)) &&
      guardAllows(transition, doc, user, now)
  );
}

export type TransitionResult =
  | { ok: true; document: BusinessDocument }
  | { ok: false; errors: ValidationError[] };

/**
 * Apply a transition, returning the next document envelope (new state, stamps,
 * appended history, ADR-0018 assignment) or the reasons it is not currently
 * legal. Pure — the input document is not mutated; async resolution happens in
 * the caller and arrives pre-resolved via `resolved`.
 */
export function applyTransition(
  doc: BusinessDocument,
  def: WorkflowDefinition,
  transitionId: string,
  user: string,
  roles: string[],
  now = new Date().toISOString(),
  resolved: ResolvedTransitionContext = {}
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
  if (!approverAllows(transition, roles, resolved.approvers)) {
    // Distinct message for the dynamic gate: telling a requiredRole-holder the
    // transition "requires <their own role>" would be unintelligible when the
    // resolved approver set is what refused them.
    const message = transition.approverFormula
      ? `${transition.label} requires approval by the designated approver`
      : `${transition.label} requires ${transition.requiredRole}`;
    return { ok: false, errors: [{ field: "state", message }] };
  }
  if (!guardAllows(transition, doc, user, now)) {
    return {
      ok: false,
      errors: [{ field: "state", message: `${transition.label} is not allowed for this document` }]
    };
  }

  // ADR-0018: assignment for the entered state — resolved formula value, else
  // the target state's static responsible, else none; final states always clear.
  const targetState = def.states.find((candidate) => candidate.name === transition.to);
  const staticResponsible =
    targetState && isPrincipalId(targetState.responsible) ? targetState.responsible : undefined;
  const assignee = targetState?.final
    ? undefined
    : (normalizeResolvedPrincipals(resolved.assignee)[0] ?? staticResponsible);

  const event: TransitionEvent = {
    transition: transition.id,
    from: state,
    to: transition.to,
    at: now,
    by: user,
    ...(assignee ? { assignee } : {})
  };

  const { assignee: _clearedAssignee, assignedAt: _clearedAssignedAt, ...envelope } = doc;
  return {
    ok: true,
    document: {
      ...envelope,
      state: transition.to,
      stateUpdatedAt: now,
      stateUpdatedBy: user,
      ...(assignee ? { assignee, assignedAt: now } : {}),
      history: [...(doc.history ?? []), event]
    }
  };
}
