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

export function canReadDocument(doc: BusinessDocument, scope: PrincipalScope): boolean {
  const principals = principalsFor(scope);
  return doc.readers.some((reader) => principals.includes(reader));
}

export function canEditDocument(doc: BusinessDocument, scope: PrincipalScope): boolean {
  // ADR-0024 §5: Notes-faithful two-layer edit gate.
  // Layer 1 — ACL Editor+ bypass: an app-level Editor/Designer/Manager may edit
  // regardless of the Authors field (as the ACL level implies). `scope.accessLevel`
  // is populated by `requireAppSession` on the PUT/DELETE/transition routes.
  if (hasAccessLevel(scope, "editor")) return true;
  // Layer 2 — Authors-field intersection, group/role-aware: any of the writer's
  // principals (person, groups, roles) appearing in `authors` grants edit. A
  // `group:*`/`role:*` in `authors` is now honoured, not inert.
  return principalsFor(scope).some((principal) => doc.authors.includes(principal));
}

/**
 * ADR-0024 §2: materialize the `$Readers`-style projection onto the envelope.
 * `base` is the creator readers/authors already on the document (captured at
 * create, carried forward on later writes); each `aclRole` field's resolved
 * principal list is UNIONED in — reader fields feed `readers`, author fields feed
 * `authors`. Additive by construction: the creator base survives a write by a
 * different editor and the projection never narrows below it, so it lands on the
 * same top-level `readers` field the m2-readers index binds (invariant 120). A
 * field whose resolved value carries no principals contributes nothing
 * (PRESERVE-ON-EMPTY happens upstream at stamp time — the field keeps its prior
 * value there, so a degraded resolution narrows readership, never widens it).
 */
export function rollupAclProjection(
  base: { readers: string[]; authors: string[] },
  fields: FormField[],
  payload: Record<string, unknown>
): { readers: string[]; authors: string[] } {
  const union = (existing: string[], add: string[]): string[] => Array.from(new Set([...existing, ...add]));
  let readers = base.readers;
  let authors = base.authors;
  for (const field of fields) {
    if (field.aclRole !== "reader" && field.aclRole !== "author") continue;
    const values = normalizeResolvedPrincipals(payload[field.name]);
    if (!values.length) continue;
    if (field.aclRole === "reader") readers = union(readers, values);
    else authors = union(authors, values);
  }
  return { readers, authors };
}

export function accessSelector(scope: PrincipalScope): Record<string, unknown> {
  return {
    readers: {
      $in: principalsFor(scope)
    }
  };
}

const ACCESS_ORDER: AccessLevel[] = ["none", "reader", "author", "editor", "designer", "manager"];

export function accessRank(level: AccessLevel | undefined): number {
  return ACCESS_ORDER.indexOf(level ?? "none");
}

export function hasAccessLevel(scope: PrincipalScope, required: AccessLevel): boolean {
  return accessRank(scope.accessLevel) >= accessRank(required);
}
