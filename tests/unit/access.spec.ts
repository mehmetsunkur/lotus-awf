import { describe, expect, it } from "vitest";
import {
  accessRank,
  accessSelector,
  canEditDocument,
  canReadDocument,
  hasAccessLevel,
  principalsFor,
  readersForNewDocument,
  type PrincipalScope
} from "../../src/shared/access";
import type { BusinessDocument } from "../../src/shared/types";

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
  it("keys off the document authors and the scope person only", () => {
    expect(canEditDocument(doc(), scope())).toBe(true);
    expect(canEditDocument(doc({ authors: ["bob"] }), scope())).toBe(false);
    // Group membership does not confer edit rights.
    expect(canEditDocument(doc({ authors: ["group:eng"] }), scope())).toBe(false);
  });
});

describe("readersForNewDocument", () => {
  it("adds group:finance for expenses so finance can approve", () => {
    expect(readersForNewDocument(scope(), "expense")).toContain("group:finance");
  });
  it("does not duplicate group:finance when already present", () => {
    const readers = readersForNewDocument(scope({ groups: ["group:finance"] }), "expense");
    expect(readers.filter((r) => r === "group:finance")).toHaveLength(1);
  });
  it("leaves other document types actor-scoped", () => {
    expect(readersForNewDocument(scope(), "vendor")).not.toContain("group:finance");
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
