/**
 * names.nsf directory id normalization (ADR-0012). Pure and portable so the server routes and the
 * MCP directory tools resolve usernames, group slugs, and principals identically.
 */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function personIdForUsername(username: string): `person:${string}` {
  return `person:${normalizeUsername(username)}`;
}

/** Accepts a bare slug (`Finance`) or a group principal (`group:finance`, any case). */
export function normalizeGroupSlug(slug: string): string {
  return normalizeUsername(slug.trim().replace(/^group:/i, ""));
}

export function groupIdForSlug(slug: string): `group:${string}` {
  return `group:${normalizeGroupSlug(slug)}`;
}

/** Normalizes the username part of a `person:*` principal (`person:Bob` → `person:bob`). */
export function normalizePersonPrincipal(principal: string): `person:${string}` {
  return personIdForUsername(principal.trim().replace(/^person:/i, ""));
}
