import type { Server } from "node:http";
import type { APIRequestContext } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import { createHttpHost } from "../../../src/mcp/http-server";
import { httpHostConfigFromEnv } from "../../../src/mcp/http-config";
import { connectHttpMcp, type LotusHttpMcpClient } from "./support/http-client";
import {
  airlinePersonaContext,
  personaBearer,
  seedAirlineForWorker,
  type AirlinePersonaName,
  type AirlineScenario
} from "../support/airline";
import type { SessionState } from "../../../src/shared/types";

/**
 * Persona identity over /mcp/workspace (M26 P1, scripted): the M25 airline
 * fixture seeded through the MCP per-worker harness, personas authenticating to
 * the HTTP host with minted `lotus_session` Bearer tokens. Proves per-session
 * identity, the ADR-0020 `@me` inbox, and workspace surface confinement with
 * the scripted StreamableHTTP client — the substrate the agent-tier persona
 * scenarios (tests/mcp/agent/personas.spec.ts) rely on.
 */

type Doc = { _id: string; state?: string; payload: Record<string, unknown> };

test.describe("Airline personas over /mcp/workspace", () => {
  let host: ReturnType<typeof createHttpHost>;
  let server: Server;
  let port: number;
  const clients: LotusHttpMcpClient[] = [];
  const apiContexts: APIRequestContext[] = [];

  const surfaceUrl = (surface: string) => `http://localhost:${port}/mcp/${surface}`;

  // The in-process host binds to this worker's locally-spawned API (worker fixture).
  test.beforeAll(async ({ apiBaseURL }) => {
    host = createHttpHost({ ...httpHostConfigFromEnv(), apiUrl: apiBaseURL });
    server = await new Promise<Server>((resolve) => {
      const s = host.app.listen(0, () => resolve(s));
    });
    port = (server.address() as { port: number }).port;
  });

  test.afterAll(async () => {
    host.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // State reset is handled by the auto `resetState` fixture (tests/mcp/support/fixtures.ts).

  test.afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
    await Promise.all(apiContexts.splice(0).map((context) => context.dispose()));
  });

  /** Seed the airline on top of this test's reset state; contexts are disposed on test end. */
  async function seedAirline(
    playwright: Parameters<typeof seedAirlineForWorker>[0],
    apiBaseURL: string
  ): Promise<AirlineScenario> {
    const { admin, scenario } = await seedAirlineForWorker(playwright, apiBaseURL);
    apiContexts.push(admin);
    return scenario;
  }

  /** Open a workspace MCP session authenticated as one persona (Bearer token). */
  async function connectAsPersona(apiBaseURL: string, username: AirlinePersonaName): Promise<LotusHttpMcpClient> {
    const token = await personaBearer(apiBaseURL, username);
    const client = await connectHttpMcp(surfaceUrl("workspace"), `Bearer ${token}`);
    clients.push(client);
    return client;
  }

  /** Pre-stage (scripted, per the M26 contract): a persona files and submits a leave request. */
  async function fileAndSubmit(
    playwright: Parameters<typeof airlinePersonaContext>[0],
    apiBaseURL: string,
    scenario: AirlineScenario,
    username: AirlinePersonaName,
    payload: Record<string, unknown>
  ): Promise<Doc> {
    const persona = await airlinePersonaContext(playwright, apiBaseURL, username);
    apiContexts.push(persona);
    const app = scenario.leaveRequestAppId;
    const created = await persona.post(`/api/apps/${app}/documents`, {
      data: { docType: "leave-request", payload }
    });
    expect(created.status(), `${username} should file a leave request`).toBe(201);
    const doc = (await created.json()) as Doc;
    const submitted = await persona.post(`/api/apps/${app}/documents/${encodeURIComponent(doc._id)}/transition`, {
      data: { transition: "submit" }
    });
    expect(submitted.status(), `${username} should submit the request`).toBe(200);
    return doc;
  }

  test("resolves a persona's identity server-side from its Bearer session", async ({ playwright, apiBaseURL }) => {
    await seedAirline(playwright, apiBaseURL);

    const daveMcp = await connectAsPersona(apiBaseURL, "dave");
    const session = await daveMcp.callJsonTool<SessionState>("lotus_workspace_get_session");

    expect(session.authenticated).toBe(true);
    expect(session.person?.username).toBe("dave");
    expect(session.groups).toContain("group:flight-ops");
    // The full principal set flows from the session (never from the caller).
    expect(session.principals).toEqual(expect.arrayContaining(["person:dave", "group:flight-ops"]));
    expect(session.principals).not.toContain("group:managers");
  });

  test("ADR-0020 @me: the my-approvals inbox routes by responsible per MCP session", async ({
    playwright,
    apiBaseURL
  }) => {
    const scenario = await seedAirline(playwright, apiBaseURL);

    // Pre-staged via the plain API: dave files and submits, responsible = carol
    // (ADR-0018/0019 stamp the department head on submit).
    const request = await fileAndSubmit(playwright, apiBaseURL, scenario, "dave", {
      type: "annual",
      from: "2026-09-07",
      to: "2026-09-18",
      reason: "Family visit to Istanbul"
    });

    // Carol's MCP session sees exactly that one request in her personal inbox…
    const carolMcp = await connectAsPersona(apiBaseURL, "carol");
    const inbox = await carolMcp.callJsonTool<Doc[]>("lotus_workspace_query_view", {
      appId: scenario.leaveRequestAppId,
      viewId: "view:my-approvals"
    });
    expect(inbox.map((doc) => doc._id)).toEqual([request._id]);
    expect(inbox[0].state).toBe("submitted");
    expect(inbox[0].payload).toMatchObject({ approver: "person:carol", department: "flight-ops" });

    // …while erin (a manager, but not the responsible) gets an empty inbox for the
    // SAME view id — `@me` resolved per session identity, not per view.
    const erinMcp = await connectAsPersona(apiBaseURL, "erin");
    const erinInbox = await erinMcp.callJsonTool<Doc[]>("lotus_workspace_query_view", {
      appId: scenario.leaveRequestAppId,
      viewId: "view:my-approvals"
    });
    expect(erinInbox).toEqual([]);
  });

  test("confines a workspace session to the workspace toolset", async ({ playwright, apiBaseURL }) => {
    await seedAirline(playwright, apiBaseURL);

    const daveMcp = await connectAsPersona(apiBaseURL, "dave");
    const tools = await daveMcp.listTools();

    expect(tools).toContain("lotus_workspace_get_session");
    expect(tools).toContain("lotus_workspace_query_view");
    // The workspace surface offers ONLY workspace tools — no admin/designer leakage.
    for (const tool of tools) {
      expect(tool, "workspace surface must expose only lotus_workspace_* tools").toMatch(/^lotus_workspace_/);
    }
  });
});
