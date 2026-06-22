import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const compose = ["compose", "-p", "lotus-m13-deploy-test", "-f", "deploy/compose.yml"];
process.env.LOTUS_APP_PORT ??= "33101";
process.env.LOTUS_SERVER_COUCH_PORT ??= "25984";
process.env.LOTUS_LOCAL_COUCH_PORT ??= "25985";
let baseUrl = process.env.DEPLOY_BASE_URL ?? `http://localhost:${process.env.LOTUS_APP_PORT}`;
const dockerRunner = selectDockerRunner();
let cookie = "";

type HttpOptions = {
  method?: string;
  body?: unknown;
  ok?: number | number[];
};

function commandWorks(command: string, args: string[]) {
  try {
    execFileSync(command, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function selectDockerRunner(): { command: string; args: string[] } {
  const sudoDocker = [
    "-n",
    "env",
    `LOTUS_APP_PORT=${process.env.LOTUS_APP_PORT}`,
    `LOTUS_SERVER_COUCH_PORT=${process.env.LOTUS_SERVER_COUCH_PORT}`,
    `LOTUS_LOCAL_COUCH_PORT=${process.env.LOTUS_LOCAL_COUCH_PORT}`,
    "docker"
  ];
  if (process.env.DOCKER_USE_SUDO === "1") {
    return { command: "sudo", args: sudoDocker };
  }
  if (commandWorks("docker", ["version"])) {
    return { command: "docker", args: [] };
  }
  if (commandWorks("sudo", ["-n", "docker", "version"])) {
    return { command: "sudo", args: sudoDocker };
  }
  throw new Error("Docker is not accessible. Grant Docker socket access or configure passwordless sudo for docker.");
}

function docker(args: string[]) {
  execFileSync(dockerRunner.command, [...dockerRunner.args, ...compose, ...args], { stdio: "inherit" });
}

function dockerOut(args: string[]) {
  return execFileSync(dockerRunner.command, [...dockerRunner.args, ...compose, ...args], { encoding: "utf8" }).trim();
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function request<T>(path: string, options: HttpOptions = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? (options.body ? "POST" : "GET"),
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0] ?? cookie;
  const expected = Array.isArray(options.ok) ? options.ok : [options.ok ?? 200];
  assert.ok(expected.includes(response.status), `${path} returned ${response.status}, expected ${expected.join("/")}`);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function waitFor(path: string, description: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}${path}`);
      if (response.ok) return;
      lastError = new Error(`${path} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for ${description}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function isReachable(url: string) {
  try {
    const response = await fetch(`${url}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function resolveBaseUrl() {
  if (process.env.DEPLOY_BASE_URL || (await isReachable(baseUrl))) return;
  const containerId = dockerOut(["ps", "-q", "app"]);
  const ip = execFileSync(dockerRunner.command, [
    ...dockerRunner.args,
    "inspect",
    "-f",
    "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
    containerId
  ], { encoding: "utf8" }).trim();
  if (!ip) throw new Error("Could not resolve app container IP after host port probe failed");
  baseUrl = `http://${ip}:3001`;
}


async function retry<T>(description: string, action: () => Promise<T>, timeoutMs = 120_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      await sleep(1_000);
    }
  }
  throw new Error(`Timed out during ${description}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function runAssertions() {
  await waitFor("/api/health", "app liveness");
  await waitFor("/api/ready", "setup.nsf readiness");

  const root = await fetch(baseUrl);
  assert.equal(root.status, 200, "built client should be served by the app container");
  assert.match(await root.text(), /<div id="root"><\/div>/, "built client HTML should include the React root");
  for (const route of [
    "/setup.nsf",
    "/setup.nsf/views/people",
    "/login.nsf",
    "/catalog.nsf",
    "/catalog.nsf/views/system-apps",
    "/expense.nsf",
    "/expense.nsf/views/vendors",
    "/expense.nsf/designer/forms/expense"
  ]) {
    const routed = await fetch(`${baseUrl}${route}`);
    assert.equal(routed.status, 200, `${route} should be served by the app container`);
    assert.match(await routed.text(), /<div id="root"><\/div>/, `${route} should use the SPA fallback`);
  }

  const firstRun = await request<{
    setupComplete: boolean;
    session: { authenticated: boolean };
    systemApps: Array<{ appId: string; route: string }>;
    installedApps: unknown[];
    samples: Array<{ appId: string; installed: boolean }>;
  }>("/api/platform/state");
  assert.equal(firstRun.setupComplete, false, "fresh deploy should start in setup mode");
  assert.equal(firstRun.session.authenticated, false, "fresh deploy should not have an authenticated session");
  assert.ok(firstRun.systemApps.some((app) => app.appId === "setup" && app.route === "/setup.nsf"), "setup.nsf should be advertised as a system app");
  assert.equal(firstRun.installedApps.length, 0, "fresh deploy should have an empty app catalog");
  assert.equal(firstRun.samples.find((sample) => sample.appId === "expense")?.installed, false, "expense sample should not be installed by default");
  await request("/api/definitions", { ok: 401 });

  const configured = await request<{
    setupComplete: boolean;
    session: { authenticated: boolean; person?: { username: string } };
    systemApps: Array<{ appId: string; route: string }>;
    orgName?: string;
    domainName?: string;
    adminUser?: string;
    installedApps: unknown[];
  }>("/api/platform/setup", {
    body: {
      orgName: "Deploy Test Org",
      domainName: "deploy.test",
      adminUser: "admin",
      adminPassword: "password123",
      confirmPassword: "password123"
    }
  });
  assert.equal(configured.setupComplete, true, "setup should complete");
  assert.equal(configured.session.authenticated, true, "setup should create an authenticated admin session");
  assert.equal(configured.session.person?.username, "admin", "setup session should belong to the admin person");
  assert.ok(configured.systemApps.some((app) => app.appId === "setup" && app.route === "/setup.nsf"), "setup.nsf should stay visible after setup");
  assert.equal(configured.orgName, "Deploy Test Org", "org name should persist");
  assert.equal(configured.domainName, "deploy.test", "domain name should persist");
  assert.equal(configured.adminUser, "admin", "admin username should persist");
  assert.equal(configured.installedApps.length, 0, "setup should still land on an empty app catalog");

  const installed = await request<{
    installedApps: Array<{ appId: string }>;
    samples: Array<{ appId: string; installed: boolean }>;
  }>("/api/platform/install-sample/expense", { method: "POST", ok: 201 });
  assert.ok(installed.installedApps.some((app) => app.appId === "expense"), "expense sample install should create an app install record");
  assert.equal(installed.samples.find((sample) => sample.appId === "expense")?.installed, true, "expense sample should be marked installed");

  const definitions = await request<{ forms: Array<{ _id: string }>; views: Array<{ _id: string }> }>("/api/definitions");
  assert.ok(definitions.forms.some((form) => form._id === "form:expense"), "expense form should be installed");
  assert.ok(definitions.views.some((view) => view._id === "view:my-expenses"), "expense view should be installed");

  const seededExpenses = await request<Array<{ _id: string; payload: Record<string, unknown> }>>("/api/documents?docType=expense");
  assert.ok(
    seededExpenses.some((doc) => doc._id === "doc:expense:stationery" && doc.payload.description === "Stationery"),
    "expense sample data should be installed from the JSON artifact"
  );

  const created = await request<{ _id: string; _rev: string; payload: Record<string, unknown>; state?: string }>("/api/documents", {
    ok: 201,
    body: {
      docType: "expense",
      payload: {
        amount: 188,
        description: "Deployment verification expense",
        category: "travel",
        spentAt: "2026-06-18"
      }
    }
  });
  assert.equal(created.payload.gross, 225.6, "pure compute handler should run in the packaged API");

  const updated = await request<{ payload: Record<string, unknown> }>(`/api/documents/${encodeURIComponent(created._id)}`, {
    method: "PUT",
    body: { payload: { ...created.payload, amount: 199, description: "Deployment verification updated", category: "travel" } }
  });
  assert.equal(updated.payload.amount, 199, "expense update should persist");

  const direct = await request<{ _id: string; docType: string }>(`/api/documents/${encodeURIComponent(created._id)}`);
  assert.equal(direct._id, created._id, "direct document read should load by id");
  assert.equal(direct.docType, "expense", "direct document read should preserve docType");

  const submitted = await request<{ state: string }>(`/api/documents/${encodeURIComponent(created._id)}/transition`, {
    body: { transition: "submit" }
  });
  assert.equal(submitted.state, "submitted", "workflow submit transition should run");

  const approved = await request<{ state: string }>(`/api/documents/${encodeURIComponent(created._id)}/transition`, {
    body: { transition: "approve" }
  });
  assert.equal(approved.state, "approved", "workflow approve transition should run");

  const searched = await request<Array<{ _id: string }>>("/api/views/view%3Amy-expenses/documents?q=Deployment");
  assert.ok(searched.some((doc) => doc._id === created._id), "view search should find the created expense");

  const scaffold = await request<{ form: { _id: string }; view: { _id: string } }>("/api/document-types", {
    ok: 201,
    body: { docType: "inspection", title: "Inspection" }
  });
  assert.equal(scaffold.form._id, "form:inspection", "design change should create an inspection form");
  assert.equal(scaffold.view._id, "view:inspection", "design change should create an inspection view");

  const inspection = await request<{ _id: string; docType: string }>("/api/documents", {
    ok: 201,
    body: { docType: "inspection", payload: { title: "Pump station check" } }
  });
  assert.equal(inspection.docType, "inspection", "new document type should be usable immediately");

  const inspections = await request<Array<{ _id: string }>>("/api/views/view%3Ainspection/documents");
  assert.ok(inspections.some((doc) => doc._id === inspection._id), "scaffolded view should list new documents");

  const agentTick = await request<{ ok: boolean; ran: number }>("/api/agents/run", { method: "POST" });
  assert.equal(agentTick.ok, true, "agent tick should complete");
  assert.ok(agentTick.ran >= 1, "packaged runtime should record at least one agent run");

  const auditTick = await request<{ ok: boolean; recorded: number }>("/api/audit/run", { method: "POST" });
  assert.equal(auditTick.ok, true, "audit tick should complete");
  assert.ok(auditTick.recorded >= 1, "packaged runtime should record audit events");

  const template = await request<{ kind: string; definitions: unknown[] }>("/api/templates/export", {
    body: { version: "deploy-test", source: "deploy-test" }
  });
  assert.equal(template.kind, "template", "template export should return an artifact");
  assert.ok(template.definitions.length >= 1, "template export should include definitions");

  await request("/api/replicate", { method: "POST" });
}

async function main() {
  docker(["down", "-v", "--remove-orphans"]);
  try {
    docker(["up", "-d", "--build"]);
    await resolveBaseUrl();
    await runAssertions();
  } finally {
    docker(["down", "-v", "--remove-orphans"]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
