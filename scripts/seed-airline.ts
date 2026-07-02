import { request } from "@playwright/test";
import {
  AIRLINE_DEPARTMENTS,
  AIRLINE_PASSWORD,
  AIRLINE_PERSONAS,
  seedAgenticAirlines
} from "../tests/e2e/support/scenario-agentic-airlines";

/**
 * Seed the Agentic Airlines PLC scenario (M25) into a RUNNING platform for
 * manual testing — dev (`npm run test:serve`) or a deploy-compose artifact.
 * Reuses the e2e fixture, so seeding goes through the same public HTTP APIs.
 *
 *   API_URL=http://localhost:3001 ADMIN_USER=alice ADMIN_PASSWORD=password123 \
 *     npm run seed:airline
 *
 * Env:
 *   API_URL         target server (default http://localhost:3001)
 *   ADMIN_USER      admin username to seed with (default alice — the dev/reset admin)
 *   ADMIN_PASSWORD  admin password (default password123)
 *   ORG_APP_ID      appId for the org app (default org)
 *   LEAVE_APP_ID    appId for the leave-request app (default leave-request)
 *   RESET=1         POST /api/reset first (dev/e2e servers only; wipes state)
 */
const API_URL = process.env.API_URL ?? `http://localhost:${process.env.API_PORT ?? 3001}`;
const ADMIN_USER = process.env.ADMIN_USER ?? "alice";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "password123";
const ORG_APP_ID = process.env.ORG_APP_ID ?? "org";
const LEAVE_APP_ID = process.env.LEAVE_APP_ID ?? "leave-request";

async function main(): Promise<void> {
  const admin = await request.newContext({ baseURL: API_URL });
  try {
    if (process.env.RESET === "1") {
      const reset = await admin.post("/api/reset");
      if (!reset.ok()) throw new Error(`/api/reset -> ${reset.status()} (only dev/e2e servers expose it)`);
      console.log("Reset complete.");
    }

    const login = await admin.post("/api/session/login", {
      data: { username: ADMIN_USER, password: ADMIN_PASSWORD }
    });
    if (!login.ok()) {
      throw new Error(`Login as ${ADMIN_USER} failed (${login.status()}). Set ADMIN_USER/ADMIN_PASSWORD.`);
    }

    const scenario = await seedAgenticAirlines(admin, { orgAppId: ORG_APP_ID, leaveRequestAppId: LEAVE_APP_ID });

    console.log(`\nAgentic Airlines PLC seeded at ${API_URL}`);
    console.log(`  Org app:            /${scenario.orgAppId}.nsf`);
    console.log(`  Leave requests app: /${scenario.leaveRequestAppId}.nsf`);
    console.log(`\nPersonas (password: ${AIRLINE_PASSWORD}):`);
    const heads = new Map<string, (typeof AIRLINE_DEPARTMENTS)[number]>(
      AIRLINE_DEPARTMENTS.map((dept) => [dept.slug, dept])
    );
    for (const persona of Object.values(AIRLINE_PERSONAS)) {
      const dept = heads.get(persona.department);
      // Reporting line derives from department.head: your head, or the parent
      // department's head if you are the head (blank at the top).
      const manager = dept?.head === persona.username ? heads.get(dept.parent)?.head : dept?.head;
      const reports = manager ? ` → reports to ${manager}` : " (top of the chain)";
      console.log(`  ${persona.username.padEnd(6)} ${persona.jobTitle} [${persona.groups.join(", ")}]${reports}`);
    }
    console.log("\nTry: log in as dave, file a leave request in the Leave Requests app and submit it;");
    console.log("then log in as carol (or erin/grace) and approve it from the Pending Approval view.");
  } finally {
    await admin.dispose();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
