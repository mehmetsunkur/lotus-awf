import { execFileSync } from "node:child_process";

const LOCAL_COUCH = "http://localhost:5985/";
const SERVER_COUCH = "http://localhost:5984/";
const COMPOSE_SERVICES = ["local-couchdb", "server-couchdb"];

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

  await Promise.all([waitForCouch(LOCAL_COUCH), waitForCouch(SERVER_COUCH)]);
}
