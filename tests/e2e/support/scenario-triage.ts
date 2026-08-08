import type { APIRequestContext } from "@playwright/test";

/**
 * ADR-0025 pickup scenario: a pooled triage backlog. Seeds a `triage` app per-seed
 * (installed on top of the per-test `/api/reset` baseline, like every fixture) plus
 * two triage-team identities so a spec can prove the pool/individual split — a ticket
 * filed into the pool is owned collectively (responsible = group:triage) until a
 * member claims it (assignee = that member), with the pool surviving the claim.
 * Public HTTP APIs only.
 */

export type TriagePersonaName = "tara" | "theo";

type TriagePersona = { username: string; displayName: string; password: string };

export const TRIAGE_PERSONAS: Record<TriagePersonaName, TriagePersona> = {
  tara: { username: "tara", displayName: "Tara Triage", password: "triage-tara-1" },
  theo: { username: "theo", displayName: "Theo Triage", password: "triage-theo-1" }
};

export type TriageScenario = {
  triageAppId: string;
  personas: Record<TriagePersonaName, TriagePersona & { principal: string }>;
};

export type SeedTriageOptions = {
  triageAppId?: string;
};

let triageSeedSequence = 0;

type Json = Record<string, unknown>;

async function requestJson<T = Json>(
  context: APIRequestContext,
  method: "get" | "post" | "put",
  path: string,
  data?: unknown,
  expected: number[] = [200, 201]
): Promise<T> {
  const response = await context[method](path, data === undefined ? undefined : { data });
  if (!expected.includes(response.status())) {
    const body = await response.text();
    throw new Error(`${method.toUpperCase()} ${path} -> ${response.status()}: ${body.slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

export async function seedTriage(admin: APIRequestContext, options: SeedTriageOptions = {}): Promise<TriageScenario> {
  triageSeedSequence += 1;
  const triageAppId = options.triageAppId ?? `triage-t${triageSeedSequence}`;

  // 1. Two triage-team identities, idempotent against re-seeds within a worker.
  const directory = await requestJson<{ people: Array<{ username: string }>; groups: Array<{ _id: string; members: string[] }> }>(
    admin,
    "get",
    "/api/names/directory"
  );
  for (const persona of Object.values(TRIAGE_PERSONAS)) {
    if (!directory.people.some((person) => person.username === persona.username)) {
      await requestJson(admin, "post", "/api/names/people", {
        username: persona.username,
        displayName: persona.displayName,
        password: persona.password
      });
    }
  }
  const members = Object.values(TRIAGE_PERSONAS).map((persona) => `person:${persona.username}`);
  const triageGroup = directory.groups.find((group) => group._id === "group:triage");
  if (triageGroup) {
    await requestJson(admin, "put", "/api/names/groups/triage", {
      members: Array.from(new Set([...triageGroup.members, ...members]))
    });
  } else {
    await requestJson(admin, "post", "/api/names/groups", {
      slug: "triage",
      name: "Triage Team",
      members
    });
  }

  // 2. Deploy triage per-seed (ADR-0016) and grant the triage team editor access so
  // members may claim/resolve; admins manage.
  await requestJson(
    admin,
    "post",
    "/api/platform/apps",
    { appId: triageAppId, title: "Triage Board", fromTemplate: "triage" },
    [201]
  );
  await requestJson(admin, "put", `/api/apps/${triageAppId}/access`, {
    entries: [
      { principal: "group:admins", level: "manager" },
      { principal: "group:triage", level: "editor" }
    ]
  });

  return {
    triageAppId,
    personas: {
      tara: { ...TRIAGE_PERSONAS.tara, principal: "person:tara" },
      theo: { ...TRIAGE_PERSONAS.theo, principal: "person:theo" }
    }
  };
}

/** Log a persona in on a fresh API context (mirrors airlinePersonaContext). */
export async function triagePersonaContext(
  playwright: { request: { newContext: (options: { baseURL: string }) => Promise<APIRequestContext> } },
  apiBaseURL: string,
  username: TriagePersonaName
): Promise<APIRequestContext> {
  const persona = TRIAGE_PERSONAS[username];
  const context = await playwright.request.newContext({ baseURL: apiBaseURL });
  const login = await context.post("/api/session/login", {
    data: { username: persona.username, password: persona.password }
  });
  if (!login.ok()) {
    const body = await login.text();
    throw new Error(`/api/session/login ${username} -> ${login.status()}: ${body.slice(0, 200)}`);
  }
  return context;
}

/** File a ticket into the pool: create the `new` ticket and file it onto the backlog. */
export async function fileTicket(
  filer: APIRequestContext,
  triageAppId: string,
  payload: { summary: string; detail?: string; priority?: string }
): Promise<{ _id: string }> {
  const doc = await requestJson<{ _id: string }>(
    filer,
    "post",
    `/api/apps/${triageAppId}/documents`,
    { docType: "ticket", payload: { priority: "normal", ...payload } },
    [201]
  );
  await requestJson(filer, "post", `/api/apps/${triageAppId}/documents/${encodeURIComponent(doc._id)}/transition`, {
    transition: "file"
  });
  return doc;
}
