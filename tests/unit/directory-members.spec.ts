import { describe, expect, it } from "vitest";
import { addMembers, findGroup, groupIdForSlug, removeMembers } from "../../src/mcp/directory-members";
import type { PublicGroup } from "../../src/shared/types";

describe("directory member merges", () => {
  it("adds members, deduped in order", () => {
    expect(addMembers(["person:alice", "person:bob"], ["person:bob", "person:carol", "person:carol"])).toEqual([
      "person:alice",
      "person:bob",
      "person:carol"
    ]);
  });

  it("returns the current list unchanged for an empty add/remove", () => {
    expect(addMembers(["person:alice"], [])).toEqual(["person:alice"]);
    expect(removeMembers(["person:alice"], [])).toEqual(["person:alice"]);
  });

  it("removes members and ignores non-members", () => {
    expect(removeMembers(["person:alice", "person:bob", "person:carol"], ["person:bob", "person:ghost"])).toEqual([
      "person:alice",
      "person:carol"
    ]);
  });

  it("does not mutate the input list", () => {
    const current: Array<`person:${string}`> = ["person:alice"];
    addMembers(current, ["person:bob"]);
    removeMembers(current, ["person:alice"]);
    expect(current).toEqual(["person:alice"]);
  });

  it("resolves a group by bare slug or group principal", () => {
    const groups: PublicGroup[] = [{ _id: "group:finance", kind: "group", name: "Finance", members: [] }];
    expect(groupIdForSlug(" group:finance ")).toBe("group:finance");
    expect(findGroup(groups, "finance")?.name).toBe("Finance");
    expect(findGroup(groups, "group:finance")?.name).toBe("Finance");
    expect(findGroup(groups, "sales")).toBeUndefined();
  });
});
