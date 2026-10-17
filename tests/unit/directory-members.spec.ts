import { describe, expect, it } from "vitest";
import { addMembers, findGroup, missingMembers, removeMembers } from "../../src/mcp/directory-members";
import { groupIdForSlug, normalizeGroupSlug, normalizePersonPrincipal } from "../../src/shared/directory";
import type { PublicGroup } from "../../src/shared/types";

describe("directory id normalization", () => {
  it("normalizes group slugs like the server, with or without a group: prefix", () => {
    expect(normalizeGroupSlug(" Finance ")).toBe("finance");
    expect(normalizeGroupSlug("group:finance")).toBe("finance");
    expect(normalizeGroupSlug("GROUP:Finance Team")).toBe("finance-team");
    expect(groupIdForSlug("Group:Ops")).toBe("group:ops");
  });

  it("normalizes the username part of person principals", () => {
    expect(normalizePersonPrincipal("person:Bob")).toBe("person:bob");
    expect(normalizePersonPrincipal("PERSON: Alice ")).toBe("person:alice");
  });
});

describe("directory member merges", () => {
  it("adds members, normalized and deduped in order", () => {
    expect(addMembers(["person:alice", "person:bob"], ["person:Bob", "person:carol", "person:carol"])).toEqual([
      "person:alice",
      "person:bob",
      "person:carol"
    ]);
  });

  it("returns the current list unchanged for an empty add/remove", () => {
    expect(addMembers(["person:alice"], [])).toEqual(["person:alice"]);
    expect(removeMembers(["person:alice"], [])).toEqual(["person:alice"]);
  });

  it("removes members regardless of input case and ignores non-members", () => {
    expect(removeMembers(["person:alice", "person:bob", "person:carol"], ["person:Bob", "person:ghost"])).toEqual([
      "person:alice",
      "person:carol"
    ]);
  });

  it("reports requested principals that were not members", () => {
    expect(missingMembers(["person:alice", "person:bob"], ["person:Bob", "person:ghost", "person:ghost"])).toEqual(["person:ghost"]);
    expect(missingMembers(["person:alice"], ["person:alice"])).toEqual([]);
  });

  it("does not mutate the input list", () => {
    const current: Array<`person:${string}`> = ["person:alice"];
    addMembers(current, ["person:bob"]);
    removeMembers(current, ["person:alice"]);
    expect(current).toEqual(["person:alice"]);
  });

  it("resolves a group by slug in any accepted spelling", () => {
    const groups: PublicGroup[] = [{ _id: "group:finance", kind: "group", name: "Finance", members: [] }];
    expect(findGroup(groups, "finance")?.name).toBe("Finance");
    expect(findGroup(groups, "Finance")?.name).toBe("Finance");
    expect(findGroup(groups, "GROUP:finance")?.name).toBe("Finance");
    expect(findGroup(groups, "sales")).toBeUndefined();
  });
});
