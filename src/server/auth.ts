import { scrypt as scryptCallback, timingSafeEqual, randomBytes, createHash } from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response } from "express";
import type { PasswordParams, PersonDocument, PublicPerson } from "../shared/types";

const scrypt = promisify(scryptCallback);

export const SESSION_COOKIE = "lotus_session";
export const PASSWORD_PARAMS: PasswordParams = { algorithm: "scrypt", keyLength: 64 };

export { normalizeUsername, personIdForUsername } from "../shared/directory";

export async function hashPassword(password: string, salt = randomBytes(16).toString("base64")) {
  const derived = (await scrypt(password, salt, PASSWORD_PARAMS.keyLength)) as Buffer;
  return {
    passwordHash: derived.toString("base64"),
    passwordSalt: salt,
    passwordParams: PASSWORD_PARAMS
  };
}

export async function verifyPassword(password: string, person: PersonDocument): Promise<boolean> {
  if (person.passwordParams.algorithm !== "scrypt") return false;
  const derived = (await scrypt(password, person.passwordSalt, person.passwordParams.keyLength)) as Buffer;
  const expected = Buffer.from(person.passwordHash, "base64");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

export function sessionTokenFromRequest(request: Request): string | undefined {
  return parseCookies(request)[SESSION_COOKIE];
}

export function setSessionCookie(response: Response, token: string, expires: string, secure = false): void {
  const cookie = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    ...(secure ? ["Secure"] : []),
    `Expires=${new Date(expires).toUTCString()}`
  ];
  response.setHeader("Set-Cookie", cookie.join("; "));
}

export function clearSessionCookie(response: Response, secure = false): void {
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; ${secure ? "Secure; " : ""}Max-Age=0`
  );
}

export function publicPerson(person: PersonDocument): PublicPerson {
  return {
    _id: person._id,
    kind: "person",
    username: person.username,
    displayName: person.displayName,
    active: person.active
  };
}
