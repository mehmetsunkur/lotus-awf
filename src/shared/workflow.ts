import type {
  BusinessDocument,
  FormDefinition,
  FormField,
  TransitionEvent,
  ValidationError,
  WorkflowDefinition,
  WorkflowTransition
} from "./types";
import { evaluateBoolean } from "./expression";

/**
 * Portable workflow engine. Pure: no I/O, never mutates its inputs. Imported by
 * BOTH the client (to decide which actions to offer) and the server (to decide
 * whether a transition write is legal), so the two can never diverge (aspect
 * A3): gating is `requiredRole` plus guards, and guards receive the actor's
 * `principals` (ADR-0019) so per-document authority — e.g.
 * `principals.includes(payload.approver)` over a server-stamped computed field —
 * stays in the sync parity lane.
 *
 * A document with no `state` is treated as the workflow's `initialState`, which
 * keeps every already-replicated M1/M2 document valid (aspect A1).
 *
 * ADR-0018: the engine also owns the assignment envelope (`assignee`,
 * `assignedAt`, `TransitionEvent.assignee`) — routing metadata stamped on state
 * entry from the target state's resolved/static responsibility, cleared on
 * final states, and never consulted as a gate.
 */

/** A principal id the workflow envelope may carry. */
export function isPrincipalId(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith("person:") || value.startsWith("group:"));
}

/**
 * Normalize an async-formula result to principal ids: a principal string becomes
 * a singleton, an array keeps only its principal-shaped strings, anything else
 * is empty. Used by the ADR-0018 assignee stamp so a malformed formula result
 * can never reach the envelope.
 */
export function normalizeResolvedPrincipals(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter(isPrincipalId);
  return isPrincipalId(value) ? [value] : [];
}

/** Pre-resolved async-lane inputs (server-side); absent in advisory contexts. */
export type ResolvedTransitionContext = {
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

function guardAllows(
  transition: WorkflowTransition,
  doc: BusinessDocument,
  user: string,
  roles: string[],
  now: string
): boolean {
  // Fail closed: a malformed or blocked-token guard denies the transition rather
  // than throwing into the server route (500) or the client render. Mirrors the
  // try/catch posture in validation.ts. An empty guard already returns the
  // fallback (true) inside evaluateBoolean. ADR-0019: guards receive the actor's
  // principals, identically on client and server.
  try {
    return evaluateBoolean(
      transition.guard,
      {
        payload: doc.payload,
        doc: doc as unknown as Record<string, unknown>,
        user,
        now,
        principals: roles
      },
      true
    );
  } catch {
    return false;
  }
}

/**
 * Transitions the given user may perform on the document right now: source state
 * matches, guard passes (with the user's principals in scope), and any required
 * role is held. `roles` are the user's principals. Exactly mirrors the server's
 * authorization — offering and enforcement cannot diverge.
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
      guardAllows(transition, doc, user, roles, now)
  );
}

/**
 * A field a transition's guard reads, surfaced to an operator with its authored
 * `helpText` so the actor learns — in words — what the guard needs before the
 * branch is legal (ADR-0023). Advisory only; never a gate.
 */
export type TransitionRequiredField = {
  name: string;
  label?: string;
  helpText?: string;
};

/**
 * ADR-0023 runtime affordance: one currently-available transition described for
 * an operator agent — the label/target it already knew, plus the authored
 * `description` (when the branch applies) and the `helpText` of any fields its
 * guard reads (what the branch needs). Derived, not stored.
 */
export type TransitionAffordance = {
  id: string;
  label: string;
  to: string;
  description?: string;
  requiredFields?: TransitionRequiredField[];
};

/**
 * Field names a guard expression references via `payload.<ident>`. Best-effort
 * static scan (the sync evaluator has no reflection): it powers the advisory
 * `helpText` surface only, so a missed or spurious token costs a hint, never
 * correctness. Deduped, source order.
 */
export function guardReferencedFields(guard: string | undefined): string[] {
  if (!guard) return [];
  const names: string[] = [];
  const pattern = /payload\.([A-Za-z_$][\w$]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(guard)) !== null) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

/**
 * Describe the transitions a user may perform right now (`availableTransitions`)
 * for an operator agent: each carries its authored `description` and, when the
 * form is supplied, the `helpText` of the fields its guard reads. Pure and
 * advisory — the gate is still `availableTransitions`/`applyTransition`; this
 * only annotates what that lane already offered, so it cannot widen authority.
 */
export function transitionAffordances(
  doc: BusinessDocument,
  def: WorkflowDefinition,
  user: string,
  roles: string[],
  form?: FormDefinition | null,
  now = new Date().toISOString()
): TransitionAffordance[] {
  return availableTransitions(doc, def, user, roles, now).map((transition) => {
    const affordance: TransitionAffordance = {
      id: transition.id,
      label: transition.label,
      to: transition.to
    };
    if (transition.description) affordance.description = transition.description;
    if (form) {
      const required = guardReferencedFields(transition.guard)
        .map((name) => form.fields.find((field) => field.name === name))
        .filter((field): field is FormField => Boolean(field))
        .map((field) => ({
          name: field.name,
          ...(field.label ? { label: field.label } : {}),
          ...(field.helpText ? { helpText: field.helpText } : {})
        }));
      if (required.length) affordance.requiredFields = required;
    }
    return affordance;
  });
}

export type TransitionResult =
  | { ok: true; document: BusinessDocument }
  | { ok: false; errors: ValidationError[] };

/**
 * Apply a transition, returning the next document envelope (new state, stamps,
 * appended history, ADR-0018 assignment) or the reasons it is not currently
 * legal. Pure — the input document is not mutated; async assignee resolution
 * happens in the caller and arrives pre-resolved via `resolved`.
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
  if (!roleAllows(transition, roles)) {
    return {
      ok: false,
      errors: [{ field: "state", message: `${transition.label} requires ${transition.requiredRole}` }]
    };
  }
  if (!guardAllows(transition, doc, user, roles, now)) {
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
