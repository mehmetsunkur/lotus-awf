import { groupIdForSlug, normalizePersonPrincipal } from "../shared/directory";
import type { PublicGroup } from "../shared/types";

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
