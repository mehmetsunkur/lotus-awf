import type { APIRequestContext, PlaywrightWorkerArgs } from "@playwright/test";

/**
 * Agentic Airlines PLC — a reusable multi-persona scenario for scripted-persona
 * e2e specs (M25). Seeded ON TOP of the per-test `/api/reset` state via the
 * public HTTP APIs only (names.nsf directory, create-app-from-template, M22
 * access editor, app-scoped documents), so every platform invariant (ACL,
 * validation, sessions) is enforced while seeding. Opt-in per spec — this is
 * deliberately NOT part of the `resetState` auto fixture.
 *
 * ACL design note: `readersForNewDocument` stamps a new document with the
 * creator's FULL principal set (person + all their groups). Personas therefore
 * belong to their department group only (plus `managers` for approvers) — a
 * shared `group:employees` membership would make every leave request readable
 * by every employee and defeat the scenario's isolation assertions. App access
 * for the departments is granted through the M22 access editor instead.
 */

export const AIRLINE_PASSWORD = "password123";

/** Groups the fixture treats as "all airline staff" for org-chart visibility. */
export const AIRLINE_STAFF_GROUPS = ["group:flight-ops", "group:cabin-crew", "group:finance", "group:managers"];

export type AirlinePersona = {
  username: string;
  displayName: string;
  jobTitle: string;
  /** Department slug in the org app (also the persona's directory group slug, except `managers`). */
  department: string;
  /** Directory group slugs this persona belongs to. */
  groups: string[];
};

/** `head` is the source of truth for reporting lines: an employee's manager is
 *  their department's head (or the parent department's head for a head),
 *  derived by the org form's `manager` formula field — nothing per-employee. */
export const AIRLINE_DEPARTMENTS = [
  { slug: "flight-ops", name: "Flight Operations", parent: "", head: "carol" },
  { slug: "cabin-crew", name: "Cabin Crew", parent: "flight-ops", head: "erin" },
  { slug: "finance", name: "Finance", parent: "", head: "grace" }
] as const;

export const AIRLINE_PERSONAS = {
  carol: {
    username: "carol",
    displayName: "Carol Kaptan",
    jobTitle: "Director of Flight Operations",
    department: "flight-ops",
    groups: ["flight-ops", "managers"]
  },
  dave: {
    username: "dave",
    displayName: "Dave Rudder",
    jobTitle: "First Officer",
    department: "flight-ops",
    groups: ["flight-ops"]
  },
  erin: {
    username: "erin",
    displayName: "Erin Galley",
    jobTitle: "Cabin Services Manager",
    department: "cabin-crew",
    groups: ["cabin-crew", "managers"]
  },
  frank: {
    username: "frank",
    displayName: "Frank Trolley",
    jobTitle: "Senior Cabin Crew",
    department: "cabin-crew",
    groups: ["cabin-crew"]
  },
  grace: {
    username: "grace",
    displayName: "Grace Ledger",
    jobTitle: "Finance Controller",
    department: "finance",
    groups: ["finance", "managers"]
  }
} satisfies Record<string, AirlinePersona>;

export type AirlinePersonaName = keyof typeof AIRLINE_PERSONAS;

export type AirlineScenario = {
  personas: typeof AIRLINE_PERSONAS;
  password: string;
  /** appId the org template was deployed under (unique per seed — see below). */
  orgAppId: string;
  /** appId the leave-request template was deployed under (unique per seed). */
  leaveRequestAppId: string;
  /** `_id`s of the org-app department documents created by the fixture, by slug. */
  departmentDocIds: Record<string, string>;
  /** `_id`s of the org-app employee documents created by the fixture, by username. */
  employeeDocIds: Record<AirlinePersonaName, string>;
};

export type SeedAirlineOptions = {
  /** Fixed appIds (e.g. `org` / `leave-request`) for manual/one-shot seeding;
   *  defaults to per-seed generated ids so repeated in-worker seeds don't
   *  collide (see below). */
  orgAppId?: string;
  leaveRequestAppId?: string;
};

/**
 * `/api/reset` recreates the directory and platform databases but leaves any
 * business-app database from an earlier test in this worker behind, so a fixed
 * appId would 409 on the second seed. Templates are appId-agnostic (ADR-0016),
 * so each seed deploys under a fresh per-worker appId instead.
 */
let seedSequence = 0;

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

/**
 * Seed the airline on top of `/api/reset` state. `admin` must be an
 * authenticated admin-session request context (the `resetState` fixture's
 * `page.request`, logged in as alice, qualifies). Platform `orgName` stays the
 * reset default — the airline identity lives in the directory and app data.
 */
export async function seedAgenticAirlines(
  admin: APIRequestContext,
  options: SeedAirlineOptions = {}
): Promise<AirlineScenario> {
  const personas = Object.values(AIRLINE_PERSONAS);
  seedSequence += 1;
  const orgAppId = options.orgAppId ?? `org-s${seedSequence}`;
  const leaveRequestAppId = options.leaveRequestAppId ?? `leave-request-s${seedSequence}`;

  // 1. People and groups in names.nsf. The directory is read first so seeding
  // also works against a manually set-up deployment (not just `/api/reset`
  // state): existing personas are skipped, and `finance` — seeded by reset but
  // absent on a fresh real setup — is created or updated as needed.
  const directory = await requestJson<{
    people: Array<{ username: string }>;
    groups: Array<{ _id: string; members: string[] }>;
  }>(admin, "get", "/api/names/directory");
  const existingPeople = new Set(directory.people.map((person) => person.username));
  const groupsById = new Map(directory.groups.map((group) => [group._id, group]));

  for (const persona of personas) {
    if (existingPeople.has(persona.username)) continue;
    await requestJson(admin, "post", "/api/names/people", {
      username: persona.username,
      displayName: persona.displayName,
      password: AIRLINE_PASSWORD
    });
  }

  const membersOf = (slug: string) =>
    personas.filter((persona) => persona.groups.includes(slug)).map((persona) => `person:${persona.username}`);
  for (const slug of ["managers", "flight-ops", "cabin-crew", "finance"]) {
    const name =
      slug === "managers" ? "Managers" : (AIRLINE_DEPARTMENTS.find((dept) => dept.slug === slug)?.name ?? "Finance");
    const existing = groupsById.get(`group:${slug}`);
    if (existing) {
      await requestJson(admin, "put", `/api/names/groups/${slug}`, {
        members: Array.from(new Set([...existing.members, ...membersOf(slug)]))
      });
    } else {
      await requestJson(admin, "post", "/api/names/groups", { slug, name, members: membersOf(slug) });
    }
  }

  // 3. Deploy the org and leave-request apps from their bundled templates
  // (expense is already seeded by /api/reset).
  await requestJson(
    admin,
    "post",
    "/api/platform/apps",
    { appId: orgAppId, title: "Agentic Airlines Org", fromTemplate: "org" },
    [201]
  );
  await requestJson(
    admin,
    "post",
    "/api/platform/apps",
    { appId: leaveRequestAppId, title: "Agentic Airlines Leave", fromTemplate: "leave-request" },
    [201]
  );

  // 4. Widen the org app for airline staff: app-level read access via the M22
  // access editor, and `defaultReaders` on both forms so the org chart the
  // fixture writes next is readable by every staff group (ADR-0015 mechanism;
  // the template's admin-only sample data is deliberately left untouched).
  await requestJson(admin, "put", `/api/apps/${orgAppId}/access`, {
    entries: [
      { principal: "group:admins", level: "manager" },
      ...AIRLINE_STAFF_GROUPS.map((principal) => ({ principal, level: "reader" }))
    ]
  });
  const orgDefinitions = await requestJson<{ forms: Array<Json & { _id: string }> }>(
    admin,
    "get",
    `/api/apps/${orgAppId}/definitions`
  );
  for (const formId of ["form:department", "form:employee"]) {
    const form = orgDefinitions.forms.find((definition) => definition._id === formId);
    if (!form) throw new Error(`org app is missing ${formId}`);
    await requestJson(admin, "put", `/api/apps/${orgAppId}/definitions/${encodeURIComponent(formId)}`, {
      ...form,
      defaultReaders: AIRLINE_STAFF_GROUPS
    });
  }

  // 5. App access for the business apps: department groups act as authors in
  // both leave-request and expense (the template's generic `group:employees`
  // entry stays inert — that group intentionally does not exist here).
  await requestJson(admin, "put", `/api/apps/${leaveRequestAppId}/access`, {
    entries: [
      { principal: "group:admins", level: "manager" },
      { principal: "group:managers", level: "editor" },
      { principal: "group:flight-ops", level: "author" },
      { principal: "group:cabin-crew", level: "author" },
      { principal: "group:finance", level: "author" }
    ]
  });
  // Expense is seeded by `/api/reset` but may be absent on a real deployment —
  // wire the crew groups in only when the app is installed.
  const expenseAccessResponse = await admin.get("/api/apps/expense/access");
  if (expenseAccessResponse.status() === 200) {
    const expenseAccess = (await expenseAccessResponse.json()) as { entries: Array<{ principal: string; level: string }> };
    await requestJson(admin, "put", "/api/apps/expense/access", {
      entries: [
        ...expenseAccess.entries,
        { principal: "group:flight-ops", level: "author" },
        { principal: "group:cabin-crew", level: "author" }
      ]
    });
  }

  // 6. Org chart: department and employee documents with the manager chain.
  const departmentDocIds: Record<string, string> = {};
  for (const dept of AIRLINE_DEPARTMENTS) {
    const doc = await requestJson<{ _id: string }>(
      admin,
      "post",
      `/api/apps/${orgAppId}/documents`,
      { docType: "department", payload: { name: dept.name, slug: dept.slug, parent: dept.parent, head: `person:${dept.head}` } },
      [201]
    );
    departmentDocIds[dept.slug] = doc._id;
  }
  const employeeDocIds = {} as Record<AirlinePersonaName, string>;
  for (const persona of personas) {
    const doc = await requestJson<{ _id: string }>(
      admin,
      "post",
      `/api/apps/${orgAppId}/documents`,
      {
        docType: "employee",
        payload: {
          person: `person:${persona.username}`,
          title: persona.jobTitle,
          department: persona.department
        }
      },
      [201]
    );
    employeeDocIds[persona.username as AirlinePersonaName] = doc._id;
  }

  return {
    personas: AIRLINE_PERSONAS,
    password: AIRLINE_PASSWORD,
    orgAppId,
    leaveRequestAppId,
    departmentDocIds,
    employeeDocIds
  };
}

/**
 * A fresh authenticated request context for one persona — its own cookie jar,
 * so it is a fully independent identity against the same worker server
 * (mirrors the `bobApi` fixture pattern). Callers dispose it themselves.
 */
export async function airlinePersonaContext(
  playwright: PlaywrightWorkerArgs["playwright"],
  baseURL: string,
  username: AirlinePersonaName
): Promise<APIRequestContext> {
  const context = await playwright.request.newContext({ baseURL });
  const login = await context.post("/api/session/login", {
    data: { username, password: AIRLINE_PASSWORD }
  });
  if (!login.ok()) throw new Error(`/api/session/login ${username} failed with status ${login.status()}`);
  return context;
}
