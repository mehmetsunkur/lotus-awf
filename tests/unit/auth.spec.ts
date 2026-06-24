import { describe, expect, it } from "vitest";
import type { Response } from "express";
import { clearSessionCookie, hashPassword, personIdForUsername, setSessionCookie, verifyPassword } from "../../src/server/auth";
import { hasAccessLevel, principalsFor, type PrincipalScope } from "../../src/shared/access";
import type { PersonDocument } from "../../src/shared/types";

describe("password hashing", () => {
  it("uses salted scrypt hashes and verifies matching passwords", async () => {
    const first = await hashPassword("password123");
    const second = await hashPassword("password123");
    expect(first.passwordHash).not.toBe(second.passwordHash);
    expect(first.passwordParams.algorithm).toBe("scrypt");

    const person: PersonDocument = {
      _id: "person:alice",
      kind: "person",
      username: "alice",
      displayName: "Alice",
      active: true,
      ...first,
      createdAt: "2026-06-22T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z"
    };

    await expect(verifyPassword("password123", person)).resolves.toBe(true);
    await expect(verifyPassword("wrong", person)).resolves.toBe(false);
  });

  it("normalizes usernames into person ids", () => {
    expect(personIdForUsername(" Alice Finance ")).toBe("person:alice-finance");
  });
});

describe("principal access helpers", () => {
  const scope: PrincipalScope = {
    person: "person:alice",
    groups: ["group:finance"],
    principals: ["person:alice", "group:finance"],
    accessLevel: "designer"
  };

  it("deduplicates person and group principals", () => {
    expect(principalsFor(scope)).toEqual(["person:alice", "group:finance"]);
  });

  it("compares access levels by rank", () => {
    expect(hasAccessLevel(scope, "author")).toBe(true);
    expect(hasAccessLevel(scope, "designer")).toBe(true);
    expect(hasAccessLevel(scope, "manager")).toBe(false);
  });
});

describe("session cookies", () => {
  function responseHeaders() {
    const headers = new Map<string, string>();
    const response = {
      setHeader(name: string, value: string) {
        headers.set(name, value);
        return response as Response;
      }
    } as Pick<Response, "setHeader">;
    return {
      headers,
      response: response as Response
    };
  }

  it("adds Secure only when production cookie security is enabled", () => {
    const { headers: insecureHeaders, response: insecureResponse } = responseHeaders();
    setSessionCookie(insecureResponse, "token", "2026-06-24T00:00:00.000Z");
    expect(insecureHeaders.get("Set-Cookie")).toContain("HttpOnly; SameSite=Lax; Path=/; Expires=");
    expect(insecureHeaders.get("Set-Cookie")).not.toContain("Secure");

    const { headers: secureHeaders, response: secureResponse } = responseHeaders();
    setSessionCookie(secureResponse, "token", "2026-06-24T00:00:00.000Z", true);
    expect(secureHeaders.get("Set-Cookie")).toContain("Secure; Expires=");
  });

  it("clears Secure cookies with the matching flag", () => {
    const { headers, response } = responseHeaders();
    clearSessionCookie(response, true);
    expect(headers.get("Set-Cookie")).toContain("Secure; Max-Age=0");
  });
});
