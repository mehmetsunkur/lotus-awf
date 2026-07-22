import type { APIRequestContext, PlaywrightWorkerArgs } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import { startAgentMcpHost, ALICE_AUTH, mintSessionToken, type AgentMcpHost } from "./support/mcp-host";
import { connectHttpMcp, type LotusHttpMcpClient } from "../http/support/http-client";
import { ClaudeCodeDriver, CodexDriver, type AgentDriver } from "../../../src/operator/agent-driver";
import { createAgentDiagnostics, type AgentDiagnostics } from "../../../src/operator/diagnostics";
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
