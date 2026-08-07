import { describe, expect, it } from "vitest";
import {
  accessRank,
  accessSelector,
  canEditDocument,
  canReadDocument,
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
  readers: ["alice", "group:finance"],
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

describe("canReadDocument", () => {
  it("is true when any of the scope's principals is a reader", () => {
    expect(canReadDocument(doc(), scope())).toBe(true);
    expect(canReadDocument(doc({ readers: ["group:finance"] }), scope({ groups: ["group:finance"] }))).toBe(true);
  });
  it("is false when no principal overlaps the readers", () => {
    expect(canReadDocument(doc({ readers: ["bob"] }), scope())).toBe(false);
  });
});

describe("canEditDocument", () => {
  it("grants when the scope person is an author (Layer 2)", () => {
    expect(canEditDocument(doc(), scope())).toBe(true);
    expect(canEditDocument(doc({ authors: ["bob"] }), scope())).toBe(false);
  });
  it("is group/role-aware — a group in authors confers edit to its members (ADR-0024 §5)", () => {
    // Notes-faithful: a `group:*`/`role:*` in the Authors field is honoured, not inert.
    expect(canEditDocument(doc({ authors: ["group:eng"] }), scope())).toBe(true);
    expect(canEditDocument(doc({ authors: ["group:eng"] }), scope({ groups: ["group:sales"] }))).toBe(false);
    expect(canEditDocument(doc({ authors: ["role:lead"] }), scope({ principals: ["role:lead"] }))).toBe(true);
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
  const field = (name: string, aclRole: "reader" | "author"): FormField => ({
    name,
    type: "text",
    label: name,
    aclRole,
    mode: "computed-once",
    formula: "[]"
  });

  it("unions reader fields into readers and author fields into authors, keeping the creator base", () => {
    const base = { readers: ["person:dave"], authors: ["person:dave"] };
    const fields = [field("aclReaders", "reader"), field("aclAuthors", "author")];
    const payload = { aclReaders: ["group:flight-ops", "group:ground-ops"], aclAuthors: ["group:leads"] };
    expect(rollupAclProjection(base, fields, payload)).toEqual({
      readers: ["person:dave", "group:flight-ops", "group:ground-ops"],
      authors: ["person:dave", "group:leads"]
    });
  });

  it("always preserves the creator base even when a reader field re-resolves to a different editor's groups", () => {
    // Additive: an editor's write can only APPEND readers, never displace the creator base.
    const base = { readers: ["person:dave", "group:flight-ops"], authors: ["person:dave"] };
    const payload = { aclReaders: ["group:flight-ops"] };
    const result = rollupAclProjection(base, [field("aclReaders", "reader")], payload);
    expect(result.readers).toContain("person:dave");
    expect(result.readers).toEqual(["person:dave", "group:flight-ops"]); // union de-dupes
  });

  it("de-duplicates and ignores non-principal values in a field's resolved list", () => {
    const base = { readers: ["person:dave"], authors: ["person:dave"] };
    // Bare strings are not principal-shaped (person:/group:), so they never reach the projection.
    const payload = { aclReaders: ["group:eng", "eng", "group:eng", 42] };
    expect(rollupAclProjection(base, [field("aclReaders", "reader")], payload)).toEqual({
      readers: ["person:dave", "group:eng"],
      authors: ["person:dave"]
    });
  });

  it("contributes nothing when a field's resolved value is empty (PRESERVE-ON-EMPTY upstream)", () => {
    const base = { readers: ["person:dave"], authors: ["person:dave"] };
    expect(rollupAclProjection(base, [field("aclReaders", "reader")], { aclReaders: [] })).toEqual(base);
    expect(rollupAclProjection(base, [field("aclReaders", "reader")], {})).toEqual(base);
  });

  it("returns the base untouched when the form has no aclRole fields", () => {
    const base = { readers: ["person:dave"], authors: ["person:dave"] };
    const plain: FormField = { name: "title", type: "text", label: "Title" };
    expect(rollupAclProjection(base, [plain], { title: "hi" })).toEqual(base);
  });
});

describe("accessSelector", () => {
  it("builds a Mango $in selector over the scope principals", () => {
    expect(accessSelector(scope())).toEqual({ readers: { $in: ["alice", "group:eng"] } });
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
