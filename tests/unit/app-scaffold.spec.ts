import { describe, expect, test } from "vitest";
import { databaseForAppId, scaffoldBlankApp, slugifyAppId, validateAppId } from "../../src/shared/app-scaffold";

describe("app scaffold", () => {
  test("validates and normalizes app ids", () => {
    expect(slugifyAppId("Field Reports!")).toBe("field-reports");
    expect(validateAppId("field-reports")).toEqual([]);
    expect(validateAppId("Bad Slug").map((error) => error.field)).toEqual(["appId"]);
    expect(validateAppId("setup").map((error) => error.message)).toContain('App id "setup" is reserved');
    expect(validateAppId("names").map((error) => error.message)).toContain('App id "names" is reserved');
  });

  test("scaffolds starter app definitions", () => {
    const definitions = scaffoldBlankApp("field-reports", "Field Reports", "report", "Report", "person:alice");
    expect(databaseForAppId("field-reports")).toBe("field-reports_app");
    expect(definitions.map((definition) => definition._id)).toEqual([
      "acl:rules",
      "app:config",
      "audit:policy",
      "form:report",
      "view:report"
    ]);
    expect(definitions.find((definition) => definition._id === "app:config")).toMatchObject({
      appId: "field-reports",
      database: "field-reports_app"
    });
    expect(definitions.find((definition) => definition._id === "acl:rules")).toMatchObject({
      entries: [{ principal: "person:alice", level: "manager" }]
    });
  });
});
