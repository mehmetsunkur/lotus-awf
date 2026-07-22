import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import {
  GenericContainer,
  Network,
  Wait,
  type StartedNetwork,
  type StartedTestContainer
} from "testcontainers";

/**
 * Per-worker e2e harness. Each Playwright worker owns an isolated, ephemeral
 * environment: a private Docker network, two CouchDB containers (the "local" and
 * "server" replicas) on random host ports, and one Express server process pointed
 * at them. Because every worker has its own substrate, the suite can run fully in
 * parallel and a spec may stop/start its own replica without touching others.
 *
 * Topology mirrors production (see src/server/config.ts):
 *   - The API reaches CouchDB via host-mapped ports (LOCAL/SERVER_COUCH_URL).
 *   - Container-to-container replication uses the network aliases
 *     (LOCAL/SERVER_COUCH_REPLICATION_URL) — the app issues one-shot POST
 *     /_replicate against the local container, which resolves `server-couchdb`
 *     over the shared network. Aliases are network-scoped, so they never collide
 *     across workers.
 */

const COUCH_IMAGE = "couchdb:3.4";
const COUCH_PORT = 5984;
const COUCH_USER = "admin";
const COUCH_PASSWORD = "password";
const LOCAL_ALIAS = "local-couchdb";
const SERVER_ALIAS = "server-couchdb";

export type Harness = {
  /** Base URL of this worker's Express server (SPA + /api). */
  baseURL: string;
  /** Private Docker network shared by this harness's containers. */
  network: StartedNetwork;
  /** The "local" replica container — stop/start it to exercise offline flows. */
  localCouch: StartedTestContainer;
  /** The "server" replica container. */
  serverCouch: StartedTestContainer;
  /** Host endpoint of the local replica (http://host:port, no credentials) —
   *  for specs that read/write CouchDB directly. Pass auth via a header. */
  localCouchUrl: string;
  /** Host endpoint of the server replica (http://host:port, no credentials). */
  serverCouchUrl: string;
  /** Tear down the server process, both containers, and the network. */
  stop: () => Promise<void>;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function couchUrl(host: string, port: number): string {
  return `http://${COUCH_USER}:${COUCH_PASSWORD}@${host}:${port}`;
}

async function startCouch(network: StartedNetwork, alias: string): Promise<StartedTestContainer> {
  return new GenericContainer(COUCH_IMAGE)
    .withEnvironment({
      COUCHDB_USER: COUCH_USER,
      COUCHDB_PASSWORD: COUCH_PASSWORD,
      // Single-node mode creates the system DBs (_users/_global_changes) at boot,
      // silencing the cluster-setup warnings. The app doesn't depend on them.
      COUCHDB_SINGLE_NODE: "true"
    })
    .withNetwork(network)
    .withNetworkAliases(alias)
    .withExposedPorts(COUCH_PORT)
    .withWaitStrategy(Wait.forHttp("/_up", COUCH_PORT).forStatusCode(200))
    .start();
}

/** Reserve a free TCP port by binding to :0 and releasing it. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/**
 * Kill a detached child and its whole process group. `tsx` forks an inner node
 * process, so killing only child.pid would orphan it — we signal the group
 * (negative pid) and escalate to SIGKILL if it doesn't exit promptly.
 */
async function killProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  if (!pid) return;
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        /* already gone */
      }
    }
  };
  signalGroup("SIGTERM");
  const exited = await Promise.race([
    once(child, "exit").then(() => true),
    delay(5_000).then(() => false)
  ]);
  if (!exited) signalGroup("SIGKILL");
}

/** Poll /api/health until ready, failing fast if the process exits first. */
async function waitForServer(child: ChildProcess, baseURL: string, timeoutMs = 60_000): Promise<void> {
  const logs: string[] = [];
  child.stdout?.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr?.on("data", (chunk) => logs.push(String(chunk)));
  let exited = false;
  let exitInfo = "";
  child.once("exit", (code, signal) => {
    exited = true;
    exitInfo = `code=${code} signal=${signal}`;
  });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(`server exited before becoming ready (${exitInfo})\n${logs.join("")}`);
    }
    try {
      const response = await fetch(`${baseURL}/api/health`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await delay(300);
  }
  throw new Error(`server not ready within ${timeoutMs}ms\n${logs.join("")}`);
}

/**
 * Spawn the Express server against the given CouchDB host ports. We pass an
 * explicit free API_PORT (the server has no EADDRINUSE recovery — see
 * src/server/index.ts app.listen), and retry on the rare bind race.
 */
async function startServer(local: StartedTestContainer, server: StartedTestContainer): Promise<{ child: ChildProcess; baseURL: string }> {
  // The API reaches CouchDB over the Docker-mapped host endpoint. testcontainers'
  // host is not always "localhost" (e.g. a bridge gateway like 172.x), so always
  // resolve it via getHost() rather than assuming localhost.
  const localCouchUrl = couchUrl(local.getHost(), local.getMappedPort(COUCH_PORT));
  const serverCouchUrl = couchUrl(server.getHost(), server.getMappedPort(COUCH_PORT));
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = await getFreePort();
    const child = spawn("npx", ["tsx", "src/server/index.ts"], {
      cwd: process.cwd(),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // NODE_ENV=production mounts the dist/ static SPA; E2E=1 unlocks /api/reset
        // despite the production guard (src/server/index.ts).
        NODE_ENV: "production",
        E2E: "1",
        API_PORT: String(port),
        LOCAL_COUCH_URL: localCouchUrl,
        SERVER_COUCH_URL: serverCouchUrl,
        // Container-to-container replication resolves the network aliases, not the
        // host endpoint, so these stay alias-based.
        LOCAL_COUCH_REPLICATION_URL: couchUrl(LOCAL_ALIAS, COUCH_PORT),
        SERVER_COUCH_REPLICATION_URL: couchUrl(SERVER_ALIAS, COUCH_PORT)
      }
    });
    const baseURL = `http://localhost:${port}`;
    try {
      await waitForServer(child, baseURL);
      return { child, baseURL };
    } catch (error) {
      lastError = error;
      await killProcess(child);
    }
  }
  throw new Error(`Express server failed to start after 3 attempts: ${String(lastError)}`);
}

export async function startHarness(): Promise<Harness> {
  const network = await new Network().start();
  let localCouch: StartedTestContainer | undefined;
  let serverCouch: StartedTestContainer | undefined;
  let child: ChildProcess | undefined;

  const teardown = async () => {
    if (child) await killProcess(child);
    await Promise.allSettled([localCouch?.stop(), serverCouch?.stop()]);
    await network.stop();
  };

  try {
    [localCouch, serverCouch] = await Promise.all([
      startCouch(network, LOCAL_ALIAS),
      startCouch(network, SERVER_ALIAS)
    ]);
    const started = await startServer(localCouch, serverCouch);
    child = started.child;
    return {
      baseURL: started.baseURL,
      network,
      localCouch,
      serverCouch,
      localCouchUrl: `http://${localCouch.getHost()}:${localCouch.getMappedPort(COUCH_PORT)}`,
      serverCouchUrl: `http://${serverCouch.getHost()}:${serverCouch.getMappedPort(COUCH_PORT)}`,
      stop: teardown
    };
  } catch (error) {
    await teardown();
    throw error;
  }
}
