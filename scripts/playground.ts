import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { request, type APIRequestContext, type PlaywrightWorkerArgs } from "@playwright/test";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { startHarness, type Harness } from "../tests/support/harness";
import { startAgentMcpHost, mintSessionToken, type AgentMcpHost } from "../tests/mcp/agent/support/mcp-host";
import {
  startContainerizedHarness,
  type ContainerizedAgentMcpHost,
  type ContainerizedHarness
} from "../tests/support/containerized-harness";
import type { LotusHttpMcpClient } from "../tests/mcp/http/support/http-client";
import {
  FIELD_JOB_DESCRIPTIONS,
  FIELD_PASSWORD,
  FIELD_PERSONAS,
  seedFieldServices,
  seedFieldServicesHandbook,
  type FieldPersonaName
} from "../tests/mcp/agent/support/field-services";
import {
  decideFieldServiceSpawn,
  FIELD_SCHEDULER_ORDER,
  type FieldServiceDocSet,
  type FieldSpawnDecision
} from "../tests/mcp/agent/support/field-services-scheduler";
import { assembleShiftPrompt } from "../src/operator/prompt";
import { ClaudeCodeDriver, CodexDriver, type AgentDriver } from "../src/operator/agent-driver";
import { ContainerClaudeCodeDriver, ContainerCodexDriver } from "../src/operator/container-agent-driver";
import { createAgentDiagnostics } from "../src/operator/diagnostics";
import type { BusinessDocument } from "../src/shared/types";

type SidecarName = "mailpit" | "nginx" | "gitea";
type RunnerMode = "container" | "host";
type PlaygroundHarness = Harness | ContainerizedHarness;
type PlaygroundMcpHost = AgentMcpHost | ContainerizedAgentMcpHost;

type PlaygroundOptions = {
  company: "field-services";
  driver?: string;
  model?: string;
  runner: RunnerMode;
  runPersona?: FieldPersonaName;
  runDay: boolean;
  watchWork: boolean;
  emptyOk: boolean;
  pollMs: number;
  maxRuns: number;
  idlePolls: number;
  sidecars: SidecarName[];
  once: boolean;
};

type StartedSidecar = {
  name: SidecarName;
  container: StartedTestContainer;
  urls: string[];
};

const FIELD_APP_ID = "agent-field-services";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const runDir = join(process.cwd(), ".lotus-playground", "runs", timestamp());
  mkdirSync(runDir, { recursive: true });

  console.log(
    options.runner === "container"
      ? "Starting isolated Lotus stack (Testcontainers CouchDB pair + API container + MCP container)..."
      : "Starting isolated Lotus stack (Testcontainers CouchDB pair + local Express/MCP)..."
  );
  const { harness, host } = await startPlaygroundRuntime(options.runner);
  const sidecars: StartedSidecar[] = [];
  const contexts: APIRequestContext[] = [];
  const mcpClients: LotusHttpMcpClient[] = [];

  const shutdown = async (exitCode = 0) => {
    console.log("\nStopping playground...");
    await Promise.allSettled(mcpClients.splice(0).map((client) => client.close()));
    await Promise.allSettled(contexts.splice(0).map((context) => context.dispose()));
    await Promise.allSettled(sidecars.map((sidecar) => sidecar.container.stop()));
    await harness.stop();
    process.exit(exitCode);
  };
  process.once("SIGINT", () => void shutdown(0));
  process.once("SIGTERM", () => void shutdown(0));

  try {
    await resetLotus(harness.baseURL);
    for (const name of options.sidecars) {
      sidecars.push(await startSidecar(harness, name));
    }

    const playwrightShim = { request } as unknown as PlaywrightWorkerArgs["playwright"];
    const seeded = await seedFieldServices(playwrightShim, harness.baseURL, host, contexts, mcpClients);
    const { kbAppId } = await seedFieldServicesHandbook(seeded.admin, seeded.as, seeded.scenario.appId);

    printSummary({ harness, host, appId: seeded.scenario.appId, kbAppId, sidecars, runDir, runner: options.runner });

    if (options.runDay) {
      await seedFieldServicesMorningState(seeded.admin, await seeded.as("dana"), seeded.scenario.appId);
    }

    if (options.runPersona || options.runDay || options.watchWork) {
      applyModelOverride(options);
      if (options.runPersona) {
        const driver = selectDriver(options.driver, options.runner, harness);
        const docs = await loadFieldServiceDocs(await seeded.as("dana"), seeded.scenario.appId);
        const decision = decideFieldServiceSpawn(options.runPersona, docs);
        const queue = await workQueue(await seeded.as(options.runPersona));
        logPersonaProbe(options.runPersona, decision, queue);
        if (!decision.shouldSpawn && !options.emptyOk) {
          throw new Error(`Refusing to spawn ${options.runPersona}: ${decision.reason}. Use --empty-ok to force an empty shift.`);
        }
        await runPersonaShift({
          apiUrl: harness.baseURL,
          host,
          appId: seeded.scenario.appId,
          kbAppId,
          persona: options.runPersona,
          driver,
          runner: options.runner,
          runDir,
          shiftKey: `manual-${options.runPersona}`
        });
      } else {
        const driver = options.maxRuns > 0 ? selectDriver(options.driver, options.runner, harness) : undefined;
        await runFieldServicesScheduler({
          apiUrl: harness.baseURL,
          host,
          appId: seeded.scenario.appId,
          kbAppId,
          as: seeded.as,
          driver,
          runner: options.runner,
          runDir,
          pollMs: options.pollMs,
          maxRuns: options.maxRuns,
          idlePolls: options.idlePolls
        });
      }
    }

    if (options.once) await shutdown();
    console.log("\nPlayground is running. Press Ctrl+C to stop and remove containers.");
    await new Promise(() => {});
  } catch (error) {
    console.error(error);
    await shutdown(1);
  }
}

async function seedFieldServicesMorningState(admin: APIRequestContext, dana: APIRequestContext, appId: string): Promise<void> {
  const existing = await listDocuments(admin, appId, "service-request");
  if (existing.some((doc) => doc.payload.customer === "Meridian Labs" && doc.state === "triaged")) {
    console.log("Morning state already has Meridian Labs triaged request.");
    return;
  }
  const request = await createDocument(admin, appId, "service-request", {
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
  const triaged = await transitionDocument(dana, appId, request._id, "triage");
  console.log(`Seeded morning work: ${triaged._id} -> ${triaged.state} (${triaged.responsible?.join(", ") ?? "unassigned"})`);
}

async function startPlaygroundRuntime(runner: RunnerMode): Promise<{ harness: PlaygroundHarness; host: PlaygroundMcpHost }> {
  if (runner === "container") {
    const harness = await startContainerizedHarness();
    return { harness, host: harness.host };
  }
  const harness = await startHarness();
  const host = await startAgentMcpHost(harness.baseURL);
  return {
    harness: {
      ...harness,
      async stop() {
        await host.stop();
        await harness.stop();
      }
    },
    host
  };
}

async function runFieldServicesScheduler(options: {
  apiUrl: string;
  host: PlaygroundMcpHost;
  appId: string;
  kbAppId: string;
  as: (username: FieldPersonaName) => Promise<APIRequestContext>;
  driver?: AgentDriver;
  runner: RunnerMode;
  runDir: string;
  pollMs: number;
  maxRuns: number;
  idlePolls: number;
}): Promise<void> {
  const attempted = new Set<string>();
  let runs = 0;
  let idle = 0;
  console.log(`\nWatching Field Services queues (poll=${options.pollMs}ms, maxRuns=${options.maxRuns}, idlePolls=${options.idlePolls})...`);

  while (runs < options.maxRuns || options.maxRuns === 0) {
    const observer = await options.as("dana");
    const docs = await loadFieldServiceDocs(observer, options.appId);
    writeSnapshot(options.runDir, `snapshot-${String(runs).padStart(2, "0")}-${Date.now()}.json`, docs);

    for (const persona of FIELD_SCHEDULER_ORDER) {
      const queue = await workQueue(await options.as(persona));
      logPersonaProbe(persona, decideFieldServiceSpawn(persona, docs), queue);
    }
    if (options.maxRuns === 0) break;

    const next = nextUnattemptedSpawn(docs, attempted);
    if (!next) {
      idle += 1;
      console.log(`No new spawnable Field Services work (${idle}/${options.idlePolls} idle polls).`);
      if (idle >= options.idlePolls || options.maxRuns === 0) break;
      await delay(options.pollMs);
      continue;
    }

    idle = 0;
    const key = spawnKey(next);
    attempted.add(key);
    if (!options.driver) throw new Error("Scheduler needs a driver when --max-runs is greater than 0");
    runs += 1;
    console.log(`\nSpawn ${next.persona}: ${next.reason}; items=${next.itemIds.join(", ")}`);
    await runPersonaShift({
      apiUrl: options.apiUrl,
      host: options.host,
      appId: options.appId,
      kbAppId: options.kbAppId,
      persona: next.persona,
      driver: options.driver,
      runner: options.runner,
      runDir: options.runDir,
      shiftKey: `${String(runs).padStart(2, "0")}-${next.persona}`
    });
    await delay(options.pollMs);
  }
  console.log(`Scheduler stopped after ${runs} agent run${runs === 1 ? "" : "s"}.`);
}

function nextUnattemptedSpawn(docs: FieldServiceDocSet, attempted: Set<string>): FieldSpawnDecision | undefined {
  return FIELD_SCHEDULER_ORDER.map((persona) => decideFieldServiceSpawn(persona, docs)).find(
    (decision) => decision.shouldSpawn && !attempted.has(spawnKey(decision))
  );
}

function spawnKey(decision: FieldSpawnDecision): string {
  return `${decision.persona}:${decision.itemIds.join(",")}`;
}

function logPersonaProbe(persona: FieldPersonaName, decision: FieldSpawnDecision, queue: WorkQueueResult): void {
  const appQueue = queue.byApp.find((entry) => entry.appId === FIELD_APP_ID);
  const queueText = appQueue ? `${appQueue.count} assigned` : "0 assigned";
  console.log(`${persona.padEnd(7)} ${queueText.padEnd(12)} ${decision.shouldSpawn ? "spawn" : "skip"} - ${decision.reason}`);
}

async function loadFieldServiceDocs(reader: APIRequestContext, appId: string): Promise<FieldServiceDocSet> {
  const [serviceRequests, workOrders, partsReservations, invoices] = await Promise.all([
    listDocuments(reader, appId, "service-request"),
    listDocuments(reader, appId, "work-order"),
    listDocuments(reader, appId, "parts-reservation"),
    listDocuments(reader, appId, "invoice")
  ]);
  return { serviceRequests, workOrders, partsReservations, invoices };
}

function writeSnapshot(runDir: string, fileName: string, docs: FieldServiceDocSet): void {
  const summary = Object.fromEntries(
    Object.entries(docs).map(([key, values]) => [
      key,
      values.map((doc) => ({
        id: doc._id,
        state: doc.state ?? null,
        responsible: doc.responsible ?? null,
        payload: doc.payload
      }))
    ])
  );
  writeFileSync(join(runDir, fileName), JSON.stringify(summary, null, 2), "utf8");
}

async function listDocuments(context: APIRequestContext, appId: string, docType: string): Promise<BusinessDocument[]> {
  const response = await context.get(`/api/apps/${appId}/documents?docType=${encodeURIComponent(docType)}`);
  if (response.status() !== 200) throw new Error(`${docType} list failed with ${response.status()}: ${await response.text()}`);
  return (await response.json()) as BusinessDocument[];
}

async function createDocument(
  context: APIRequestContext,
  appId: string,
  docType: string,
  payload: Record<string, unknown>
): Promise<BusinessDocument> {
  const response = await context.post(`/api/apps/${appId}/documents`, { data: { docType, payload } });
  if (response.status() !== 201) throw new Error(`${docType} create failed with ${response.status()}: ${await response.text()}`);
  return (await response.json()) as BusinessDocument;
}

async function transitionDocument(
  context: APIRequestContext,
  appId: string,
  id: string,
  transition: string
): Promise<BusinessDocument> {
  const response = await context.post(`/api/apps/${appId}/documents/${encodeURIComponent(id)}/transition`, { data: { transition } });
  if (response.status() !== 200) throw new Error(`${transition} failed with ${response.status()}: ${await response.text()}`);
  return (await response.json()) as BusinessDocument;
}

type WorkQueueResult = {
  total: number;
  byApp: Array<{ appId: string; count: number; items?: Array<{ _id: string; docType: string; state: string | null }> }>;
};

async function workQueue(context: APIRequestContext): Promise<WorkQueueResult> {
  const response = await context.get("/api/work-queue?items=true");
  if (response.status() !== 200) throw new Error(`work-queue failed with ${response.status()}: ${await response.text()}`);
  return (await response.json()) as WorkQueueResult;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resetLotus(baseURL: string): Promise<void> {
  const admin = await request.newContext({ baseURL });
  try {
    const reset = await admin.post("/api/reset");
    if (!reset.ok()) throw new Error(`/api/reset failed with status ${reset.status()}`);
  } finally {
    await admin.dispose();
  }
}

async function startSidecar(harness: PlaygroundHarness, name: SidecarName): Promise<StartedSidecar> {
  if (name === "mailpit") {
    const container = await new GenericContainer("axllent/mailpit:latest")
      .withNetwork(harness.network)
      .withExposedPorts(8025, 1025)
      .withWaitStrategy(Wait.forHttp("/", 8025).forStatusCode(200))
      .start();
    return {
      name,
      container,
      urls: [
        `webmail: http://${container.getHost()}:${container.getMappedPort(8025)}`,
        `smtp: ${container.getHost()}:${container.getMappedPort(1025)}`
      ]
    };
  }
  if (name === "nginx") {
    const container = await new GenericContainer("nginx:1.27-alpine")
      .withNetwork(harness.network)
      .withExposedPorts(80)
      .withWaitStrategy(Wait.forHttp("/", 80).forStatusCode(200))
      .start();
    return { name, container, urls: [`http://${container.getHost()}:${container.getMappedPort(80)}`] };
  }
  const container = await new GenericContainer("gitea/gitea:1.22-rootless")
    .withNetwork(harness.network)
    .withExposedPorts(3000, 2222)
    .withWaitStrategy(Wait.forHttp("/", 3000).forStatusCode(200))
    .start();
  return {
    name,
    container,
    urls: [`web: http://${container.getHost()}:${container.getMappedPort(3000)}`, `ssh: ${container.getHost()}:${container.getMappedPort(2222)}`]
  };
}

async function runPersonaShift(options: {
  apiUrl: string;
  host: PlaygroundMcpHost;
  appId: string;
  kbAppId: string;
  persona: FieldPersonaName;
  driver: AgentDriver;
  runner: RunnerMode;
  runDir: string;
  shiftKey: string;
}): Promise<void> {
  if (!options.driver.isAvailable()) {
    throw new Error(`${options.driver.name} unavailable: ${options.driver.unavailableReason()}`);
  }
  const persona = FIELD_PERSONAS[options.persona];
  const prompt = assembleShiftPrompt({
    displayName: persona.displayName,
    jobTitle: persona.title,
    companyName: "Northstar Field Services",
    kbAppId: options.kbAppId,
    jobDescription:
      FIELD_JOB_DESCRIPTIONS[options.persona] +
      " Use only your Lotus workspace access and company handbook data. Do not use shell commands, local files, source code, test fixtures, CouchDB, or direct HTTP APIs."
  });
  assertPromptHygiene(prompt, options.kbAppId, options.appId);

  const diagnostics = createAgentDiagnostics({
    rootDir: join(options.runDir, "agent-diagnostics", options.driver.name, options.shiftKey),
    driverName: options.driver.name,
    testTitle: `playground field-services ${options.shiftKey}`
  });
  const sessionToken = await mintSessionToken(options.apiUrl, options.persona, FIELD_PASSWORD);
  const authorization = `Bearer ${sessionToken}`;
  diagnostics.addSecrets([sessionToken, authorization]);
  diagnostics.event({ event: "session_token_minted", persona: options.persona, surfaces: ["workspace"] });

  console.log(`\nRunning ${options.driver.name} as ${persona.displayName} (${options.shiftKey})...`);
  const workspaceUrl =
    options.runner === "container" && "internalSurfaceUrl" in options.host
      ? options.host.internalSurfaceUrl("workspace")
      : options.host.surfaceUrl("workspace");
  const run = await options.driver.run({
    prompt,
    mcpServers: {
      "lotus-workspace": { url: workspaceUrl, authorization }
    },
    diagnostics
  });
  if (!run.ok) throw new Error(`${options.driver.name} failed for ${options.persona}: ${run.finalText}`);
  console.log(`Completed ${options.shiftKey}; diagnostics: ${diagnostics.rootDir}`);
}

function assertPromptHygiene(prompt: string, kbAppId: string, fieldAppId: string): void {
  if (!prompt.includes(kbAppId)) throw new Error("shift prompt is missing the handbook app id");
  for (const banned of [fieldAppId, "view:", "doc:", "lotus_"]) {
    if (prompt.includes(banned)) throw new Error(`shift prompt must not contain ${banned}`);
  }
}

function driversFor(runner: RunnerMode, harness: PlaygroundHarness): AgentDriver[] {
  if (runner === "container") {
    return [new ContainerClaudeCodeDriver({ network: harness.network }), new ContainerCodexDriver({ network: harness.network })];
  }
  return [new ClaudeCodeDriver(), new CodexDriver()];
}

function selectDriver(name: string | undefined, runner: RunnerMode, harness: PlaygroundHarness): AgentDriver {
  const drivers = driversFor(runner, harness);
  const selected = name ? drivers.find((driver) => driver.name === name) : drivers.find((driver) => driver.isAvailable()) ?? drivers[0];
  if (!selected) throw new Error(`Unknown driver "${name}". Valid drivers: ${drivers.map((driver) => driver.name).join(", ")}`);
  return selected;
}

function applyModelOverride(options: PlaygroundOptions): void {
  if (!options.model) return;
  if (!options.driver) {
    throw new Error("--model requires --driver so the playground knows which driver model env var to override");
  }
  if (options.driver === "claude-code") {
    process.env.LOTUS_AGENT_CLAUDE_MODEL = options.model;
    return;
  }
  if (options.driver === "codex") {
    process.env.LOTUS_AGENT_CODEX_MODEL = options.model;
    return;
  }
  throw new Error(`Unknown driver "${options.driver}". Valid drivers: claude-code, codex`);
}

function printSummary(options: {
  harness: PlaygroundHarness;
  host: PlaygroundMcpHost;
  appId: string;
  kbAppId: string;
  sidecars: StartedSidecar[];
  runDir: string;
  runner: RunnerMode;
}): void {
  console.log(`
Lotus playground is ready.

Lotus:
  Web/API:     ${options.harness.baseURL}
  Operations:  ${options.harness.baseURL}/${options.appId}.nsf
  Handbook:    ${options.harness.baseURL}/${options.kbAppId}.nsf

MCP:
  admin:       ${options.host.surfaceUrl("admin")}
  designer:    ${options.host.surfaceUrl("designer")}
  workspace:   ${options.host.surfaceUrl("workspace")}
  runner URL:  ${"internalSurfaceUrl" in options.host ? options.host.internalSurfaceUrl("workspace") : "(host runner uses workspace URL above)"}

Runner:
  ${options.runner}

Local playground logins:
  alice    password123            Admin / Designer
${Object.values(FIELD_PERSONAS)
  .map((persona) => `  ${persona.username.padEnd(8)} ${FIELD_PASSWORD.padEnd(22)} ${persona.displayName} - ${persona.title}`)
  .join("\n")}

Diagnostics:
  ${options.runDir}`);

  if (options.sidecars.length) {
    console.log("\nSidecars:");
    for (const sidecar of options.sidecars) {
      console.log(`  ${sidecar.name}: ${sidecar.urls.join(", ")}`);
    }
  }

  console.log(`
Run examples:
  npm run playground -- field-services --run dana --driver claude-code --model claude-sonnet-4-5 --once
  npm run playground -- field-services --run-day --driver codex --model gpt-5-codex --sidecar mailpit
`);
}

function parseArgs(args: string[]): PlaygroundOptions {
  const options: PlaygroundOptions = {
    company: "field-services",
    runner: "container",
    runDay: false,
    watchWork: false,
    emptyOk: false,
    pollMs: 2_000,
    maxRuns: 10,
    idlePolls: 3,
    sidecars: [],
    once: false
  };
  const rest = [...args];
  if (rest[0] && !rest[0].startsWith("-")) {
    const company = rest.shift();
    if (company !== "field-services") throw new Error(`Unsupported company "${company}". Valid companies: field-services`);
  }
  while (rest.length) {
    const arg = rest.shift();
    if (arg === "--run") {
      options.runPersona = parsePersona(rest.shift());
    } else if (arg === "--run-day") {
      options.runDay = true;
    } else if (arg === "--runner") {
      options.runner = parseRunner(rest.shift());
    } else if (arg === "--watch-work") {
      options.watchWork = true;
    } else if (arg === "--empty-ok") {
      options.emptyOk = true;
    } else if (arg === "--poll-ms") {
      options.pollMs = parsePositiveInteger(arg, rest.shift());
    } else if (arg === "--max-runs") {
      options.maxRuns = parseNonNegativeInteger(arg, rest.shift());
    } else if (arg === "--idle-polls") {
      options.idlePolls = parsePositiveInteger(arg, rest.shift());
    } else if (arg === "--driver") {
      options.driver = requiredValue(arg, rest.shift());
    } else if (arg === "--model") {
      options.model = requiredValue(arg, rest.shift());
    } else if (arg === "--sidecar") {
      options.sidecars.push(parseSidecar(rest.shift()));
    } else if (arg === "--once") {
      options.once = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument "${arg ?? ""}". Use --help for usage.`);
    }
  }
  if (options.runPersona && (options.runDay || options.watchWork)) {
    throw new Error("--run cannot be combined with --run-day or --watch-work");
  }
  if (options.runDay && options.watchWork) {
    throw new Error("--run-day and --watch-work are mutually exclusive");
  }
  return options;
}

function parsePersona(value: string | undefined): FieldPersonaName {
  const persona = requiredValue("--run", value);
  if (persona in FIELD_PERSONAS) return persona as FieldPersonaName;
  throw new Error(`Unknown persona "${persona}". Valid personas: ${Object.keys(FIELD_PERSONAS).join(", ")}`);
}

function parseSidecar(value: string | undefined): SidecarName {
  const sidecar = requiredValue("--sidecar", value);
  if (sidecar === "mailpit" || sidecar === "nginx" || sidecar === "gitea") return sidecar;
  throw new Error(`Unknown sidecar "${sidecar}". Valid sidecars: mailpit, nginx, gitea`);
}

function parseRunner(value: string | undefined): RunnerMode {
  const runner = requiredValue("--runner", value);
  if (runner === "container" || runner === "host") return runner;
  throw new Error(`Unknown runner "${runner}". Valid runners: container, host`);
}

function requiredValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`);
  return value;
}

function parsePositiveInteger(flag: string, value: string | undefined): number {
  const raw = requiredValue(flag, value);
  if (!/^\d+$/.test(raw)) throw new Error(`${flag} requires a positive integer`);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} requires a positive integer`);
  return parsed;
}

function parseNonNegativeInteger(flag: string, value: string | undefined): number {
  const raw = requiredValue(flag, value);
  if (!/^\d+$/.test(raw)) throw new Error(`${flag} requires a non-negative integer`);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${flag} requires a non-negative integer`);
  return parsed;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function printHelp(): void {
  console.log(`Usage:
  npm run playground -- field-services [options]

Options:
  --run <persona>       Run one persona shift: dana, taylor, iris, blake
  --runner <mode>       Agent/runtime isolation: container or host (default: container)
  --run-day             Seed morning work and run the queue scheduler until idle
  --watch-work          Run the queue scheduler without seeding morning work
  --empty-ok            Allow --run <persona> even when the persona has no detected work
  --poll-ms <n>         Scheduler polling delay in milliseconds (default: 2000)
  --max-runs <n>        Maximum scheduler agent runs; 0 probes only (default: 10)
  --idle-polls <n>      Stop after this many polls with no new spawnable work (default: 3)
  --driver <name>       Agent driver: claude-code or codex (default: first available)
  --model <name>        Override the selected driver's model for this run; requires --driver
  --sidecar <name>      Start optional sidecar: mailpit, nginx, gitea; repeatable
  --once                Stop containers after bootstrap/runs instead of staying up
  --help                Show this help
`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
