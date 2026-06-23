import { execFileSync } from "node:child_process";

const LOCAL_COUCH = "http://localhost:5985/";
const SERVER_COUCH = "http://localhost:5984/";
const COMPOSE_SERVICES = ["local-couchdb", "server-couchdb"];
const CONTAINER_PORT = "5984";

function commandWorks(command: string, args: string[]) {
  try {
    execFileSync(command, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function dockerRunner(): { command: string; args: string[] } {
  if (process.env.DOCKER_USE_SUDO === "1") return { command: "sudo", args: ["-n", "docker"] };
  if (commandWorks("docker", ["version"])) return { command: "docker", args: [] };
  if (commandWorks("sudo", ["-n", "docker", "version"])) return { command: "sudo", args: ["-n", "docker"] };
  throw new Error("Docker is not accessible. Grant Docker socket access or configure passwordless sudo for docker.");
}

async function waitForCouch(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`CouchDB at ${url} not reachable within ${timeoutMs}ms (last: ${lastError})`);
}

async function canReach(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

function containerIp(runner: { command: string; args: string[] }, service: string): string {
  return execFileSync(runner.command, [
    ...runner.args,
    "compose",
    "ps",
    "-q",
    service
  ], { encoding: "utf8" }).trim();
}

function inspectIp(runner: { command: string; args: string[] }, containerId: string): string {
  return execFileSync(runner.command, [
    ...runner.args,
    "inspect",
    containerId,
    "--format",
    "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"
  ], { encoding: "utf8" }).trim();
}

async function reachableCouchUrl(
  runner: { command: string; args: string[] },
  service: string,
  preferredUrl: string
): Promise<string> {
  if (await canReach(preferredUrl)) return preferredUrl;
  const id = containerIp(runner, service);
  const ip = inspectIp(runner, id);
  if (!ip) return preferredUrl;
  return `http://${ip}:${CONTAINER_PORT}/`;
}

/**
 * Bring the CouchDB pair up before the suite runs. `docker compose up -d` is
 * idempotent, so this is a no-op when the containers are already running. We
 * deliberately do NOT seed the app databases here — per-test isolation is the
 * reset fixture's job, and the app server may not be ready at this point.
 */
export default async function globalSetup(): Promise<void> {
  const runner = dockerRunner();
  try {
    execFileSync(runner.command, [...runner.args, "compose", "up", "-d", ...COMPOSE_SERVICES], {
      stdio: "inherit"
    });
  } catch (error) {
    throw new Error(
      `Failed to start CouchDB via docker compose. Is Docker running? Original: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const [localUrl, serverUrl] = await Promise.all([
    reachableCouchUrl(runner, "local-couchdb", LOCAL_COUCH),
    reachableCouchUrl(runner, "server-couchdb", SERVER_COUCH)
  ]);
  await Promise.all([waitForCouch(localUrl), waitForCouch(serverUrl)]);
}
