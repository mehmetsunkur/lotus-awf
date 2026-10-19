import type { AccessLevel, BusinessDocument, FormField } from "./types";
import { normalizeResolvedPrincipals } from "./workflow";

export type PrincipalScope = {
  person: string;
  groups: string[];
  principals: string[];
  accessLevel?: AccessLevel;
};

export function principalsFor(scope: PrincipalScope): string[] {
  return Array.from(new Set([scope.person, ...scope.groups, ...scope.principals].filter(Boolean)));
}

// ADR-0026: there is no per-document read check. Document visibility is the app
// ACL — `hasAccessLevel(scope, "reader")`, resolved per app by the session gate.

export function canEditDocument(doc: BusinessDocument, scope: PrincipalScope): boolean {
  // ADR-0024 §5: Notes-faithful two-layer edit gate.
  // Layer 1 — ACL Editor+ bypass: an app-level Editor/Designer/Manager may edit
  // regardless of the Authors field (as the ACL level implies). `scope.accessLevel`
  // is populated by `requireAppSession` on the PUT/DELETE/transition routes.
  if (hasAccessLevel(scope, "editor")) return true;
  // Layer 2 — Authors-field intersection, group/role-aware: an app-level Author
  // (ADR-0026: a Reader never edits, even when listed) whose principals (person,
  // groups, roles) appear in `authors`. A `group:*`/`role:*` in `authors` is honoured.
  if (!hasAccessLevel(scope, "author")) return false;
  return principalsFor(scope).some((principal) => doc.authors.includes(principal));
}

/**
 * ADR-0024 §2: materialize the `$Authors`-style projection onto the envelope.
 * `base` is the creator authors already on the document (captured at create,
 * carried forward on later writes); each `aclRole:"author"` field's resolved
 * principal list is UNIONED in. Additive by construction: the creator base
 * survives a write by a different editor and the projection never narrows below
 * it. A field whose resolved value carries no principals contributes nothing
 * (PRESERVE-ON-EMPTY happens upstream at stamp time). ADR-0026 retired the
 * reader half — `readers` is no longer projected.
 */
export function rollupAclProjection(
  base: { authors: string[] },
  fields: FormField[],
  payload: Record<string, unknown>
): { authors: string[] } {
  let authors = base.authors;
  for (const field of fields) {
    if (field.aclRole !== "author") continue;
    const values = normalizeResolvedPrincipals(payload[field.name]);
    if (!values.length) continue;
    authors = Array.from(new Set([...authors, ...values]));
  }
  return { authors };
}

const ACCESS_ORDER: AccessLevel[] = ["none", "reader", "author", "editor", "designer", "manager"];

export function accessRank(level: AccessLevel | undefined): number {
  return ACCESS_ORDER.indexOf(level ?? "none");
}

export function hasAccessLevel(scope: PrincipalScope, required: AccessLevel): boolean {
  return accessRank(scope.accessLevel) >= accessRank(required);
}
