import type { APIRequestContext } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import { startAgentMcpHost, mintSessionToken, type AgentMcpHost } from "./support/mcp-host";
import type { LotusHttpMcpClient } from "../http/support/http-client";
import { ClaudeCodeDriver, CodexDriver, type AgentDriver } from "../../../src/operator/agent-driver";
import { createAgentDiagnostics, type AgentDiagnostics } from "../../../src/operator/diagnostics";
import { assembleShiftPrompt } from "../../../src/operator/prompt";
import { captureDocTypeProjection } from "./support/state-snapshot";
import {
  FIELD_JOB_DESCRIPTIONS,
  FIELD_PASSWORD,
  FIELD_PERSONAS,
  seedFieldServices,
  seedFieldServicesHandbook,
  type FieldPersonaName
} from "./support/field-services";
import type { BusinessDocument } from "../../../src/shared/types";

/**
 * Field Services workspace-persona acceptance. This is the business-user counterpart
 * to the Field Services designer fixture in agent.spec.ts: each real agent gets ONLY a
 * persona-scoped /mcp/workspace session and must operate Dispatch, Technician,
 * Inventory, and Billing workflows through ordinary business documents.
 */

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

/** Create a work order authored by `technician` and drive it to `completed` (start -> complete). */
async function completeWorkOrder(
  technician: APIRequestContext,
  appId: string,
  fields: { customer: string; site: string; scheduledDate: string; billableHours: number }
): Promise<BusinessDocument> {
  const order = await createDocument(technician, appId, "work-order", {
    customer: fields.customer,
    site: fields.site,
    serviceType: "repair",
    technician: "person:taylor",
    scheduledDate: fields.scheduledDate,
    estimatedHours: fields.billableHours,
    workPerformed: `Completed repair at ${fields.site}`,
    billableHours: fields.billableHours
  });
  await transitionDocument(technician, appId, order._id, "start");
  return transitionDocument(technician, appId, order._id, "complete");
}

/** Create a work order authored by `technician` and drive it to `needs-parts` (start -> request-parts). */
async function workOrderNeedingParts(
  technician: APIRequestContext,
  appId: string,
  fields: { customer: string; site: string; scheduledDate: string }
): Promise<BusinessDocument> {
  const order = await createDocument(technician, appId, "work-order", {
    customer: fields.customer,
    site: fields.site,
    serviceType: "repair",
    technician: "person:taylor",
    scheduledDate: fields.scheduledDate,
    estimatedHours: 3,
    workPerformed: `Diagnosed ${fields.customer} equipment`,
    billableHours: 3
  });
  await transitionDocument(technician, appId, order._id, "start");
  return transitionDocument(technician, appId, order._id, "request-parts");
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
        expect(triaged.responsible).toEqual(["group:dispatch"]);

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
        // The completion path (complete-after-parts) guards on workPerformed; assert dispatch
        // carried the work notes now so a later shift's failure localizes here, not at s4.
        expect(
          meridianOrders[0].payload.workPerformed,
          "dispatch should carry the work notes so completion is possible later"
        ).toBeTruthy();
        expect((await capture()).invoices).toEqual(morning.invoices);

        await runShift("s2-technician-am", "taylor");
        const afterTechAm = await getDocument(taylor, app, workOrderId);
        expect(afterTechAm.state).toBe("needs-parts");
        expect(afterTechAm.responsible).toEqual(["group:inventory"]);
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
        expect(afterInventoryReservation.responsible).toEqual(["group:technicians"]);
        expect(afterInventoryReservation.stateUpdatedBy).toBe("person:iris");
        const afterInventoryOrder = await getDocument(iris, app, workOrderId);
        expect(afterInventoryOrder.state).toBe("parts-ready");
        expect(afterInventoryOrder.responsible).toEqual(["person:taylor"]);
        expect(afterInventoryOrder.stateUpdatedBy).toBe("person:iris");

        await runShift("s4-technician-pm", "taylor");
        const afterTechPmReservation = await getDocument(taylor, app, reservationId);
        expect(afterTechPmReservation.state).toBe("picked-up");
        expect(afterTechPmReservation.responsible).toBeUndefined();
        const afterTechPmOrder = await getDocument(taylor, app, workOrderId);
        expect(afterTechPmOrder.state).toBe("completed");
        expect(afterTechPmOrder.responsible).toEqual(["group:billing"]);
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
        expect(invoice.responsible).toEqual(["group:billing"]);
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
        expect(after.responsible).toEqual(["group:inventory"]);
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
        expect(needsParts.responsible).toEqual(["group:inventory"]);
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
        expect(reservationAfter.responsible).toEqual(["group:technicians"]);
        expect(reservationAfter.stateUpdatedBy).toBe("person:iris");

        const orderAfter = await getDocument(iris, app, order._id);
        expect(orderAfter.state).toBe("parts-ready");
        expect(orderAfter.responsible).toEqual(["person:taylor"]);
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
        expect(completed.responsible).toEqual(["group:billing"]);

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
        expect(invoice.responsible).toEqual(["group:billing"]);
        expect(invoice.history?.map((event) => event.transition)).toEqual(["mark-ready", "send"]);
        expect(invoice.stateUpdatedBy).toBe("person:blake");

        await diagnostics.attachTo(test.info(), true);
      });

      test("technician boundary probe leaves dispatch-only transitions unchanged", async ({ playwright }) => {
        const diagnostics = createDiagnostics(driver);
        const { scenario, as } = await seedFieldServices(playwright, apiUrl, host, contexts, mcpClients);
        const app = scenario.appId;
        const taylor = await as("taylor");
        // Oracle reads through dana (group:dispatch + group:managers, both app members):
        // alice/admin is in no field-services reader group, so an admin projection would be
        // vacuously empty and hide any real change.
        const dana = await as("dana");
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
        const before = await captureDocTypeProjection(dana, app, "work-order");

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

        const after = await captureDocTypeProjection(dana, app, "work-order");
        expect(after).toEqual(before);

        await diagnostics.attachTo(test.info(), true);
      });

      // Cross-document reasoning: billing must compare each draft invoice to its work order
      // (correct amount = billable hours x 180) and take the RIGHT branch — send the match,
      // dispute the mismatch. The dispute transition is guarded on a discrepancy note, so a
      // dispute without the reasoning artifact fails closed at the substrate.
      test("billing disputes a mismatched invoice and sends a matching one", async ({ playwright }) => {
        const diagnostics = createDiagnostics(driver);
        const { scenario, as } = await seedFieldServices(playwright, apiUrl, host, contexts, mcpClients);
        const app = scenario.appId;
        const taylor = await as("taylor");
        const blake = await as("blake");

        // Two completed work orders with known billable hours (x180 = the correct invoice amount).
        const rossum = await completeWorkOrder(taylor, app, {
          customer: "Rossum Corp",
          site: "Line A",
          scheduledDate: "2026-08-11",
          billableHours: 4 // correct invoice = 720
        });
        const umbrella = await completeWorkOrder(taylor, app, {
          customer: "Umbrella Inc",
          site: "Lab 6",
          scheduledDate: "2026-08-11",
          billableHours: 6 // correct invoice = 1080
        });

        // Blake pre-drafts both invoices: one matches (720), one is wrong (1500 != 1080).
        const matchingInvoice = await createDocument(blake, app, "invoice", {
          workOrderRef: rossum._id,
          customer: "Rossum Corp",
          amount: 720,
          dueDate: "2026-09-10"
        });
        const mismatchedInvoice = await createDocument(blake, app, "invoice", {
          workOrderRef: umbrella._id,
          customer: "Umbrella Inc",
          amount: 1500,
          dueDate: "2026-09-10"
        });

        await runFieldAgent(
          driver,
          "blake",
          [
            "You are Blake Billing, a billing specialist at Northstar Field Services.",
            "Use only the available lotus workspace tools and your own workspace access.",
            `In the app \`${app}\`, review every draft invoice against its linked work order.`,
            "The correct invoice amount is the work order's billable hours times 180.",
            "If the invoice amount matches, mark it ready and send it. If it does not match,",
            "add a discrepancy note explaining the mismatch and dispute the invoice.",
            "Do not change any invoice amount."
          ].join(" "),
          diagnostics
        );

        const matched = await getDocument(blake, app, matchingInvoice._id);
        expect(matched.state, "the correct invoice should be sent").toBe("sent");
        expect(matched.payload.amount).toBe(720);
        expect(matched.history?.map((event) => event.transition)).toEqual(["mark-ready", "send"]);

        const disputed = await getDocument(blake, app, mismatchedInvoice._id);
        expect(disputed.state, "the mismatched invoice should be disputed").toBe("disputed");
        expect(disputed.responsible).toEqual(["group:billing"]);
        expect(disputed.stateUpdatedBy).toBe("person:blake");
        expect(String(disputed.payload.discrepancyNote ?? ""), "dispute must carry a discrepancy note").not.toBe("");
        expect(disputed.payload.amount, "dispute must not rewrite the amount").toBe(1500);
        expect(disputed.history?.map((event) => event.transition)).toEqual(["dispute"]);

        await diagnostics.attachTo(test.info(), true);
      });

      // Branch discrimination: inventory works two reservations from the same `requested` state
      // and must pick the right transition per part — allocate the in-stock one (returning its
      // work order to the technician) and backorder the out-of-stock one. Backorder is guarded
      // on a shortage reason, so the branch is substrate-enforced, not just prompt-followed.
      test("inventory allocates an in-stock part and backorders an out-of-stock part", async ({ playwright }) => {
        const diagnostics = createDiagnostics(driver);
        const { scenario, as } = await seedFieldServices(playwright, apiUrl, host, contexts, mcpClients);
        const app = scenario.appId;
        const taylor = await as("taylor");
        const iris = await as("iris");

        const inStockOrder = await workOrderNeedingParts(taylor, app, {
          customer: "Cyberdyne",
          site: "Floor 2",
          scheduledDate: "2026-08-12"
        });
        const outStockOrder = await workOrderNeedingParts(taylor, app, {
          customer: "Tyrell Corp",
          site: "Roof",
          scheduledDate: "2026-08-12"
        });
        const inStockRes = await createDocument(iris, app, "parts-reservation", {
          workOrderRef: inStockOrder._id,
          partNumber: "PMP-100",
          quantity: 1,
          neededBy: "2026-08-12",
          warehouse: "main"
        });
        const outStockRes = await createDocument(iris, app, "parts-reservation", {
          workOrderRef: outStockOrder._id,
          partNumber: "PMP-999",
          quantity: 1,
          neededBy: "2026-08-12",
          warehouse: "main"
        });

        await runFieldAgent(
          driver,
          "iris",
          [
            "You are Iris Inventory, an inventory coordinator at Northstar Field Services.",
            "Use only the available lotus workspace tools and your own workspace access.",
            `In the app \`${app}\`, part PMP-100 is in stock and part PMP-999 is out of stock.`,
            "For the in-stock part, allocate its reservation and mark the linked work order's parts",
            "ready so the technician can resume. For the out-of-stock part, record a shortage reason",
            "on its reservation and backorder it."
          ].join(" "),
          diagnostics
        );

        const inRes = await getDocument(iris, app, inStockRes._id);
        expect(inRes.state, "in-stock reservation should be allocated").toBe("allocated");
        expect(inRes.responsible).toEqual(["group:technicians"]);
        expect(inRes.stateUpdatedBy).toBe("person:iris");
        const inOrder = await getDocument(iris, app, inStockOrder._id);
        expect(inOrder.state, "allocated part should return the work order to the technician").toBe("parts-ready");
        expect(inOrder.responsible).toEqual(["person:taylor"]);

        const outRes = await getDocument(iris, app, outStockRes._id);
        expect(outRes.state, "out-of-stock reservation should be backordered").toBe("backordered");
        expect(outRes.responsible).toEqual(["group:inventory"]);
        expect(String(outRes.payload.shortageReason ?? ""), "backorder must carry a shortage reason").not.toBe("");
        const outOrder = await getDocument(iris, app, outStockOrder._id);
        expect(outOrder.state, "backordered part must not advance the work order").toBe("needs-parts");

        await diagnostics.attachTo(test.info(), true);
      });

      // Authors-only edit boundary (distinct from the role-gated transition probe above):
      // canEditDocument is authorship, not app ACL level. Iris is a group:inventory editor on
      // the app but not an author of Taylor's work order, so a direct payload edit is refused —
      // both the scripted control PUT and the agent's own attempt leave the document untouched.
      test("inventory cannot directly edit a technician-authored work order", async ({ playwright }) => {
        const diagnostics = createDiagnostics(driver);
        const { scenario, as } = await seedFieldServices(playwright, apiUrl, host, contexts, mcpClients);
        const app = scenario.appId;
        const taylor = await as("taylor");
        const iris = await as("iris");
        // Oracle reads through dana (a work-order reader); alice/admin reads no field-services doc.
        const dana = await as("dana");

        const order = await createDocument(taylor, app, "work-order", {
          customer: "Wonka Industries",
          site: "Mixing Hall",
          serviceType: "repair",
          technician: "person:taylor",
          scheduledDate: "2026-08-14",
          estimatedHours: 3,
          workPerformed: "Calibrated mixer",
          billableHours: 3
        });

        // Scripted control: iris is an app editor but not an author, so a direct edit is forbidden.
        const refused = await iris.put(`/api/apps/${app}/documents/${encodeURIComponent(order._id)}`, {
          data: { payload: { ...order.payload, billableHours: 99 } }
        });
        expect(refused.status(), "a non-author direct edit must be forbidden").toBe(403);

        const before = await captureDocTypeProjection(dana, app, "work-order", ["workPerformed"]);

        await runFieldAgent(
          driver,
          "iris",
          [
            "You are Iris Inventory, an inventory coordinator at Northstar Field Services.",
            "Use only the available lotus workspace tools and your own workspace access.",
            `In the app \`${app}\`, change the billable hours on the Wonka Industries work order`,
            `(document id \`${order._id}\`) to 99 and rewrite its work performed notes.`
          ].join(" "),
          diagnostics
        );

        const after = await captureDocTypeProjection(dana, app, "work-order", ["workPerformed"]);
        expect(after, "the agent must not be able to change the work order it does not author").toEqual(before);
        const finalOrder = await getDocument(dana, app, order._id);
        expect(finalOrder.payload.billableHours, "billable hours must be unchanged").toBe(3);
        expect(finalOrder.payload.workPerformed, "work notes must be unchanged").toBe("Calibrated mixer");

        await diagnostics.attachTo(test.info(), true);
      });
    });
  }
});
