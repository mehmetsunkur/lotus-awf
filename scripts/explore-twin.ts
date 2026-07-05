import { request } from "@playwright/test";
import type { PlaywrightWorkerArgs } from "@playwright/test";
import { startHarness } from "../tests/support/harness";
import { seedDigitalTwin, TWIN_FLIGHTS } from "../tests/e2e/support/scenario-digital-twin";
import { AIRLINE_PASSWORD, AIRLINE_PERSONAS } from "../tests/e2e/support/scenario-agentic-airlines";

/**
 * Boot a throwaway lotus stack and seed the M27 digital-twin world into it, for
 * manual exploring — the same isolated harness the e2e/agent suites use (private
 * CouchDB pair via testcontainers + a local Express serving the built SPA), so it
 * works wherever the tests do and needs no docker-compose or fixed ports. The
 * morning state is exactly what a working-day agent shift sees. Ctrl+C tears
 * everything down.
 *
 *   npm run build        # once, if dist/ is stale
 *   npm run explore:twin
 */
async function main(): Promise<void> {
  console.log("Starting isolated CouchDB pair + Express (testcontainers)...");
  const harness = await startHarness();
  const shutdown = async () => {
    console.log("\nTearing down...");
    await harness.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const admin = await request.newContext({ baseURL: harness.baseURL });
  const reset = await admin.post("/api/reset");
  if (!reset.ok()) throw new Error(`/api/reset failed with status ${reset.status()}`);
  const login = await admin.post("/api/session/login", { data: { username: "alice", password: "password123" } });
  if (!login.ok()) throw new Error(`alice login failed with status ${login.status()}`);

  console.log("Seeding the digital-twin world (airline + kb + turnaround + morning state)...");
  // seedDigitalTwin only uses `playwright.request.newContext`, which the standalone
  // `request` export provides — same shim idea as scripts/seed-airline.ts.
  const playwrightShim = { request } as unknown as PlaywrightWorkerArgs["playwright"];
  const twin = await seedDigitalTwin(admin, playwrightShim, harness.baseURL);
  await admin.dispose();

  console.log(`
Digital twin is up: ${harness.baseURL}

Apps:
  /${twin.orgAppId}.nsf           org chart + job descriptions
  /${twin.kbAppId}.nsf            handbook (articles + team procedures)
  /${twin.turnaroundAppId}.nsf    flights (morning state staged)
  /${twin.leaveRequestAppId}.nsf  leave requests
  /expense.nsf                    expenses (two submitted, either side of the limit)

Log in as any persona (password "${AIRLINE_PASSWORD}"):`);
  for (const persona of Object.values(AIRLINE_PERSONAS)) {
    console.log(`  ${persona.username.padEnd(6)} ${persona.displayName} — ${persona.jobTitle}`);
  }
  console.log(`  alice  (admin, password "password123")

Morning state (flight → staged state):`);
  for (const [key, flight] of Object.entries(TWIN_FLIGHTS)) {
    console.log(`  ${flight.flightNumber} (${key}) — ${flight.stagedState}`);
  }
  console.log(`
Things to try:
  - carol: Turnaround "My Queue" shows ${TWIN_FLIGHTS.alpha.flightNumber} + ${TWIN_FLIGHTS.delta.flightNumber}; assign crew / dispatch.
  - ivy:   the group queue shows ${TWIN_FLIGHTS.bravo.flightNumber}; ramp-check it (or flag a fault).
  - grace: expense queue has one compliant and one over-limit claim; the finance
           procedure in the handbook says which is which. She cannot open Turnaround.
  - dave:  reads the flight-ops procedure in the handbook, but not ground-ops' or finance's.

Ctrl+C stops and removes everything.`);
  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
