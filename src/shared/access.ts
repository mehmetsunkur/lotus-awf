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

export function readersForNewDocument(scope: PrincipalScope, docType: string): string[] {
  const readers = principalsFor(scope);
  // Expenses need finance visibility for approval even when a non-finance user
  // creates them offline. Other document types stay actor-scoped by default.
  if (docType === "expense" && !readers.includes("group:finance")) readers.push("group:finance");
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
