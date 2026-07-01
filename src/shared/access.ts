import type { AccessLevel, BusinessDocument } from "./types";

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
  return doc.authors.includes(scope.person);
}

export function readersForNewDocument(scope: PrincipalScope, defaultReaders: string[] = []): string[] {
  const readers = principalsFor(scope);
  // ADR-0015: a form may declare `defaultReaders` (data) so new documents get the
  // extra visibility their app needs — e.g. an expense form grants `group:finance`
  // so finance can approve docs created (even offline) by a non-finance user. No
  // app-specific rule lives in the base; the policy travels with the template.
  for (const principal of defaultReaders) {
    if (!readers.includes(principal)) readers.push(principal);
  }
  return readers;
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
