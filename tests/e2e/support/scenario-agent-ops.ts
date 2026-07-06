import type { APIRequestContext } from "@playwright/test";

/**
 * M28 agent-ops seeding (ADR-0021), composing on the digital-twin fixture: the operator
 * directory identity (`person:agent-operator` + `group:agent-operators`) and the
 * agent-ops app under a per-seed appId, with the twin-world access grants (managers
 * request sessions; operators work them). Public HTTP APIs only, like every fixture.
 */

export const AGENT_OPERATOR_USERNAME = "agent-operator";
export const AGENT_OPERATOR_PASSWORD = "operator-password-1";

export type AgentOpsScenario = {
  agentOpsAppId: string;
  operatorUsername: string;
  operatorPassword: string;
};

export type SeedAgentOpsOptions = {
  agentOpsAppId?: string;
};

let agentOpsSeedSequence = 0;

type Json = Record<string, unknown>;

async function requestJson<T = Json>(
  context: APIRequestContext,
  method: "get" | "post" | "put",
  path: string,
  data?: unknown,
  expected: number[] = [200, 201]
): Promise<T> {
  const response = await context[method](path, data === undefined ? undefined : { data });
  if (!expected.includes(response.status())) {
    const body = await response.text();
    throw new Error(`${method.toUpperCase()} ${path} -> ${response.status()}: ${body.slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

export async function seedAgentOps(
  admin: APIRequestContext,
  options: SeedAgentOpsOptions = {}
): Promise<AgentOpsScenario> {
  agentOpsSeedSequence += 1;
  const agentOpsAppId = options.agentOpsAppId ?? `agent-ops-o${agentOpsSeedSequence}`;

  // 1. Operator identity — idempotent against re-seeds within a worker.
  const directory = await requestJson<{ people: Array<{ username: string }>; groups: Array<{ _id: string; members: string[] }> }>(
    admin,
    "get",
    "/api/names/directory"
  );
  if (!directory.people.some((person) => person.username === AGENT_OPERATOR_USERNAME)) {
    await requestJson(admin, "post", "/api/names/people", {
      username: AGENT_OPERATOR_USERNAME,
      displayName: "Agent Operator",
      password: AGENT_OPERATOR_PASSWORD
    });
  }
  const operatorGroup = directory.groups.find((group) => group._id === "group:agent-operators");
  if (operatorGroup) {
    await requestJson(admin, "put", "/api/names/groups/agent-operators", {
      members: Array.from(new Set([...operatorGroup.members, `person:${AGENT_OPERATOR_USERNAME}`]))
    });
  } else {
    await requestJson(admin, "post", "/api/names/groups", {
      slug: "agent-operators",
      name: "Agent Operators",
      members: [`person:${AGENT_OPERATOR_USERNAME}`]
    });
  }

  // 2. Deploy agent-ops per-seed (ADR-0016) and grant the twin-world access:
  // managers file session requests; operators claim and work them.
  await requestJson(
    admin,
    "post",
    "/api/platform/apps",
    { appId: agentOpsAppId, title: "Agent Operations", fromTemplate: "agent-ops" },
    [201]
  );
  await requestJson(admin, "put", `/api/apps/${agentOpsAppId}/access`, {
    entries: [
      { principal: "group:admins", level: "manager" },
      { principal: "group:agent-operators", level: "editor" },
      { principal: "group:managers", level: "author" }
    ]
  });

  return {
    agentOpsAppId,
    operatorUsername: AGENT_OPERATOR_USERNAME,
    operatorPassword: AGENT_OPERATOR_PASSWORD
  };
}

/** File a session as a requester: create the draft and submit it into the queue. */
export async function fileAgentSession(
  requester: APIRequestContext,
  agentOpsAppId: string,
  payload: { persona: string; driver: string }
): Promise<{ _id: string }> {
  const doc = await requestJson<{ _id: string }>(
    requester,
    "post",
    `/api/apps/${agentOpsAppId}/documents`,
    { docType: "agent-session", payload },
    [201]
  );
  await requestJson(requester, "post", `/api/apps/${agentOpsAppId}/documents/${encodeURIComponent(doc._id)}/transition`, {
    transition: "submit"
  });
  return doc;
}
