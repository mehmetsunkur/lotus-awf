import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { request, type APIRequestContext, type PlaywrightWorkerArgs } from "@playwright/test";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { startHarness, type Harness } from "../tests/support/harness";
import { startAgentMcpHost, mintSessionToken, type AgentMcpHost } from "../tests/mcp/agent/support/mcp-host";
import type { LotusHttpMcpClient } from "../tests/mcp/http/support/http-client";
import {
  FIELD_JOB_DESCRIPTIONS,
  FIELD_PASSWORD,
  FIELD_PERSONAS,
  seedFieldServices,
  seedFieldServicesHandbook,
  type FieldPersonaName
} from "../tests/mcp/agent/support/field-services";
import { assembleShiftPrompt } from "../src/operator/prompt";
import { ClaudeCodeDriver, CodexDriver, type AgentDriver } from "../src/operator/agent-driver";
import { createAgentDiagnostics } from "../src/operator/diagnostics";

type SidecarName = "mailpit" | "nginx" | "gitea";

type PlaygroundOptions = {
  company: "field-services";
  driver?: string;
  model?: string;
  runPersona?: FieldPersonaName;
  runDay: boolean;
  sidecars: SidecarName[];
  once: boolean;
};

type StartedSidecar = {
  name: SidecarName;
  container: StartedTestContainer;
  urls: string[];
};

const DRIVERS: AgentDriver[] = [new ClaudeCodeDriver(), new CodexDriver()];
const FIELD_DAY: FieldPersonaName[] = ["dana", "taylor", "iris", "taylor", "blake"];

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const runDir = join(process.cwd(), ".lotus-playground", "runs", timestamp());
  mkdirSync(runDir, { recursive: true });

  console.log("Starting isolated Lotus stack (Testcontainers CouchDB pair + Express)...");
  const harness = await startHarness();
  const host = await startAgentMcpHost(harness.baseURL);
  const sidecars: StartedSidecar[] = [];
  const contexts: APIRequestContext[] = [];
  const mcpClients: LotusHttpMcpClient[] = [];

  const shutdown = async () => {
    console.log("\nStopping playground...");
    await Promise.allSettled(mcpClients.splice(0).map((client) => client.close()));
    await Promise.allSettled(contexts.splice(0).map((context) => context.dispose()));
    await Promise.allSettled(sidecars.map((sidecar) => sidecar.container.stop()));
    await host.stop();
    await harness.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  try {
    await resetLotus(harness.baseURL);
    for (const name of options.sidecars) {
      sidecars.push(await startSidecar(harness, name));
    }

    const playwrightShim = { request } as unknown as PlaywrightWorkerArgs["playwright"];
    const seeded = await seedFieldServices(playwrightShim, harness.baseURL, host, contexts, mcpClients);
    const { kbAppId } = await seedFieldServicesHandbook(seeded.admin, seeded.as, seeded.scenario.appId);

    printSummary({ harness, host, appId: seeded.scenario.appId, kbAppId, sidecars, runDir });

    if (options.runPersona || options.runDay) {
      applyModelOverride(options);
      const driver = selectDriver(options.driver);
      const shifts = options.runDay ? FIELD_DAY : [options.runPersona ?? "dana"];
      for (const [index, persona] of shifts.entries()) {
        await runPersonaShift({
          apiUrl: harness.baseURL,
          host,
          appId: seeded.scenario.appId,
          kbAppId,
          persona,
          driver,
          runDir,
          shiftKey: `${String(index + 1).padStart(2, "0")}-${persona}`
        });
      }
    }

    if (options.once) await shutdown();
    console.log("\nPlayground is running. Press Ctrl+C to stop and remove containers.");
    await new Promise(() => {});
  } catch (error) {
    console.error(error);
    await shutdown();
  }
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

async function startSidecar(harness: Harness, name: SidecarName): Promise<StartedSidecar> {
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
  host: AgentMcpHost;
  appId: string;
  kbAppId: string;
  persona: FieldPersonaName;
  driver: AgentDriver;
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
    jobDescription: FIELD_JOB_DESCRIPTIONS[options.persona]
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
  const run = await options.driver.run({
    prompt,
    mcpServers: {
      "lotus-workspace": { url: options.host.surfaceUrl("workspace"), authorization }
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

function selectDriver(name?: string): AgentDriver {
  const selected = name ? DRIVERS.find((driver) => driver.name === name) : DRIVERS.find((driver) => driver.isAvailable()) ?? DRIVERS[0];
  if (!selected) throw new Error(`Unknown driver "${name}". Valid drivers: ${DRIVERS.map((driver) => driver.name).join(", ")}`);
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
  throw new Error(`Unknown driver "${options.driver}". Valid drivers: ${DRIVERS.map((driver) => driver.name).join(", ")}`);
}

function printSummary(options: {
  harness: Harness;
  host: AgentMcpHost;
  appId: string;
  kbAppId: string;
  sidecars: StartedSidecar[];
  runDir: string;
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
    runDay: false,
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

function requiredValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`);
  return value;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function printHelp(): void {
  console.log(`Usage:
  npm run playground -- field-services [options]

Options:
  --run <persona>       Run one persona shift: dana, taylor, iris, blake
  --run-day             Run the default Field Services day: dispatch, technician, inventory, technician, billing
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
