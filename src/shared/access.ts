import type { BusinessDocument } from "./types";

export type PrincipalScope = {
  user: string;
  roles: string[];
};

export function principalsFor(scope: PrincipalScope): string[] {
  return Array.from(new Set([scope.user, ...scope.roles].filter(Boolean)));
}

export function canReadDocument(doc: BusinessDocument, scope: PrincipalScope): boolean {
  const principals = principalsFor(scope);
  return doc.readers.some((reader) => principals.includes(reader));
}

export function canEditDocument(doc: BusinessDocument, scope: PrincipalScope): boolean {
  return doc.authors.includes(scope.user);
}

export function readersForNewDocument(scope: PrincipalScope, docType: string): string[] {
  const readers = principalsFor(scope);
  // Expenses need finance visibility for approval even when a non-finance user
  // creates them offline. Other document types stay actor-scoped by default.
  if (docType === "expense" && !readers.includes("role:finance")) readers.push("role:finance");
  return readers;
}

export function accessSelector(scope: PrincipalScope): Record<string, unknown> {
  return {
    readers: {
      $in: principalsFor(scope)
    }
  };
}
