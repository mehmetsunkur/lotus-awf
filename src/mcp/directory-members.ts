import type { PublicGroup } from "../shared/types";

/**
 * Pure group-membership merges for the admin directory tools. `PUT /api/names/groups/:slug`
 * replaces `members` wholesale, so add/remove read the current group, merge here, and send the
 * full list back — the server still runs its member-existence and last-active-admin checks.
 * Last-write-wins: there is no revision check between the read and the write.
 */
export type PersonPrincipal = `person:${string}`;

function dedupe(members: PersonPrincipal[]): PersonPrincipal[] {
  return Array.from(new Set(members));
}

export function addMembers(current: PersonPrincipal[], toAdd: PersonPrincipal[]): PersonPrincipal[] {
  return dedupe([...current, ...toAdd]);
}

export function removeMembers(current: PersonPrincipal[], toRemove: PersonPrincipal[]): PersonPrincipal[] {
  const removed = new Set(toRemove);
  return dedupe(current.filter((member) => !removed.has(member)));
}

/** Accepts a bare slug (`finance`) or a group principal (`group:finance`); the server normalizes further. */
export function bareGroupSlug(slug: string): string {
  return slug.trim().replace(/^group:/, "");
}

export function groupIdForSlug(slug: string): `group:${string}` {
  return `group:${bareGroupSlug(slug)}`;
}

export function findGroup(groups: PublicGroup[], slug: string): PublicGroup | undefined {
  const id = groupIdForSlug(slug);
  return groups.find((group) => group._id === id);
}
