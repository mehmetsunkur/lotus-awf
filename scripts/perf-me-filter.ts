import { request } from "@playwright/test";
import { performance } from "node:perf_hooks";
import { ulid } from "ulid";
import type { BusinessDocument } from "../src/shared/types";
import { startHarness } from "../tests/support/harness";
import {
  AIRLINE_PASSWORD,
  AIRLINE_PERSONAS,
  seedAgenticAirlines,
  type AirlinePersonaName
} from "../tests/e2e/support/scenario-agentic-airlines";

type Options = {
  docs: number;
  submittedRatio: number;
  assignedRatio: number;
  createdRatio: number;
  runs: number;
  warmup: number;
  persona: AirlinePersonaName;
  json: boolean;
};

type TimedView = {
  view: string;
  count: number;
  index: string;
  latencies: number[];
};

const DEFAULTS: Options = {
  docs: 10_000,
  submittedRatio: 0.5,
  assignedRatio: 0.05,
  createdRatio: 0.05,
  runs: 20,
  warmup: 3,
  persona: "carol",
  json: false
};

const OTHER_CREATORS = ["person:dave", "person:frank", "person:hank", "person:ivy", "person:grace"];
const OTHER_ASSIGNEES = ["person:hank", "person:erin", "person:grace", "group:cabin-crew", "group:ground-ops", "group:finance"];

function usage(): never {
  console.log(`Usage: npm run perf:me-filter -- [options]

Options:
  --docs <n>                Synthetic leave-request docs to bulk insert (default ${DEFAULTS.docs})
  --submitted-ratio <0..1>  Fraction in submitted state (default ${DEFAULTS.submittedRatio})
  --assigned-ratio <0..1>   Fraction of submitted docs assigned to persona (default ${DEFAULTS.assignedRatio})
  --created-ratio <0..1>    Fraction of all docs created by persona (default: assigned-ratio)
  --runs <n>                Timed runs per view after warmup (default ${DEFAULTS.runs})
  --warmup <n>              Untimed warmup runs per view (default ${DEFAULTS.warmup})
  --persona <name>          Actor to query as: ${Object.keys(AIRLINE_PERSONAS).join(", ")} (default ${DEFAULTS.persona})
  --json                    Emit machine-readable JSON only
  --help                    Show this help
`);
  process.exit(0);
}

function parseArgs(argv: string[]): Options {
  const options: Options = { ...DEFAULTS };
  let createdRatioSet = false;

  const readValue = (index: number, flag: string) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") usage();
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--docs") {
      options.docs = Number(readValue(index, arg));
      index += 1;
      continue;
    }
    if (arg === "--submitted-ratio") {
      options.submittedRatio = Number(readValue(index, arg));
      index += 1;
      continue;
    }
    if (arg === "--assigned-ratio") {
      options.assignedRatio = Number(readValue(index, arg));
      index += 1;
      continue;
    }
    if (arg === "--created-ratio") {
      options.createdRatio = Number(readValue(index, arg));
      createdRatioSet = true;
      index += 1;
      continue;
    }
    if (arg === "--runs") {
      options.runs = Number(readValue(index, arg));
      index += 1;
      continue;
    }
    if (arg === "--warmup") {
      options.warmup = Number(readValue(index, arg));
      index += 1;
      continue;
    }
    if (arg === "--persona") {
      const value = readValue(index, arg);
      if (!(value in AIRLINE_PERSONAS)) throw new Error(`unknown persona: ${value}`);
      options.persona = value as AirlinePersonaName;
      index += 1;
      continue;
    }
    throw new Error(`unknown option: ${arg}`);
  }

  if (!createdRatioSet) options.createdRatio = options.assignedRatio;
  if (!Number.isInteger(options.docs) || options.docs < 0) throw new Error("--docs must be a non-negative integer");
  if (!Number.isInteger(options.runs) || options.runs < 1) throw new Error("--runs must be a positive integer");
  if (!Number.isInteger(options.warmup) || options.warmup < 0) throw new Error("--warmup must be a non-negative integer");
  for (const [name, value] of [
    ["--submitted-ratio", options.submittedRatio],
    ["--assigned-ratio", options.assignedRatio],
    ["--created-ratio", options.createdRatio]
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1`);
  }

  return options;
}

function personaPrincipals(persona: AirlinePersonaName): string[] {
  const definition = AIRLINE_PERSONAS[persona];
  return [`person:${definition.username}`, ...definition.groups.map((group) => `group:${group}`)];
}

function everyNth(index: number, ratio: number): boolean {
  if (ratio <= 0) return false;
  if (ratio >= 1) return true;
  return index % Math.max(1, Math.round(1 / ratio)) === 0;
}

function isoFromOffset(index: number): string {
  // Descending-ish timestamps keep the benchmark close to the runtime's updatedAt sort shape.
  return new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
}

function buildSyntheticDocs(options: Options, appId: string): BusinessDocument[] {
  const persona = AIRLINE_PERSONAS[options.persona];
  const actor = `person:${persona.username}`;
  const actorAssignee = actor;
  const actorDepartment = persona.department;

  return Array.from({ length: options.docs }, (_, index) => {
    const submitted = index < Math.round(options.docs * options.submittedRatio);
    const actorCreated = everyNth(index, options.createdRatio);
    const actorAssigned = submitted && everyNth(index, options.assignedRatio);
    const createdBy = actorCreated ? actor : OTHER_CREATORS[index % OTHER_CREATORS.length];
    const assignee = actorAssigned ? actorAssignee : OTHER_ASSIGNEES[index % OTHER_ASSIGNEES.length];
    const updatedAt = isoFromOffset(index);
    const payload = {
      type: index % 7 === 0 ? "sick" : index % 5 === 0 ? "unpaid" : "annual",
      from: "2026-09-01",
      to: "2026-09-05",
      reason: `Synthetic @me perf row ${index.toString().padStart(6, "0")}`,
      approver: assignee,
      department: actorAssigned ? actorDepartment : index % 2 === 0 ? "cabin-crew" : "ground-ops"
    };

    return {
      _id: `doc:leave-request:${ulid()}`,
      kind: "document",
      appId,
      docType: "leave-request",
      createdAt: updatedAt,
      updatedAt,
      createdBy,
      updatedBy: createdBy,
      authors: [createdBy],
      payload,
      state: submitted ? "submitted" : index % 3 === 0 ? "approved" : "draft",
      stateUpdatedAt: updatedAt,
      stateUpdatedBy: createdBy,
      history: submitted
        ? [{ transition: "submit", from: "draft", to: "submitted", at: updatedAt, by: createdBy, responsible: [assignee] }]
        : [],
      ...(submitted ? { responsible: [assignee], responsibleAt: updatedAt } : {})
    };
  });
}

async function couchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${url} -> ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

async function bulkInsert(localCouchUrl: string, db: string, docs: BusinessDocument[], chunkSize = 1_000): Promise<void> {
  const auth = `Basic ${Buffer.from("admin:password").toString("base64")}`;
  for (let index = 0; index < docs.length; index += chunkSize) {
    const chunk = docs.slice(index, index + chunkSize);
    await couchJson(`${localCouchUrl}/${db}/_bulk_docs`, {
      method: "POST",
      headers: { authorization: auth, "content-type": "application/json" },
      body: JSON.stringify({ docs: chunk })
    });
  }
}

async function explainIndex(
  localCouchUrl: string,
  db: string,
  view: "view:my-approvals" | "view:pending-approval" | "view:my-requests",
  principals: string[]
): Promise<string> {
  const auth = `Basic ${Buffer.from("admin:password").toString("base64")}`;
  const body =
    view === "view:my-approvals"
      ? {
          selector: {
            kind: "document",
            docType: { $eq: "leave-request" },
            state: { $eq: "submitted" },
            responsible: { $in: principals }
          },
          sort: [{ updatedAt: "desc" }],
          limit: 200,
          use_index: "m3-docType-state-updatedAt"
        }
      : view === "view:pending-approval"
        ? {
            selector: {
              kind: "document",
              docType: { $eq: "leave-request" },
              state: { $eq: "submitted" }
            },
            sort: [{ updatedAt: "desc" }],
            limit: 200,
            use_index: "m3-docType-state-updatedAt"
          }
        : {
            selector: {
              kind: "document",
              docType: { $eq: "leave-request" },
              createdBy: { $in: principals }
            },
            sort: [{ updatedAt: "desc" }],
            limit: 200,
            use_index: "m2-kind-docType-updatedAt"
          };
  const plan = await couchJson<{ index?: { name?: string } }>(`${localCouchUrl}/${db}/_explain`, {
    method: "POST",
    headers: { authorization: auth, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return plan.index?.name ?? "(unknown)";
}

async function timeView(
  context: Awaited<ReturnType<typeof request.newContext>>,
  appId: string,
  view: string,
  runs: number,
  warmup: number
): Promise<{ count: number; latencies: number[] }> {
  const path = `/api/apps/${appId}/views/${encodeURIComponent(view)}/documents`;
  let count = 0;
  for (let index = 0; index < warmup; index += 1) {
    const response = await context.get(path);
    if (!response.ok()) throw new Error(`${view} warmup -> ${response.status()}: ${await response.text()}`);
    count = ((await response.json()) as unknown[]).length;
  }

  const latencies: number[] = [];
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    const response = await context.get(path);
    const elapsed = performance.now() - started;
    if (!response.ok()) throw new Error(`${view} run -> ${response.status()}: ${await response.text()}`);
    count = ((await response.json()) as unknown[]).length;
    latencies.push(elapsed);
  }
  return { count, latencies };
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

function summarize(view: TimedView) {
  return {
    view: view.view,
    count: view.count,
    index: view.index,
    p50Ms: percentile(view.latencies, 50),
    p95Ms: percentile(view.latencies, 95),
    maxMs: Math.max(...view.latencies)
  };
}

function fmtMs(value: number): string {
  return `${value.toFixed(value >= 100 ? 0 : 1)}ms`;
}

function printTable(options: Options, rows: ReturnType<typeof summarize>[], syntheticDocs: BusinessDocument[]): void {
  const submitted = syntheticDocs.filter((doc) => doc.state === "submitted").length;
  const actor = `person:${AIRLINE_PERSONAS[options.persona].username}`;
  const assigned = syntheticDocs.filter((doc) => doc.responsible?.includes(actor)).length;
  const created = syntheticDocs.filter((doc) => doc.createdBy === actor).length;

  console.log("@me filter perf (local/dev measurement)");
  console.log(`docs=${options.docs} submitted=${submitted} actor=${options.persona} assignedToActor=${assigned} createdByActor=${created} runs=${options.runs} warmup=${options.warmup}`);
  console.log("");
  console.log("view                  count  index                       p50     p95     max");
  for (const row of rows) {
    console.log(
      `${row.view.padEnd(21)} ${String(row.count).padStart(5)}  ${row.index.padEnd(27)} ${fmtMs(row.p50Ms).padStart(7)} ${fmtMs(row.p95Ms).padStart(7)} ${fmtMs(row.maxMs).padStart(7)}`
    );
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const harness = await startHarness();
  const admin = await request.newContext({ baseURL: harness.baseURL });
  const actor = await request.newContext({ baseURL: harness.baseURL });
  try {
    const reset = await admin.post("/api/reset");
    if (!reset.ok()) throw new Error(`/api/reset -> ${reset.status()}: ${await reset.text()}`);
    const adminLogin = await admin.post("/api/session/login", { data: { username: "alice", password: AIRLINE_PASSWORD } });
    if (!adminLogin.ok()) throw new Error(`/api/session/login alice -> ${adminLogin.status()}: ${await adminLogin.text()}`);

    const scenario = await seedAgenticAirlines(admin, { orgAppId: "perf-org", leaveRequestAppId: "perf-leave" });
    const syntheticDocs = buildSyntheticDocs(options, scenario.leaveRequestAppId);
    await bulkInsert(harness.localCouchUrl, `${scenario.leaveRequestAppId}_app`, syntheticDocs);

    const actorLogin = await actor.post("/api/session/login", {
      data: { username: options.persona, password: AIRLINE_PASSWORD }
    });
    if (!actorLogin.ok()) throw new Error(`/api/session/login ${options.persona} -> ${actorLogin.status()}: ${await actorLogin.text()}`);

    const principals = personaPrincipals(options.persona);
    const views = ["view:my-approvals", "view:pending-approval", "view:my-requests"] as const;
    const timed: TimedView[] = [];
    for (const view of views) {
      const measured = await timeView(actor, scenario.leaveRequestAppId, view, options.runs, options.warmup);
      timed.push({
        view,
        count: measured.count,
        index: await explainIndex(harness.localCouchUrl, `${scenario.leaveRequestAppId}_app`, view, principals),
        latencies: measured.latencies
      });
    }

    const rows = timed.map(summarize);
    if (options.json) {
      console.log(JSON.stringify({ options, rows }, null, 2));
    } else {
      printTable(options, rows, syntheticDocs);
    }
  } finally {
    await Promise.allSettled([admin.dispose(), actor.dispose()]);
    await harness.stop();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
