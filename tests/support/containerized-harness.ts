import {
  GenericContainer,
  Network,
  Wait,
  type StartedNetwork,
  type StartedTestContainer
} from "testcontainers";

const COUCH_IMAGE = "couchdb:3.4";
const COUCH_PORT = 5984;
const COUCH_USER = "admin";
const COUCH_PASSWORD = "password";
const LOCAL_ALIAS = "local-couchdb";
const SERVER_ALIAS = "server-couchdb";
export const LOTUS_API_ALIAS = "lotus-api";
export const LOTUS_MCP_ALIAS = "lotus-mcp";
export const LOTUS_API_PORT = 3001;
export const LOTUS_MCP_PORT = 3002;
const LOTUS_IMAGE = "lotus-notes-platform:playground";

export type ContainerizedAgentMcpHost = {
  port: number;
  internalBaseURL: string;
  surfaceUrl(surface: "admin" | "designer" | "workspace"): string;
  internalSurfaceUrl(surface: "admin" | "designer" | "workspace"): string;
  stop(): Promise<void>;
};

export type ContainerizedHarness = {
  baseURL: string;
  internalBaseURL: string;
  network: StartedNetwork;
  localCouch: StartedTestContainer;
  serverCouch: StartedTestContainer;
  api: StartedTestContainer;
  host: ContainerizedAgentMcpHost;
  stop(): Promise<void>;
};

function couchUrl(alias: string): string {
  return `http://${COUCH_USER}:${COUCH_PASSWORD}@${alias}:${COUCH_PORT}`;
}

async function buildLotusImage(): Promise<void> {
  await GenericContainer.fromDockerfile(process.cwd(), "Dockerfile")
    .withBuildkit()
    .withCache(true)
    .build(LOTUS_IMAGE, { deleteOnExit: false });
}

async function startCouch(network: StartedNetwork, alias: string): Promise<StartedTestContainer> {
  return new GenericContainer(COUCH_IMAGE)
    .withEnvironment({
      COUCHDB_USER: COUCH_USER,
      COUCHDB_PASSWORD: COUCH_PASSWORD,
      COUCHDB_SINGLE_NODE: "true"
    })
    .withNetwork(network)
    .withNetworkAliases(alias)
    .withExposedPorts(COUCH_PORT)
    .withWaitStrategy(Wait.forHttp("/_up", COUCH_PORT).forStatusCode(200))
    .start();
}

async function startApi(network: StartedNetwork): Promise<StartedTestContainer> {
  return new GenericContainer(LOTUS_IMAGE)
    .withEnvironment({
      NODE_ENV: "production",
      E2E: "1",
      API_PORT: String(LOTUS_API_PORT),
      LOCAL_COUCH_URL: couchUrl(LOCAL_ALIAS),
      SERVER_COUCH_URL: couchUrl(SERVER_ALIAS),
      LOCAL_COUCH_REPLICATION_URL: couchUrl(LOCAL_ALIAS),
      SERVER_COUCH_REPLICATION_URL: couchUrl(SERVER_ALIAS)
    })
    .withNetwork(network)
    .withNetworkAliases(LOTUS_API_ALIAS)
    .withExposedPorts(LOTUS_API_PORT)
    .withWaitStrategy(Wait.forHttp("/api/health", LOTUS_API_PORT).forStatusCode(200))
    .start();
}

async function startMcpHost(network: StartedNetwork): Promise<ContainerizedAgentMcpHost> {
  const container = await new GenericContainer(LOTUS_IMAGE)
    .withCommand(["npm", "run", "mcp:http"])
    .withEnvironment({
      LOTUS_API_URL: `http://${LOTUS_API_ALIAS}:${LOTUS_API_PORT}`,
      MCP_HTTP_PORT: String(LOTUS_MCP_PORT)
    })
    .withNetwork(network)
    .withNetworkAliases(LOTUS_MCP_ALIAS)
    .withExposedPorts(LOTUS_MCP_PORT)
    .withWaitStrategy(Wait.forHttp("/healthz", LOTUS_MCP_PORT).forStatusCode(200))
    .start();
  return {
    port: container.getMappedPort(LOTUS_MCP_PORT),
    internalBaseURL: `http://${LOTUS_MCP_ALIAS}:${LOTUS_MCP_PORT}`,
    surfaceUrl(surface) {
      return `http://${container.getHost()}:${container.getMappedPort(LOTUS_MCP_PORT)}/mcp/${surface}`;
    },
    internalSurfaceUrl(surface) {
      return `http://${LOTUS_MCP_ALIAS}:${LOTUS_MCP_PORT}/mcp/${surface}`;
    },
    async stop() {
      await container.stop();
    }
  };
}

export async function startContainerizedHarness(): Promise<ContainerizedHarness> {
  const network = await new Network().start();
  let localCouch: StartedTestContainer | undefined;
  let serverCouch: StartedTestContainer | undefined;
  let api: StartedTestContainer | undefined;
  let host: ContainerizedAgentMcpHost | undefined;

  const teardown = async () => {
    await Promise.allSettled([host?.stop(), api?.stop(), localCouch?.stop(), serverCouch?.stop()]);
    await network.stop();
  };

  try {
    await buildLotusImage();
    [localCouch, serverCouch] = await Promise.all([
      startCouch(network, LOCAL_ALIAS),
      startCouch(network, SERVER_ALIAS)
    ]);
    api = await startApi(network);
    host = await startMcpHost(network);
    return {
      baseURL: `http://${api.getHost()}:${api.getMappedPort(LOTUS_API_PORT)}`,
      internalBaseURL: `http://${LOTUS_API_ALIAS}:${LOTUS_API_PORT}`,
      network,
      localCouch,
      serverCouch,
      api,
      host,
      stop: teardown
    };
  } catch (error) {
    await teardown();
    throw error;
  }
}
