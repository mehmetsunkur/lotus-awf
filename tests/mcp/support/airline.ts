import type { APIRequestContext, PlaywrightWorkerArgs } from "@playwright/test";
import { AIRLINE_PASSWORD, seedAgenticAirlines } from "../../e2e/support/scenario-agentic-airlines";
import type { AirlineScenario, AirlinePersonaName } from "../../e2e/support/scenario-agentic-airlines";

/**
 * Agentic Airlines helpers for the MCP tiers (M26). The scenario fixture itself
 * lives with the browser e2e suite (tests/e2e/support/scenario-agentic-airlines)
 * and is re-exported here unchanged; this module adds the glue the MCP per-worker
 * harness needs — an admin request context (the e2e suites get theirs from the
 * `resetState` page fixture, which the MCP suites don't have) and Bearer-token
 * minting per persona for the MCP HTTP host. Shared by the scripted http tier and
 * the agent tier, so it must not depend on tests/mcp/agent/**.
 */

export {
  AIRLINE_PERSONAS,
  AIRLINE_PASSWORD,
  airlinePersonaContext,
  seedAgenticAirlines
} from "../../e2e/support/scenario-agentic-airlines";
export type { AirlineScenario, AirlinePersonaName } from "../../e2e/support/scenario-agentic-airlines";

/**
 * A fresh admin-session request context against the worker's API — login as
 * alice (the seeded dev admin), mirroring `airlinePersonaContext`. Satisfies the
 * "authenticated admin-session request context" contract of `seedAgenticAirlines`.
 * Callers dispose it themselves.
 */
export async function adminApiContext(
  playwright: PlaywrightWorkerArgs["playwright"],
  baseURL: string
): Promise<APIRequestContext> {
  const context = await playwright.request.newContext({ baseURL });
  const login = await context.post("/api/session/login", {
    data: { username: "alice", password: "password123" }
  });
  if (!login.ok()) throw new Error(`/api/session/login alice failed with status ${login.status()}`);
  return context;
}

/**
 * Seed the airline on top of this worker's `/api/reset` state (the auto
 * `resetState` fixture must have run). Returns the admin context alongside the
 * scenario so specs can keep using it for admin-level reads/pre-staging —
 * callers dispose `admin` themselves.
 */
export async function seedAirlineForWorker(
  playwright: PlaywrightWorkerArgs["playwright"],
  apiBaseURL: string
): Promise<{ admin: APIRequestContext; scenario: AirlineScenario }> {
  const admin = await adminApiContext(playwright, apiBaseURL);
  const scenario = await seedAgenticAirlines(admin);
  return { admin, scenario };
}

/**
 * Mint a `lotus_session` Bearer token for one airline persona, so an MCP HTTP
 * session can authenticate as that persona (`Authorization: Bearer <token>`).
 * Must run after `seedAgenticAirlines` has created the persona in the directory.
 * Mirrors mintSessionToken in tests/mcp/agent/support/mcp-host.ts — duplicated
 * rather than imported so this shared tier stays independent of the agent tier.
 */
export async function personaBearer(apiBaseURL: string, username: AirlinePersonaName): Promise<string> {
  const response = await fetch(`${apiBaseURL}/api/session/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: AIRLINE_PASSWORD })
  });
  if (!response.ok) throw new Error(`Lotus login failed (${response.status}) minting a token for ${username}`);
  const token = /lotus_session=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
  if (!token) throw new Error(`Lotus login for ${username} succeeded but returned no lotus_session cookie`);
  return token;
}
