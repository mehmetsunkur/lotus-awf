import { describe, expect, it } from "vitest";
import {
  accessRank,
  canEditDocument,
  hasAccessLevel,
  principalsFor,
  rollupAclProjection,
  type PrincipalScope
} from "../../src/shared/access";
import type { BusinessDocument, FormField } from "../../src/shared/types";

const scope = (overrides: Partial<PrincipalScope> = {}): PrincipalScope => ({
  person: "alice",
  groups: ["group:eng"],
  principals: [],
  ...overrides
});

const doc = (overrides: Partial<BusinessDocument> = {}): BusinessDocument => ({
  _id: "doc:expense:1",
  kind: "document",
  appId: "expense",
  docType: "expense",
  createdAt: "2026-06-29T00:00:00.000Z",
  updatedAt: "2026-06-29T00:00:00.000Z",
  createdBy: "alice",
  updatedBy: "alice",
  authors: ["alice"],
  payload: {},
  ...overrides
});

describe("principalsFor", () => {
  it("merges person, groups, and principals, de-duplicated", () => {
    expect(principalsFor(scope({ groups: ["group:eng"], principals: ["alice", "role:lead"] }))).toEqual([
      "alice",
      "group:eng",
      "role:lead"
    ]);
  });
  it("drops falsy entries", () => {
    expect(principalsFor({ person: "alice", groups: ["", "group:eng"], principals: [""] })).toEqual([
      "alice",
      "group:eng"
    ]);
  });
});

describe("canEditDocument", () => {
  it("grants when an app-level Author is listed in authors (Layer 2)", () => {
    expect(canEditDocument(doc(), scope({ accessLevel: "author" }))).toBe(true);
    expect(canEditDocument(doc({ authors: ["bob"] }), scope({ accessLevel: "author" }))).toBe(false);
  });
  it("is group/role-aware — a group in authors confers edit to its members (ADR-0024 §5)", () => {
    // Notes-faithful: a `group:*`/`role:*` in the Authors field is honoured, not inert.
    const author = { accessLevel: "author" as const };
    expect(canEditDocument(doc({ authors: ["group:eng"] }), scope(author))).toBe(true);
    expect(canEditDocument(doc({ authors: ["group:eng"] }), scope({ ...author, groups: ["group:sales"] }))).toBe(false);
    expect(canEditDocument(doc({ authors: ["role:lead"] }), scope({ ...author, principals: ["role:lead"] }))).toBe(true);
  });
  it("never grants a Reader (or no access) even when listed in authors (ADR-0026)", () => {
    expect(canEditDocument(doc(), scope({ accessLevel: "reader" }))).toBe(false);
    expect(canEditDocument(doc(), scope())).toBe(false);
  });
  it("grants to an app-level Editor+ regardless of the Authors field (Layer 1 ACL bypass)", () => {
    expect(canEditDocument(doc({ authors: ["bob"] }), scope({ accessLevel: "editor" }))).toBe(true);
    expect(canEditDocument(doc({ authors: ["bob"] }), scope({ accessLevel: "manager" }))).toBe(true);
    // Below editor, the Authors field still governs.
    expect(canEditDocument(doc({ authors: ["bob"] }), scope({ accessLevel: "author" }))).toBe(false);
    expect(canEditDocument(doc({ authors: ["bob"] }), scope({ accessLevel: "reader" }))).toBe(false);
  });
});

describe("rollupAclProjection", () => {
  const field = (name: string, aclRole?: "author"): FormField => ({
    name,
    type: "text",
    label: name,
    aclRole,
    mode: "computed-once",
    formula: "[]"
  });

  it("unions author fields into authors, keeping the creator base", () => {
    const base = { authors: ["person:dave"] };
    const payload = { aclAuthors: ["group:leads", "group:ops"] };
    expect(rollupAclProjection(base, [field("aclAuthors", "author")], payload)).toEqual({
      authors: ["person:dave", "group:leads", "group:ops"]
    });
  });

  it("always preserves the creator base — an editor's write can only append", () => {
    const base = { authors: ["person:dave", "group:leads"] };
    const result = rollupAclProjection(base, [field("aclAuthors", "author")], { aclAuthors: ["group:leads"] });
    expect(result.authors).toEqual(["person:dave", "group:leads"]); // union de-dupes
  });

  it("de-duplicates and ignores non-principal values in a field's resolved list", () => {
    const base = { authors: ["person:dave"] };
    // Bare strings are not principal-shaped (person:/group:), so they never reach the projection.
    const payload = { aclAuthors: ["group:eng", "eng", "group:eng", 42] };
    expect(rollupAclProjection(base, [field("aclAuthors", "author")], payload)).toEqual({
      authors: ["person:dave", "group:eng"]
    });
  });

  it("contributes nothing when a field's resolved value is empty (PRESERVE-ON-EMPTY upstream)", () => {
    const base = { authors: ["person:dave"] };
    expect(rollupAclProjection(base, [field("aclAuthors", "author")], { aclAuthors: [] })).toEqual(base);
    expect(rollupAclProjection(base, [field("aclAuthors", "author")], {})).toEqual(base);
  });

  it("ignores a legacy aclRole:\"reader\" field and fields with no aclRole (ADR-0026)", () => {
    const base = { authors: ["person:dave"] };
    const legacy = { ...field("aclReaders"), aclRole: "reader" } as unknown as FormField;
    const plain: FormField = { name: "title", type: "text", label: "Title" };
    expect(rollupAclProjection(base, [legacy, plain], { aclReaders: ["group:eng"], title: "hi" })).toEqual(base);
  });
});

describe("accessRank / hasAccessLevel", () => {
  it("ranks levels in ascending privilege and treats undefined as none", () => {
    expect(accessRank("none")).toBe(0);
    expect(accessRank("manager")).toBe(5);
    expect(accessRank(undefined)).toBe(0);
    expect(accessRank("author")).toBeGreaterThan(accessRank("reader"));
  });
  it("grants when the held level meets or exceeds the required level", () => {
    expect(hasAccessLevel(scope({ accessLevel: "editor" }), "author")).toBe(true);
    expect(hasAccessLevel(scope({ accessLevel: "author" }), "author")).toBe(true);
    expect(hasAccessLevel(scope({ accessLevel: "reader" }), "author")).toBe(false);
    expect(hasAccessLevel(scope(), "reader")).toBe(false); // undefined → none
  });
});
