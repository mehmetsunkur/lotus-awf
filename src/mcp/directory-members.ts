import { groupIdForSlug, normalizePersonPrincipal } from "../shared/directory";
import type { PublicGroup, PublicPerson } from "../shared/types";

/**
 * Pure group-membership merges for the admin directory tools. `PUT /api/names/groups/:slug`
 * replaces `members` wholesale, so add/remove read the current group, merge here, and send the
 * full list back — the server still runs its member-existence and last-active-admin checks.
 * Last-write-wins: there is no revision check between the read and the write.
 * Inputs are normalized with the server's rules (`src/shared/directory.ts`) so case or spelling
 * differences never turn a removal into a silent no-op.
 */
export type PersonPrincipal = `person:${string}`;

function dedupe(members: PersonPrincipal[]): PersonPrincipal[] {
  return Array.from(new Set(members));
}

export function addMembers(current: PersonPrincipal[], toAdd: string[]): PersonPrincipal[] {
  return dedupe([...current, ...toAdd.map(normalizePersonPrincipal)]);
}

export function removeMembers(current: PersonPrincipal[], toRemove: string[]): PersonPrincipal[] {
  const removed = new Set(toRemove.map(normalizePersonPrincipal));
  return dedupe(current.filter((member) => !removed.has(member)));
}

/** Requested principals (normalized) that are not in `current` — reported back by remove. */
export function missingMembers(current: PersonPrincipal[], requested: string[]): PersonPrincipal[] {
  const present = new Set(current);
  return dedupe(requested.map(normalizePersonPrincipal).filter((member) => !present.has(member)));
}

export function findGroup(groups: PublicGroup[], slug: string): PublicGroup | undefined {
  const id = groupIdForSlug(slug);
  return groups.find((group) => group._id === id);
}

/**
 * App ACL principals that the directory cannot resolve: a `person:*` that is not an active person or
 * a `group:*` that does not exist. Other principal kinds (e.g. `role:*`) are not directory-backed and
 * are skipped. Deduped and sorted — the install tool reports these so an agent knows which groups or
 * people to create next.
 */
export function unresolvedPrincipals(
  entries: Array<{ principal: string }>,
  people: PublicPerson[],
  groups: PublicGroup[]
): string[] {
  const known = new Set<string>([
    ...people.filter((person) => person.active).map((person) => person._id),
    ...groups.map((group) => group._id)
  ]);
  const unresolved = entries
    .map((entry) => entry.principal)
    .filter((principal) => /^(person|group):/.test(principal) && !known.has(principal));
  return Array.from(new Set(unresolved)).sort();
}
