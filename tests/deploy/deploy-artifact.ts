import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const compose = ["compose", "-p", "lotus-m13-deploy-test", "-f", "deploy/compose.yml"];
let baseUrl = process.env.DEPLOY_BASE_URL ?? "http://localhost:3101";
const dockerRunner = selectDockerRunner();

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
  if (process.env.DOCKER_USE_SUDO === "1") {
    return { command: "sudo", args: ["-n", "docker"] };
  }
  if (commandWorks("docker", ["version"])) {
    return { command: "docker", args: [] };
  }
  if (commandWorks("sudo", ["-n", "docker", "version"])) {
    return { command: "sudo", args: ["-n", "docker"] };
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
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
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
  await retry("expense app install/reset", () => request("/api/reset", { method: "POST" }));
  await waitFor("/api/ready", "CouchDB-backed readiness");

  const root = await fetch(baseUrl);
  assert.equal(root.status, 200, "built client should be served by the app container");
  assert.match(await root.text(), /<div id="root"><\/div>/, "built client HTML should include the React root");

  const definitions = await request<{ forms: Array<{ _id: string }>; views: Array<{ _id: string }> }>("/api/definitions");
  assert.ok(definitions.forms.some((form) => form._id === "form:expense"), "expense form should be installed");
  assert.ok(definitions.views.some((view) => view._id === "view:my-expenses"), "expense view should be installed");

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
