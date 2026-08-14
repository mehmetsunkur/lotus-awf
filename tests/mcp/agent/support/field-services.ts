import type { APIRequestContext, PlaywrightWorkerArgs } from "@playwright/test";
import { ALICE_AUTH, type AgentMcpHost } from "./mcp-host";
import { connectHttpMcp, type LotusHttpMcpClient } from "../../http/support/http-client";
import { installTemplateFixture, loadTemplateFixture, type AppTemplateFixture } from "./testbed";

export const FIELD_PASSWORD = "password123";

export const FIELD_SERVICES_FIXTURE: AppTemplateFixture = {
  fixtureId: "field-services-multi",
  sourceTemplate: loadTemplateFixture("tests/mcp/agent/fixtures/field-services/template.json"),
  appId: "agent-field-services",
  title: "Agent Field Services",
  starterDocType: "service-request",
  starterDocTypeTitle: "Service Request"
};

export const FIELD_PERSONAS = {
  dana: {
    username: "dana",
    displayName: "Dana Dispatch",
    title: "Dispatch Coordinator",
    groups: ["dispatch", "managers"]
  },
  taylor: {
    username: "taylor",
    displayName: "Taylor Tech",
    title: "Field Technician",
    groups: ["technicians"]
  },
  iris: {
    username: "iris",
    displayName: "Iris Inventory",
    title: "Inventory Coordinator",
    groups: ["inventory"]
  },
  blake: {
    username: "blake",
    displayName: "Blake Billing",
    title: "Billing Specialist",
    groups: ["billing"]
  }
} as const;

export type FieldPersonaName = keyof typeof FIELD_PERSONAS;

export type FieldScenario = {
  appId: string;
};

export const FIELD_STAFF_GROUPS = [
  "group:dispatch",
  "group:technicians",
  "group:inventory",
  "group:billing",
  "group:managers"
];

export const FIELD_JOB_DESCRIPTIONS: Record<FieldPersonaName, string> = {
  dana:
    "As Dispatch Coordinator you work the dispatch queue for service requests. Convert triaged requests into " +
    "scheduled work orders assigned to the named technician, preserving the customer, site, service type, date, " +
    "estimated hours, work notes, and billable hours from the request. Work everything waiting on dispatch and " +
    "leave technician, inventory, and billing work to those teams.",
  taylor:
    "As Field Technician you work your technician schedule and your assigned work-order queue. Start scheduled " +
    "work orders assigned to you. When the work notes say a part is required, create a parts reservation for the " +
    "named part, request parts on the work order, and stop that work order until Inventory allocates the part. " +
    "Never complete a work order that still needs a required part. When parts are ready, pick up the allocated " +
    "reservation and complete the work order if the work notes and billable hours are present. Leave dispatch and " +
    "billing work to those teams.",
  iris:
    "As Inventory Coordinator you work parts reservations waiting on inventory. Allocate requested parts when the " +
    "needed part is available, then mark the linked work order's parts ready so the technician can resume. Leave " +
    "technician completion and billing work to those teams.",
  blake:
    "As Billing Specialist you work completed work orders waiting on billing. Create an invoice for each completed " +
    "work order using the billable hours at 180 per hour, then mark the invoice ready and send it. Leave service " +
    "requests, parts, and technician work to those teams."
};

type Json = Record<string, unknown>;

export async function requestJson<T = Json>(
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

export async function adminApiContext(
  playwright: PlaywrightWorkerArgs["playwright"],
  baseURL: string
): Promise<APIRequestContext> {
  const context = await playwright.request.newContext({ baseURL });
  const login = await context.post("/api/session/login", {
    data: { username: "alice", password: FIELD_PASSWORD }
  });
  if (!login.ok()) throw new Error(`/api/session/login alice failed with status ${login.status()}`);
  return context;
}

export async function fieldPersonaContext(
  playwright: PlaywrightWorkerArgs["playwright"],
  baseURL: string,
  username: FieldPersonaName
): Promise<APIRequestContext> {
  const context = await playwright.request.newContext({ baseURL });
  const login = await context.post("/api/session/login", {
    data: { username, password: FIELD_PASSWORD }
  });
  if (!login.ok()) throw new Error(`/api/session/login ${username} failed with status ${login.status()}`);
  return context;
}

export async function seedFieldServices(
  playwright: PlaywrightWorkerArgs["playwright"],
  apiUrl: string,
  host: AgentMcpHost,
  contexts: APIRequestContext[],
  mcpClients: LotusHttpMcpClient[]
): Promise<{
  admin: APIRequestContext;
  scenario: FieldScenario;
  as: (username: FieldPersonaName) => Promise<APIRequestContext>;
}> {
  const admin = await adminApiContext(playwright, apiUrl);
  contexts.push(admin);

  const directory = await requestJson<{
    people: Array<{ username: string }>;
    groups: Array<{ _id: string; members: string[] }>;
  }>(admin, "get", "/api/names/directory");
  const existingPeople = new Set(directory.people.map((person) => person.username));
  const groupsById = new Map(directory.groups.map((group) => [group._id, group]));

  for (const persona of Object.values(FIELD_PERSONAS)) {
    if (!existingPeople.has(persona.username)) {
      await requestJson(admin, "post", "/api/names/people", {
        username: persona.username,
        displayName: persona.displayName,
        password: FIELD_PASSWORD
      });
    }
  }

  const groupNames: Record<string, string> = {
    dispatch: "Dispatch",
    technicians: "Technicians",
    inventory: "Inventory",
    billing: "Billing",
    managers: "Managers"
  };
  const membersOf = (slug: string) =>
    Object.values(FIELD_PERSONAS)
      .filter((persona) => persona.groups.includes(slug as never))
      .map((persona) => `person:${persona.username}`);
  for (const slug of ["dispatch", "technicians", "inventory", "billing", "managers"]) {
    const existing = groupsById.get(`group:${slug}`);
    if (existing) {
      await requestJson(admin, "put", `/api/names/groups/${slug}`, {
        members: Array.from(new Set([...existing.members, ...membersOf(slug)]))
      });
    } else {
      await requestJson(admin, "post", "/api/names/groups", { slug, name: groupNames[slug], members: membersOf(slug) });
    }
  }

  const adminMcp = await connectHttpMcp(host.surfaceUrl("admin"), ALICE_AUTH);
  const designerMcp = await connectHttpMcp(host.surfaceUrl("designer"), ALICE_AUTH);
  mcpClients.push(adminMcp, designerMcp);
  await installTemplateFixture(adminMcp, designerMcp, FIELD_SERVICES_FIXTURE);

  return {
    admin,
    scenario: { appId: FIELD_SERVICES_FIXTURE.appId },
    as: async (username) => {
      const context = await fieldPersonaContext(playwright, apiUrl, username);
      contexts.push(context);
      return context;
    }
  };
}

export async function seedFieldServicesHandbook(
  admin: APIRequestContext,
  as: (username: FieldPersonaName) => Promise<APIRequestContext>,
  fieldAppId: string
): Promise<{ kbAppId: string }> {
  const kbAppId = "field-services-kb";
  await requestJson(
    admin,
    "post",
    "/api/platform/apps",
    { appId: kbAppId, title: "Northstar Field Services Handbook", fromTemplate: "kb" },
    [201]
  );

  await requestJson(admin, "put", `/api/apps/${kbAppId}/access`, {
    entries: [
      { principal: "group:admins", level: "manager" },
      { principal: "group:dispatch", level: "author" },
      { principal: "group:technicians", level: "author" },
      { principal: "group:inventory", level: "author" },
      { principal: "group:billing", level: "author" },
      { principal: "group:managers", level: "reader" }
    ]
  });

  const kbDefinitions = await requestJson<{ forms: Array<Json & { _id: string }> }>(
    admin,
    "get",
    `/api/apps/${kbAppId}/definitions`
  );
  const articleForm = kbDefinitions.forms.find((definition) => definition._id === "form:article");
  if (!articleForm) throw new Error("field services handbook is missing form:article");
  // ADR-0024: article visibility is carried by the template's shipped
  // `aclRole:"reader"` computed-once field (was `defaultReaders`). Re-point that
  // field's formula instead of appending a duplicate `aclReaders` field.
  const articleFields = articleForm.fields as Array<Json & { aclRole?: string }>;
  const repointedArticleFields = articleFields.map((field) =>
    field.aclRole === "reader" ? { ...field, formula: JSON.stringify(FIELD_STAFF_GROUPS) } : field
  );
  if (!repointedArticleFields.some((field) => field.aclRole === "reader")) {
    throw new Error("field services handbook form:article is missing its aclRole:\"reader\" field");
  }
  await requestJson(admin, "put", `/api/apps/${kbAppId}/definitions/${encodeURIComponent("form:article")}`, {
    ...articleForm,
    fields: repointedArticleFields
  });

  await requestJson(
    admin,
    "post",
    `/api/apps/${kbAppId}/documents`,
    {
      docType: "article",
      payload: {
        title: "Welcome to Northstar Field Services",
        body:
          "Northstar Field Services coordinates customer service requests across Dispatch, Technicians, " +
          "Inventory, and Billing. Company systems by app id:\n" +
          `- "${kbAppId}" - this handbook: articles for everyone, procedures for your team.\n` +
          `- "${fieldAppId}" - field service operations: service requests, work orders, parts reservations, and invoices.\n` +
          "Start your day from your queue views and your team's procedures. Do only the work owned by your role."
      }
    },
    [201]
  );
  await requestJson(
    admin,
    "post",
    `/api/apps/${kbAppId}/documents`,
    {
      docType: "article",
      payload: {
        title: "How work moves through Field Services",
        body:
          "A service request is triaged by Dispatch, converted into a work order, worked by the assigned " +
          "technician, routed to Inventory when parts are needed, returned to the technician when parts are ready, " +
          "completed by the technician, and invoiced by Billing."
      }
    },
    [201]
  );

  const procedures: Array<{ username: FieldPersonaName; department: string; title: string; body: string }> = [
    {
      username: "dana",
      department: "dispatch",
      title: "Dispatch procedure",
      body:
        "Work service requests assigned to Dispatch. For a triaged request, create one scheduled work order. " +
        "Use the request's customer, site, requested date, estimated hours, work notes, billable hours, service type, " +
        "technician, and required part fields. After the work order exists, convert the service request."
    },
    {
      username: "taylor",
      department: "technicians",
      title: "Technician procedure",
      body:
        "Work orders assigned to you name you in the Technician field. Start scheduled work. If Required part is " +
        "present in the work notes, create one parts reservation with that part number and quantity one, then request " +
        "parts on the work order and stop until Inventory allocates the part. Do not complete a required-part work " +
        "order from in-progress. When a linked parts reservation is allocated, pick it up and complete the work order."
    },
    {
      username: "iris",
      department: "inventory",
      title: "Inventory procedure",
      body:
        "Work requested parts reservations. Allocate available stock, then move the linked work order from needs-parts " +
        "to parts-ready. Do not complete work orders; technicians do that after pickup."
    },
    {
      username: "blake",
      department: "billing",
      title: "Billing procedure",
      body:
        "Work completed work orders assigned to Billing. Create one invoice per completed work order for billable hours " +
        "times 180, using a due date thirty days after the scheduled date when available. Mark each invoice ready, then send it."
    }
  ];
  for (const procedure of procedures) {
    const author = await as(procedure.username);
    await requestJson(
      author,
      "post",
      `/api/apps/${kbAppId}/documents`,
      {
        docType: "procedure",
        payload: { title: procedure.title, department: procedure.department, body: procedure.body }
      },
      [201]
    );
  }

  return { kbAppId };
}
