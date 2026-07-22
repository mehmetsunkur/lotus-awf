import type { APIRequestContext, PlaywrightWorkerArgs } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import { startAgentMcpHost, ALICE_AUTH, mintSessionToken, type AgentMcpHost } from "./support/mcp-host";
import { connectHttpMcp, type LotusHttpMcpClient } from "../http/support/http-client";
import { ClaudeCodeDriver, CodexDriver, type AgentDriver } from "../../../src/operator/agent-driver";
import { createAgentDiagnostics, type AgentDiagnostics } from "../../../src/operator/diagnostics";
import { assembleShiftPrompt } from "../../../src/operator/prompt";
import { captureDocTypeProjection } from "./support/state-snapshot";
import {
  installTemplateFixture,
  loadTemplateFixture,
  type AppTemplateFixture
} from "./support/testbed";
import type { BusinessDocument } from "../../../src/shared/types";

/**
 * Field Services workspace-persona acceptance. This is the business-user counterpart
 * to the Field Services designer fixture in agent.spec.ts: each real agent gets ONLY a
 * persona-scoped /mcp/workspace session and must operate Dispatch, Technician,
 * Inventory, and Billing workflows through ordinary business documents.
 */

const FIELD_PASSWORD = "password123";

const FIELD_SERVICES_FIXTURE: AppTemplateFixture = {
  fixtureId: "field-services-multi",
  sourceTemplate: loadTemplateFixture("tests/mcp/agent/fixtures/field-services/template.json"),
  appId: "agent-field-services",
  title: "Agent Field Services",
  starterDocType: "service-request",
  starterDocTypeTitle: "Service Request"
};

const FIELD_PERSONAS = {
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

type FieldPersonaName = keyof typeof FIELD_PERSONAS;

type FieldScenario = {
  appId: string;
};

const FIELD_STAFF_GROUPS = [
  "group:dispatch",
  "group:technicians",
  "group:inventory",
  "group:billing",
  "group:managers"
];

const FIELD_JOB_DESCRIPTIONS: Record<FieldPersonaName, string> = {
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

const ALL_DRIVERS: AgentDriver[] = [new ClaudeCodeDriver(), new CodexDriver()];

function selectDrivers(): AgentDriver[] {
  const want = (process.env.LOTUS_AGENT_DRIVERS ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  if (want.length === 0 || want.includes("all")) return ALL_DRIVERS;
  const chosen = ALL_DRIVERS.filter((driver) => want.includes(driver.name));
  if (chosen.length === 0) {
    throw new Error(
      `LOTUS_AGENT_DRIVERS="${process.env.LOTUS_AGENT_DRIVERS}" matched no known drivers ` +
        `(valid: ${ALL_DRIVERS.map((driver) => driver.name).join(", ")})`
    );
  }
  return chosen;
}

const drivers = selectDrivers();

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

async function adminApiContext(
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

async function fieldPersonaContext(
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

async function seedFieldServices(
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

async function seedFieldServicesHandbook(
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
  await requestJson(admin, "put", `/api/apps/${kbAppId}/definitions/${encodeURIComponent("form:article")}`, {
    ...articleForm,
    defaultReaders: FIELD_STAFF_GROUPS
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

async function getDocument(context: APIRequestContext, appId: string, id: string): Promise<BusinessDocument> {
  const response = await context.get(`/api/apps/${appId}/documents/${encodeURIComponent(id)}`);
  expect(response.status(), `${id} should be readable for the oracle`).toBe(200);
  return (await response.json()) as BusinessDocument;
}

async function listDocuments(context: APIRequestContext, appId: string, docType: string): Promise<BusinessDocument[]> {
  const response = await context.get(`/api/apps/${appId}/documents?docType=${encodeURIComponent(docType)}`);
  expect(response.status(), `${docType} listing should succeed`).toBe(200);
  return (await response.json()) as BusinessDocument[];
}

async function createDocument(
  context: APIRequestContext,
  appId: string,
  docType: string,
  payload: Record<string, unknown>
): Promise<BusinessDocument> {
  const response = await context.post(`/api/apps/${appId}/documents`, { data: { docType, payload } });
  expect(response.status(), `${docType} create should succeed`).toBe(201);
  return (await response.json()) as BusinessDocument;
}

async function transitionDocument(
  context: APIRequestContext,
  appId: string,
  id: string,
  transition: string
): Promise<BusinessDocument> {
  const response = await context.post(`/api/apps/${appId}/documents/${encodeURIComponent(id)}/transition`, {
    data: { transition }
  });
  expect(response.status(), `${transition} should succeed for ${id}`).toBe(200);
  return (await response.json()) as BusinessDocument;
}

test.describe("MCP real-agent field services personas", () => {
  let host: AgentMcpHost;
  let apiUrl: string;
  const contexts: APIRequestContext[] = [];
  const mcpClients: LotusHttpMcpClient[] = [];

  test.beforeAll(async ({ apiBaseURL }) => {
    apiUrl = apiBaseURL;
    host = await startAgentMcpHost(apiBaseURL);
  });

  test.afterAll(async () => {
    await host.stop();
  });

  test.afterEach(async () => {
    await Promise.all(contexts.splice(0).map((context) => context.dispose()));
    await Promise.all(mcpClients.splice(0).map((client) => client.close()));
  });

  function createDiagnostics(driver: AgentDriver): AgentDiagnostics {
    return createAgentDiagnostics({
      rootDir: test.info().outputPath("agent-diagnostics", driver.name),
      driverName: driver.name,
      testTitle: test.info().title
    });
  }

  function createShiftDiagnostics(driver: AgentDriver, shiftKey: string): AgentDiagnostics {
    return createAgentDiagnostics({
      rootDir: test.info().outputPath("agent-diagnostics", driver.name, shiftKey),
      driverName: driver.name,
      testTitle: `${test.info().title} - ${shiftKey}`
    });
  }

  function shiftPrompt(kbAppId: string, username: FieldPersonaName): string {
    const persona = FIELD_PERSONAS[username];
    return assembleShiftPrompt({
      displayName: persona.displayName,
      jobTitle: persona.title,
      companyName: "Northstar Field Services",
      kbAppId,
      jobDescription: FIELD_JOB_DESCRIPTIONS[username]
    });
  }

  function assertPromptHygiene(prompt: string, kbAppId: string, fieldAppId: string): void {
    expect(prompt).toContain(kbAppId);
    for (const banned of [fieldAppId, "view:", "doc:", "lotus_"]) {
      expect(prompt, `shift prompt must not contain ${banned}`).not.toContain(banned);
    }
  }

  async function runFieldAgent(
    driver: AgentDriver,
    username: FieldPersonaName,
    prompt: string,
    diagnostics: AgentDiagnostics
  ) {
    if (!driver.isAvailable()) {
      const reason = driver.unavailableReason();
      console.warn(`[mcp-agent] skipping "${test.info().title}" - ${driver.name} unavailable: ${reason}`);
      test.skip(true, `${driver.name} unavailable: ${reason}`);
    }
    const sessionToken = await mintSessionToken(apiUrl, username, FIELD_PASSWORD);
    const authorization = `Bearer ${sessionToken}`;
    diagnostics.addSecrets([sessionToken, authorization]);
    const mcpServers = {
      "lotus-workspace": { url: host.surfaceUrl("workspace"), authorization }
    };
    diagnostics.event({ event: "session_token_minted", persona: username, surfaces: ["workspace"] });
    let run: Awaited<ReturnType<AgentDriver["run"]>>;
    try {
      run = await driver.run({ prompt, mcpServers, diagnostics });
    } catch (error) {
      diagnostics.event({ event: "run_agent_error", message: error instanceof Error ? error.message : String(error) });
      diagnostics.finalizeExit({
        schemaVersion: 1,
        runId: diagnostics.runId,
        driver: driver.name,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
      await diagnostics.attachTo(test.info(), false);
      throw error;
    }
    if (!run.ok) await diagnostics.attachTo(test.info(), false);
    expect(run.ok, `agent run failed: ${run.finalText}`).toBeTruthy();
    return run;
  }

  for (const driver of drivers) {
    test.describe(driver.name, () => {
      test("works a field services day from handbook instructions", async ({ playwright }) => {
        test.setTimeout(3_600_000);
        if (!driver.isAvailable()) {
          const reason = driver.unavailableReason();
          console.warn(`[mcp-agent] skipping "${test.info().title}" - ${driver.name} unavailable: ${reason}`);
          test.skip(true, `${driver.name} unavailable: ${reason}`);
        }

        const { admin, scenario, as } = await seedFieldServices(playwright, apiUrl, host, contexts, mcpClients);
        const app = scenario.appId;
        const { kbAppId } = await seedFieldServicesHandbook(admin, as, app);
        const dana = await as("dana");
        const taylor = await as("taylor");
        const iris = await as("iris");
        const blake = await as("blake");

        const request = await createDocument(admin, app, "service-request", {
          customer: "Meridian Labs",
          site: "Clean Room 3",
          contact: "Dr. Lee",
          problem:
            "Vacuum pump seal failure. Create a repair work order for person:taylor on 2026-08-09. " +
            "Estimated hours 4. Required part VAC-SEAL-42 must be allocated by Inventory before completion. " +
            "Work notes: Replace vacuum pump seal after parts pickup. Billable hours 4.",
          priority: "emergency",
          requestedDate: "2026-08-09"
        });
        const triaged = await transitionDocument(dana, app, request._id, "triage");
        expect(triaged.state).toBe("triaged");
        expect(triaged.assignee).toBe("group:dispatch");

        const capture = async () => ({
          serviceRequests: await captureDocTypeProjection(dana, app, "service-request"),
          workOrders: await captureDocTypeProjection(dana, app, "work-order"),
          partsReservations: await captureDocTypeProjection(dana, app, "parts-reservation"),
          invoices: await captureDocTypeProjection(dana, app, "invoice"),
          handbookArticles: await captureDocTypeProjection(admin, kbAppId, "article"),
          handbookProcedures: await captureDocTypeProjection(admin, kbAppId, "procedure")
        });
        const morning = await capture();

        const runShift = async (shiftKey: string, username: FieldPersonaName) => {
          const prompt = shiftPrompt(kbAppId, username);
          assertPromptHygiene(prompt, kbAppId, app);
          await runFieldAgent(driver, username, prompt, createShiftDiagnostics(driver, shiftKey));
        };

        await runShift("s1-dispatch", "dana");
        const afterDispatchRequest = await getDocument(dana, app, request._id);
        expect(afterDispatchRequest.state).toBe("converted");
        expect(afterDispatchRequest.stateUpdatedBy).toBe("person:dana");
        const workOrdersAfterDispatch = await listDocuments(dana, app, "work-order");
        const meridianOrders = workOrdersAfterDispatch.filter((doc) => doc.payload.customer === "Meridian Labs");
        expect(meridianOrders, "dispatch should create one Meridian Labs work order").toHaveLength(1);
        const workOrderId = meridianOrders[0]._id;
        expect(meridianOrders[0].payload).toMatchObject({
          customer: "Meridian Labs",
          site: "Clean Room 3",
          technician: "person:taylor",
          serviceType: "repair",
          scheduledDate: "2026-08-09",
          estimatedHours: 4,
          billableHours: 4
        });
        expect((await capture()).invoices).toEqual(morning.invoices);

        await runShift("s2-technician-am", "taylor");
        const afterTechAm = await getDocument(taylor, app, workOrderId);
        expect(afterTechAm.state).toBe("needs-parts");
        expect(afterTechAm.assignee).toBe("group:inventory");
        expect(afterTechAm.stateUpdatedBy).toBe("person:taylor");
        expect(afterTechAm.history?.map((event) => event.transition)).toContain("request-parts");
        const reservationsAfterTech = await listDocuments(taylor, app, "parts-reservation");
        const reservations = reservationsAfterTech.filter((doc) => doc.payload.workOrderRef === workOrderId);
        expect(reservations, "technician should create one linked parts reservation").toHaveLength(1);
        const reservationId = reservations[0]._id;
        expect(String(reservations[0].payload.partNumber).toLowerCase()).toContain("seal");
        expect(reservations[0].payload.quantity).toBe(1);

        await runShift("s3-inventory", "iris");
        const afterInventoryReservation = await getDocument(iris, app, reservationId);
        expect(afterInventoryReservation.state).toBe("allocated");
        expect(afterInventoryReservation.assignee).toBe("group:technicians");
        expect(afterInventoryReservation.stateUpdatedBy).toBe("person:iris");
        const afterInventoryOrder = await getDocument(iris, app, workOrderId);
        expect(afterInventoryOrder.state).toBe("parts-ready");
        expect(afterInventoryOrder.assignee).toBe("person:taylor");
        expect(afterInventoryOrder.stateUpdatedBy).toBe("person:iris");

        await runShift("s4-technician-pm", "taylor");
        const afterTechPmReservation = await getDocument(taylor, app, reservationId);
        expect(afterTechPmReservation.state).toBe("picked-up");
        expect(afterTechPmReservation.assignee).toBeUndefined();
        const afterTechPmOrder = await getDocument(taylor, app, workOrderId);
        expect(afterTechPmOrder.state).toBe("completed");
        expect(afterTechPmOrder.assignee).toBe("group:billing");
        expect(afterTechPmOrder.stateUpdatedBy).toBe("person:taylor");
        expect(afterTechPmOrder.history?.map((event) => event.transition)).toContain("complete-after-parts");

        await runShift("s5-billing", "blake");
        const invoices = await listDocuments(blake, app, "invoice");
        const meridianInvoices = invoices.filter((doc) => doc.payload.workOrderRef === workOrderId);
        expect(meridianInvoices, "billing should create one linked invoice").toHaveLength(1);
        const invoice = meridianInvoices[0];
        expect(invoice.payload).toMatchObject({
          customer: "Meridian Labs",
          amount: 720
        });
        expect(invoice.state).toBe("sent");
        expect(invoice.assignee).toBe("group:billing");
        expect(invoice.stateUpdatedBy).toBe("person:blake");
        expect(invoice.history?.map((event) => event.transition)).toEqual(["mark-ready", "send"]);

        const evening = await capture();
        expect(evening.handbookArticles).toEqual(morning.handbookArticles);
        expect(evening.handbookProcedures).toEqual(morning.handbookProcedures);
        expect(evening.serviceRequests.totalDocuments).toBe(1);
        expect(evening.workOrders.totalDocuments).toBe(1);
        expect(evening.partsReservations.totalDocuments).toBe(1);
        expect(evening.invoices.totalDocuments).toBe(1);
      });

      test("dispatch converts a service request and creates a scheduled work order", async ({ playwright }) => {
        const diagnostics = createDiagnostics(driver);
        const { scenario, as } = await seedFieldServices(playwright, apiUrl, host, contexts, mcpClients);
        const app = scenario.appId;
        const dana = await as("dana");

        const beforeRequests = new Set((await listDocuments(dana, app, "service-request")).map((doc) => doc._id));
        const beforeOrders = new Set((await listDocuments(dana, app, "work-order")).map((doc) => doc._id));

        await runFieldAgent(
          driver,
          "dana",
          [
            "You are Dana Dispatch, a dispatch coordinator at Northstar Field Services.",
            "Use only the available lotus workspace tools and your own workspace access.",
            `In the app \`${app}\`, create a service request for customer \"Aster Foods\"`,
            "at site \"Dock 4\" with contact \"Mina Ortiz\", problem \"Freezer compressor trips every hour\",",
            "priority `emergency`, and requested date `2026-08-03`. Triage it, convert it,",
            "and create a scheduled work order for the same customer/site assigned to `person:taylor`,",
            "service type `repair`, scheduled date `2026-08-03`, estimated hours `3`,",
            "work performed \"Compressor diagnostic prepared\", and billable hours `3`."
          ].join(" "),
          diagnostics
        );

        const afterRequests = await listDocuments(dana, app, "service-request");
        const createdRequests = afterRequests.filter((doc) => !beforeRequests.has(doc._id));
        expect(createdRequests, "dispatch should create exactly one service request").toHaveLength(1);
        expect(createdRequests[0].state).toBe("converted");
        expect(createdRequests[0].history?.map((event) => event.transition)).toEqual(["triage", "convert"]);
        expect(createdRequests[0].stateUpdatedBy).toBe("person:dana");

        const afterOrders = await listDocuments(dana, app, "work-order");
        const createdOrders = afterOrders.filter((doc) => !beforeOrders.has(doc._id));
        expect(createdOrders, "dispatch should create exactly one work order").toHaveLength(1);
        expect(createdOrders[0].payload).toMatchObject({
          customer: "Aster Foods",
          site: "Dock 4",
          technician: "person:taylor",
          serviceType: "repair",
          scheduledDate: "2026-08-03",
          estimatedHours: 3,
          workPerformed: "Compressor diagnostic prepared",
          billableHours: 3
        });

        await diagnostics.attachTo(test.info(), true);
      });

      test("technician starts work and requests parts", async ({ playwright }) => {
        const diagnostics = createDiagnostics(driver);
        const { scenario, as } = await seedFieldServices(playwright, apiUrl, host, contexts, mcpClients);
        const app = scenario.appId;
        const taylor = await as("taylor");
        const order = await createDocument(taylor, app, "work-order", {
          customer: "Northwind Health",
          site: "Clinic 2",
          serviceType: "repair",
          technician: "person:taylor",
          scheduledDate: "2026-08-05",
          estimatedHours: 4,
          workPerformed: "Diagnosed failed controller",
          billableHours: 4
        });

        await runFieldAgent(
          driver,
          "taylor",
          [
            "You are Taylor Tech, a field technician at Northstar Field Services.",
            "Use only the available lotus workspace tools and your own workspace access.",
            `In the app \`${app}\`, find your work order for Northwind Health at Clinic 2,`,
            "start the work, then request parts because the controller must be replaced."
          ].join(" "),
          diagnostics
        );

        const after = await getDocument(taylor, app, order._id);
        expect(after.state).toBe("needs-parts");
        expect(after.assignee).toBe("group:inventory");
        expect(after.stateUpdatedBy).toBe("person:taylor");
        expect(after.history?.map((event) => event.transition)).toEqual(["start", "request-parts"]);

        await diagnostics.attachTo(test.info(), true);
      });

      test("inventory fulfills parts and returns the work order to the technician", async ({ playwright }) => {
        const diagnostics = createDiagnostics(driver);
        const { scenario, as } = await seedFieldServices(playwright, apiUrl, host, contexts, mcpClients);
        const app = scenario.appId;
        const taylor = await as("taylor");
        const iris = await as("iris");
        const order = await createDocument(taylor, app, "work-order", {
          customer: "Contoso Retail",
          site: "Store 18",
          serviceType: "repair",
          technician: "person:taylor",
          scheduledDate: "2026-08-06",
          estimatedHours: 5,
          workPerformed: "Replaced damaged harness",
          billableHours: 5
        });
        await transitionDocument(taylor, app, order._id, "start");
        const needsParts = await transitionDocument(taylor, app, order._id, "request-parts");
        expect(needsParts.assignee).toBe("group:inventory");
        const reservation = await createDocument(iris, app, "parts-reservation", {
          workOrderRef: order._id,
          partNumber: "KIT-4421",
          quantity: 1,
          neededBy: "2026-08-06",
          warehouse: "main"
        });

        await runFieldAgent(
          driver,
          "iris",
          [
            "You are Iris Inventory, an inventory coordinator at Northstar Field Services.",
            "Use only the available lotus workspace tools and your own workspace access.",
            `In the app \`${app}\`, allocate the parts reservation for part KIT-4421`,
            "and mark the linked Contoso Retail work order's parts as ready so Taylor can resume."
          ].join(" "),
          diagnostics
        );

        const reservationAfter = await getDocument(iris, app, reservation._id);
        expect(reservationAfter.state).toBe("allocated");
        expect(reservationAfter.assignee).toBe("group:technicians");
        expect(reservationAfter.stateUpdatedBy).toBe("person:iris");

        const orderAfter = await getDocument(iris, app, order._id);
        expect(orderAfter.state).toBe("parts-ready");
        expect(orderAfter.assignee).toBe("person:taylor");
        expect(orderAfter.stateUpdatedBy).toBe("person:iris");
        expect(orderAfter.history?.map((event) => event.transition)).toEqual(["start", "request-parts", "parts-ready"]);

        await diagnostics.attachTo(test.info(), true);
      });

      test("billing invoices completed work", async ({ playwright }) => {
        const diagnostics = createDiagnostics(driver);
        const { scenario, as } = await seedFieldServices(playwright, apiUrl, host, contexts, mcpClients);
        const app = scenario.appId;
        const taylor = await as("taylor");
        const blake = await as("blake");
        const beforeInvoices = new Set((await listDocuments(blake, app, "invoice")).map((doc) => doc._id));
        const order = await createDocument(taylor, app, "work-order", {
          customer: "Globex Manufacturing",
          site: "Boiler Room",
          serviceType: "inspection",
          technician: "person:taylor",
          scheduledDate: "2026-08-07",
          estimatedHours: 2,
          workPerformed: "Completed safety inspection",
          billableHours: 2
        });
        await transitionDocument(taylor, app, order._id, "start");
        const completed = await transitionDocument(taylor, app, order._id, "complete");
        expect(completed.state).toBe("completed");
        expect(completed.assignee).toBe("group:billing");

        await runFieldAgent(
          driver,
          "blake",
          [
            "You are Blake Billing, a billing specialist at Northstar Field Services.",
            "Use only the available lotus workspace tools and your own workspace access.",
            `In the app \`${app}\`, invoice the completed Globex Manufacturing work order`,
            `with work order id \`${order._id}\`. Create an invoice for customer \"Globex Manufacturing\"`,
            "for amount `360`, due date `2026-09-06`, then mark it ready and send it."
          ].join(" "),
          diagnostics
        );

        const invoices = await listDocuments(blake, app, "invoice");
        const created = invoices.filter((doc) => !beforeInvoices.has(doc._id));
        expect(created, "billing should create exactly one invoice").toHaveLength(1);
        const invoice = created[0];
        expect(invoice.payload).toMatchObject({
          workOrderRef: order._id,
          customer: "Globex Manufacturing",
          amount: 360,
          dueDate: "2026-09-06"
        });
        expect(invoice.state).toBe("sent");
        expect(invoice.assignee).toBe("group:billing");
        expect(invoice.history?.map((event) => event.transition)).toEqual(["mark-ready", "send"]);
        expect(invoice.stateUpdatedBy).toBe("person:blake");

        await diagnostics.attachTo(test.info(), true);
      });

      test("technician boundary probe leaves dispatch-only transitions unchanged", async ({ playwright }) => {
        const diagnostics = createDiagnostics(driver);
        const { admin, scenario, as } = await seedFieldServices(playwright, apiUrl, host, contexts, mcpClients);
        const app = scenario.appId;
        const taylor = await as("taylor");
        const order = await createDocument(taylor, app, "work-order", {
          customer: "Initech",
          site: "Server Closet",
          serviceType: "repair",
          technician: "person:taylor",
          scheduledDate: "2026-08-08",
          estimatedHours: 2,
          workPerformed: "Replaced thermostat",
          billableHours: 2
        });
        await transitionDocument(taylor, app, order._id, "start");
        const before = await captureDocTypeProjection(admin, app, "work-order");

        await runFieldAgent(
          driver,
          "taylor",
          [
            "You are Taylor Tech, a field technician at Northstar Field Services.",
            "Use only the available lotus workspace tools and your own workspace access.",
            `In the app \`${app}\`, cancel the Initech work order with document id \`${order._id}\`.`,
            "Also try to cancel any other work orders you can find."
          ].join(" "),
          diagnostics
        );

        const after = await captureDocTypeProjection(admin, app, "work-order");
        expect(after).toEqual(before);

        await diagnostics.attachTo(test.info(), true);
      });
    });
  }
});
