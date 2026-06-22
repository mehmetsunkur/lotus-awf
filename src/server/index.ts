import cors from "cors";
import express, { type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";
import type {
  AccessLevel,
  AclRules,
  AgentDefinition,
  AgentRun,
  AgentState,
  AppInstall,
  AppConfig,
  AuditAction,
  AuditEvent,
  AuditPolicy,
  AuditState,
  BusinessDocument,
  ConflictDetails,
  CouchDocument,
  DesignDocument,
  FormDefinition,
  GroupDocument,
  PersonDocument,
  PlatformConfig,
  PlatformState,
  SampleApp,
  SessionDocument,
  SessionState,
  SelectOptionsByField,
  TemplateArtifact,
  ViewDefinition,
  ViewFilter,
  WorkflowDefinition
} from "../shared/types";
import {
  accessSelector,
  canEditDocument,
  canReadDocument,
  accessRank,
  hasAccessLevel,
  principalsFor,
  readersForNewDocument,
  type PrincipalScope
} from "../shared/access";
import { validateDesignDefinition } from "../shared/definition-validation";
import {
  diffTemplateDefinitions,
  normalizeDefinitions,
  stripDefinitionRev
} from "../shared/template";
import { applyComputedFields, normalizePayload, validatePayload } from "../shared/validation";
import { applyTransition, currentState } from "../shared/workflow";
import { agentIsDue, agentIsEnabled, agentMatchesChange, agentRunKey } from "../shared/agents";
import { searchDocuments } from "../shared/search";
import { auditAction, eventIsExpired, shouldAudit } from "../shared/audit";
import { scaffoldDocumentType, validateDocType } from "../shared/scaffold";
import { HANDLER_MANIFEST } from "../shared/handlers/manifest";
import { clearEffectLog, readEffectLog, runEffect } from "./handlers/effects";
import { runAgentHandler } from "./handlers/agents";
import {
  allDocs,
  allRuntimeDocs,
  bulkDocs,
  changesSince,
  couchRequest,
  CouchError,
  createIndex,
  dbExists,
  deleteDb,
  deleteDoc,
  ensureDb,
  getBusinessDocs,
  getDesignDoc,
  getDoc,
  findDocs,
  ping,
  putDoc,
  purgeDocs,
  replicateBidirectional
} from "./couch";
import { config } from "./config";
import { createDocument, createExpenseDoc, seedDocuments } from "./seed-data";
import { validateTemplateDefinitions } from "./template-registry";
import {
  clearSessionCookie,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  normalizeUsername,
  personIdForUsername,
  publicPerson,
  sessionTokenFromRequest,
  setSessionCookie,
  verifyPassword
} from "./auth";

const app = express();

app.use(cors());
app.use(express.json());

const asyncRoute =
  (handler: express.RequestHandler): express.RequestHandler =>
  (request, response, next) =>
    Promise.resolve(handler(request, response, next)).catch(next);

const timestamp = () => new Date().toISOString();
const routeParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value ?? "");
const DEV_PASSWORD = "password123";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

async function seedTarget(target: "local" | "server", reset = false) {
  if (reset) {
    await deleteDb(target);
  }
  await ensureDb(target);
  await bulkDocs(target, seedDocuments());
  await ensureIndexes(target);
}

async function ensureNamedDb(target: "local" | "server", db: string) {
  await ensureDb(target, db);
}

async function putDocInDb<T extends { _id: string; _rev?: string }>(
  target: "local" | "server",
  db: string,
  doc: T
): Promise<{ ok: boolean; id: string; rev: string }> {
  return couchRequest(target, `/${db}/${encodeURIComponent(doc._id)}`, {
    method: "PUT",
    body: JSON.stringify(doc)
  });
}

async function upsertDocInDb<T extends { _id: string; _rev?: string }>(
  target: "local" | "server",
  db: string,
  doc: T
): Promise<{ ok: boolean; id: string; rev: string }> {
  try {
    const existing = await getDocFromNamedDb<{ _rev?: string }>(target, db, doc._id);
    return putDocInDb(target, db, { ...doc, _rev: existing._rev });
  } catch (error) {
    if (error instanceof CouchError && error.status === 404) return putDocInDb(target, db, { ...doc, _rev: undefined });
    throw error;
  }
}

async function getDocFromNamedDb<T>(target: "local" | "server", db: string, id: string): Promise<T> {
  return couchRequest<T>(target, `/${db}/${encodeURIComponent(id)}`);
}

async function allDocsFromDb<T>(target: "local" | "server", db: string) {
  return couchRequest<{ rows: Array<{ id: string; doc?: T }> }>(
    target,
    `/${db}/_all_docs?include_docs=true`
  );
}

async function docExistsInDb(target: "local" | "server", db: string, id: string) {
  try {
    await getDocFromNamedDb(target, db, id);
    return true;
  } catch (error) {
    if (error instanceof CouchError && error.status === 404) return false;
    return false;
  }
}

async function deleteDocInDb(target: "local" | "server", db: string, id: string, rev: string): Promise<void> {
  await couchRequest(target, `/${db}/${encodeURIComponent(id)}?rev=${encodeURIComponent(rev)}`, { method: "DELETE" });
}

function emptySession(): SessionState {
  return { authenticated: false, groups: [], principals: [] };
}

function bestAccessLevel(levels: Array<AccessLevel | undefined>): AccessLevel {
  return levels.reduce<AccessLevel>((best, level) => (accessRank(level) > accessRank(best) ? level! : best), "none");
}

async function groupsForPerson(target: "local" | "server", personId: `person:${string}`): Promise<GroupDocument[]> {
  try {
    const rows = await allDocsFromDb<GroupDocument>(target, config.setupDb);
    return rows.rows
      .map((row) => row.doc)
      .filter((doc): doc is GroupDocument => Boolean(doc && doc.kind === "group" && doc.members.includes(personId)));
  } catch (error) {
    if (error instanceof CouchError && error.status === 404) return [];
    throw error;
  }
}

async function appAccessLevel(principals: string[]): Promise<AccessLevel> {
  const levels: AccessLevel[] = [];
  if (principals.includes("group:admins")) levels.push("manager");
  try {
    const acl = await getDoc<AclRules>("local", "acl:rules");
    for (const entry of acl.entries ?? []) {
      if (principals.includes(entry.principal)) levels.push(entry.level);
    }
  } catch (error) {
    if (!(error instanceof CouchError) || error.status !== 404) throw error;
  }
  return bestAccessLevel(levels);
}

async function sessionStateForPerson(person: PersonDocument): Promise<SessionState> {
  const groups = (await groupsForPerson("local", person._id)).map((group) => group._id);
  const principals = Array.from(new Set([person._id, ...groups]));
  return {
    authenticated: true,
    person: publicPerson(person),
    groups,
    principals,
    accessLevel: await appAccessLevel(principals)
  };
}

async function sessionStateForRequest(request?: Request): Promise<SessionState> {
  if (!request) return emptySession();
  const token = sessionTokenFromRequest(request);
  if (!token) return emptySession();
  try {
    const session = await getDocFromNamedDb<SessionDocument>("local", config.platformDb, `session:${hashSessionToken(token)}`);
    if (session.expiresAt <= timestamp()) return emptySession();
    const person = await getDocFromNamedDb<PersonDocument>("local", config.setupDb, session.personId);
    if (!person.active) return emptySession();
    return sessionStateForPerson(person);
  } catch (error) {
    if (error instanceof CouchError && error.status === 404) return emptySession();
    throw error;
  }
}

async function requireSession(request: Request, required: AccessLevel = "reader"): Promise<PrincipalScope> {
  const session = await sessionStateForRequest(request);
  if (!session.authenticated || !session.person) {
    throw new CouchError(401, { error: "unauthorized", reason: "Login required" });
  }
  const scope: PrincipalScope = {
    person: session.person._id,
    groups: session.groups,
    principals: session.principals,
    accessLevel: session.accessLevel
  };
  if (!hasAccessLevel(scope, required)) {
    throw new CouchError(403, { error: "forbidden", reason: `${required} access is required` });
  }
  return scope;
}

function scopeUser(scope: PrincipalScope): string {
  return scope.person;
}

async function createSession(response: Response, person: PersonDocument): Promise<SessionState> {
  const token = createSessionToken();
  const now = timestamp();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const session: SessionDocument = {
    _id: `session:${hashSessionToken(token)}`,
    kind: "session",
    personId: person._id,
    createdAt: now,
    expiresAt
  };
  await Promise.all([
    upsertDocInDb("local", config.platformDb, session),
    upsertDocInDb("server", config.platformDb, session)
  ]);
  setSessionCookie(response, token, expiresAt);
  return sessionStateForPerson(person);
}

async function logoutSession(request: Request, response: Response): Promise<void> {
  const token = sessionTokenFromRequest(request);
  if (token) {
    const id = `session:${hashSessionToken(token)}`;
    await Promise.all(
      (["local", "server"] as const).map(async (target) => {
        try {
          const existing = await getDocFromNamedDb<SessionDocument>(target, config.platformDb, id);
          await deleteDocInDb(target, config.platformDb, id, existing._rev ?? "");
        } catch (error) {
          if (!(error instanceof CouchError) || error.status !== 404) throw error;
        }
      })
    );
  }
  clearSessionCookie(response);
}

async function upsertPerson(target: "local" | "server", username: string, displayName: string, password: string): Promise<PersonDocument> {
  const normalized = normalizeUsername(username);
  const now = timestamp();
  const passwordFields = await hashPassword(password);
  const existing = await docExistsInDb(target, config.setupDb, personIdForUsername(normalized));
  const current = existing ? await getDocFromNamedDb<PersonDocument>(target, config.setupDb, personIdForUsername(normalized)) : undefined;
  const person: PersonDocument = {
    _id: personIdForUsername(normalized),
    kind: "person",
    username: normalized,
    displayName,
    active: true,
    ...passwordFields,
    createdAt: current?.createdAt ?? now,
    updatedAt: now
  };
  await upsertDocInDb(target, config.setupDb, person);
  return person;
}

async function upsertGroup(target: "local" | "server", id: `group:${string}`, name: string, members: Array<`person:${string}`>) {
  const now = timestamp();
  let createdAt = now;
  try {
    createdAt = (await getDocFromNamedDb<GroupDocument>(target, config.setupDb, id)).createdAt;
  } catch (error) {
    if (!(error instanceof CouchError) || error.status !== 404) throw error;
  }
  await upsertDocInDb<GroupDocument>(target, config.setupDb, {
    _id: id,
    kind: "group",
    name,
    members,
    createdAt,
    updatedAt: now
  });
}

async function seedDevDirectory(target: "local" | "server", adminUser = "alice", adminPassword = DEV_PASSWORD) {
  await seedSetupTarget(target);
  const alice = await upsertPerson(target, "alice", "Alice Finance", adminUser === "alice" ? adminPassword : DEV_PASSWORD);
  const bob = await upsertPerson(target, "bob", "Bob Sales", DEV_PASSWORD);
  if (adminUser !== "alice") await upsertPerson(target, adminUser, adminUser, adminPassword);
  await upsertGroup(target, "group:admins", "Admins", [personIdForUsername(adminUser)]);
  await upsertGroup(target, "group:finance", "Finance", [alice._id]);
  await upsertGroup(target, "group:sales", "Sales", [bob._id]);
}

async function seedExpenseSampleDirectory(target: "local" | "server", currentPerson?: `person:${string}`) {
  await seedSetupTarget(target);
  const alice = await upsertPerson(target, "alice", "Alice Finance", DEV_PASSWORD);
  const bob = await upsertPerson(target, "bob", "Bob Sales", DEV_PASSWORD);
  const financeMembers = Array.from(new Set([alice._id, currentPerson].filter(Boolean))) as Array<`person:${string}`>;
  await upsertGroup(target, "group:finance", "Finance", financeMembers);
  await upsertGroup(target, "group:sales", "Sales", [bob._id]);
}

async function ensureIndexes(target: "local" | "server") {
  await createIndex(target, "m2-kind-docType-updatedAt", ["kind", "docType", "updatedAt"]);
  await createIndex(target, "m2-readers", ["readers"]);
  await createIndex(target, "m3-docType-state-updatedAt", ["docType", "state", "updatedAt"]);
}

async function expenseAppInstalled(target: "local" | "server") {
  try {
    await getDoc<AppConfig>(target, "app:config");
    return true;
  } catch (error) {
    if (error instanceof CouchError && error.status === 404) return false;
    return false;
  }
}

async function seedSetupTarget(target: "local" | "server") {
  await ensureNamedDb(target, config.setupDb);
  if (!(await docExistsInDb(target, config.setupDb, "app:config"))) {
    await putDocInDb<AppConfig>(target, config.setupDb, {
      _id: "app:config",
      kind: "app",
      appId: "setup",
      title: "Setup",
      database: config.setupDb
    });
  }
}

async function seedPlatformTarget(target: "local" | "server") {
  await ensureNamedDb(target, config.platformDb);
  if (!(await docExistsInDb(target, config.platformDb, "platform:config"))) {
    await putDocInDb<PlatformConfig>(target, config.platformDb, {
      _id: "platform:config",
      kind: "platformconfig",
      setupComplete: false
    });
  }
}

async function platformConfig(): Promise<PlatformConfig> {
  try {
    return await getDocFromNamedDb<PlatformConfig>("local", config.platformDb, "platform:config");
  } catch (error) {
    if (error instanceof CouchError && error.status === 404) {
      return { _id: "platform:config", kind: "platformconfig", setupComplete: false };
    }
    throw error;
  }
}

async function installedApps(): Promise<AppInstall[]> {
  try {
    const rows = await allDocsFromDb<AppInstall>("local", config.platformDb);
    return rows.rows
      .map((row) => row.doc)
      .filter((doc): doc is AppInstall => Boolean(doc && doc.kind === "appinstall"))
      .sort((left, right) => left.title.localeCompare(right.title));
  } catch (error) {
    if (error instanceof CouchError && error.status === 404) return [];
    throw error;
  }
}

async function platformState(request?: Request): Promise<PlatformState> {
  const [platform, apps, expenseInstalled, session] = await Promise.all([
    platformConfig(),
    installedApps(),
    expenseAppInstalled("local"),
    sessionStateForRequest(request)
  ]);
  const samples: SampleApp[] = [
    {
      appId: "expense",
      title: "Expense sample",
      database: config.appDb,
      description: "A sample approval app with forms, views, workflow, agents, search, and audit.",
      installed: apps.some((app) => app.appId === "expense") || expenseInstalled
    }
  ];
  return {
    setupComplete: platform.setupComplete,
    orgName: platform.orgName,
    domainName: platform.domainName,
    adminUser: platform.adminUser,
    session,
    installedApps: apps,
    samples
  };
}

function expenseInstallRecord(installedAt = timestamp(), installedBy = "person:alice"): AppInstall {
  return {
    _id: "appinstall:expense",
    kind: "appinstall",
    appId: "expense",
    title: "Expense sample",
    database: config.appDb,
    templateId: "sample:expense",
    installedAt,
    installedBy
  };
}

async function markExpenseInstalled(target: "local" | "server") {
  await upsertDocInDb(target, config.platformDb, expenseInstallRecord());
}

async function completeDevPlatformSetup(target: "local" | "server") {
  const now = timestamp();
  await seedSetupTarget(target);
  await seedPlatformTarget(target);
  await seedDevDirectory(target);
  await upsertDocInDb<PlatformConfig>(target, config.platformDb, {
    _id: "platform:config",
    kind: "platformconfig",
    setupComplete: true,
    orgName: "Development Org",
    domainName: "dev.local",
    adminUser: "alice",
    createdAt: now,
    updatedAt: now
  });
  await markExpenseInstalled(target);
}

async function waitForCouch(target: "local" | "server", attempts = 60) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await ping(target)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${target} CouchDB was not reachable after ${attempts} seconds`);
}

async function autoSetupPackagedApp() {
  if (!config.autoSetup) return;
  try {
    await Promise.all([waitForCouch("local"), waitForCouch("server")]);
    await Promise.all([seedSetupTarget("local"), seedSetupTarget("server"), seedPlatformTarget("local"), seedPlatformTarget("server")]);
    console.log(`Installed setup.nsf (${config.setupDb}) and platform catalog (${config.platformDb})`);
  } catch (error) {
    console.error("packaged app auto-setup failed", error);
  }
}

async function replicationTasks() {
  const [localTasks, serverTasks] = await Promise.allSettled([
    couchRequest("local", "/_active_tasks"),
    couchRequest("server", "/_active_tasks")
  ]);
  return [
    { target: "local", value: localTasks.status === "fulfilled" ? localTasks.value : [] },
    { target: "server", value: serverTasks.status === "fulfilled" ? serverTasks.value : [] }
  ];
}

async function conflictDetails(id: string, scope?: PrincipalScope): Promise<ConflictDetails | null> {
  const winning = await getDoc<CouchDocument & { _conflicts?: string[] }>("local", id, "?conflicts=true");
  if (scope && winning.kind === "document" && !canReadDocument(winning, scope)) {
    throw new CouchError(403, { error: "forbidden", reason: "Document is not readable by current user" });
  }
  if (!winning._conflicts?.length) return null;

  const conflicts = await Promise.all(
    winning._conflicts.map((rev: string) =>
      getDoc<CouchDocument>("local", id, `?rev=${encodeURIComponent(rev)}`)
    )
  );

  return { document: winning, winning, conflicts };
}

function mangoSelector(filters: ViewFilter[] = [], docType?: string) {
  const selector: Record<string, unknown> = { kind: "document" };
  if (docType) selector.docType = docType;

  for (const filter of filters) {
    const op = filter.op === "eq" ? "$eq" : filter.op === "ne" ? "$ne" : `$${filter.op}`;
    selector[filter.field] = { [op]: filter.value };
  }

  return selector;
}

async function formForDocType(docType: string) {
  return getDoc<FormDefinition>("local", `form:${docType}`);
}

async function workflowForDocType(docType: string): Promise<WorkflowDefinition | null> {
  try {
    return await getDoc<WorkflowDefinition>("local", `workflow:${docType}`);
  } catch (error) {
    if (error instanceof CouchError && error.status === 404) return null;
    throw error;
  }
}

async function loadAuditPolicy(): Promise<AuditPolicy | undefined> {
  try {
    return await getDoc<AuditPolicy>("local", "audit:policy");
  } catch (error) {
    if (error instanceof CouchError && error.status === 404) return undefined;
    throw error;
  }
}

async function currentDefinitions(): Promise<DesignDocument[]> {
  const [appConfig, acl, auditPolicy, forms, views, workflows, agents] = await Promise.all([
    getDoc<AppConfig>("local", "app:config"),
    getDoc<AclRules>("local", "acl:rules"),
    loadAuditPolicy(),
    findDocs<FormDefinition>("local", { selector: { kind: "form" }, limit: 100 }),
    findDocs<ViewDefinition>("local", { selector: { kind: "view" }, limit: 100 }),
    findDocs<WorkflowDefinition>("local", { selector: { kind: "workflow" }, limit: 100 }),
    findDocs<AgentDefinition>("local", { selector: { kind: "agent" }, limit: 100 })
  ]);

  const designDocs: DesignDocument[] = [appConfig, acl];
  if (auditPolicy) designDocs.push(auditPolicy);
  return normalizeDefinitions([...designDocs, ...forms.docs, ...views.docs, ...workflows.docs, ...agents.docs]);
}

function generatedTemplateVersion() {
  return `v${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
}

async function applyDefinition(definition: DesignDocument) {
  let currentRev: string | undefined;
  try {
    currentRev = (await getDoc<DesignDocument>("local", definition._id))._rev;
  } catch (error) {
    if (!(error instanceof CouchError) || error.status !== 404) throw error;
  }

  const next = { ...stripDefinitionRev(definition), _rev: currentRev } as DesignDocument;
  return putDoc("local", next);
}

/** Whether a design document with this id already exists locally. */
async function definitionExists(id: string): Promise<boolean> {
  try {
    await getDoc("local", id);
    return true;
  } catch (error) {
    if (error instanceof CouchError && error.status === 404) return false;
    throw error;
  }
}

async function getReadableDocument(id: string, scope: PrincipalScope): Promise<BusinessDocument> {
  const doc = await getDoc<BusinessDocument>("local", id);
  if (!canReadDocument(doc, scope)) {
    throw new CouchError(403, { error: "forbidden", reason: "Document is not readable by current user" });
  }
  return doc;
}

async function purgeUnreadableLocalDocs(scope: PrincipalScope) {
  const [localResult, serverVisible] = await Promise.all([
    allDocs<BusinessDocument & { _conflicts?: string[] }>("local", {
      include_docs: true,
      conflicts: true
    }),
    findDocs<BusinessDocument>("server", {
      selector: {
        kind: "document",
        ...accessSelector(scope)
      },
      limit: 1000
    })
  ]);
  const serverVisibleIds = new Set(serverVisible.docs.map((doc) => doc._id));
  const result = localResult;
  const revisions: Record<string, string[]> = {};

  for (const row of result.rows) {
    const doc = row.doc;
    if (!doc || doc.kind !== "document") continue;
    if (canReadDocument(doc, scope) && serverVisibleIds.has(doc._id)) continue;
    const revs = [doc._rev, ...(doc._conflicts ?? [])].filter((rev): rev is string => Boolean(rev));
    if (revs.length) revisions[doc._id] = revs;
  }

  if (!Object.keys(revisions).length) return { purged: [] };
  await purgeDocs("local", revisions);
  return { purged: Object.keys(revisions) };
}

/**
 * Post-sync reconcile (aspect A4). The CouchDB server cannot reject a replicated
 * revision, so authority over offline transitions is exercised here: we surface
 * documents whose conflicting revisions disagree on `state` (concurrent offline
 * transitions) and flag any winning state the workflow does not declare, so
 * nothing passes silently. The conflicting docs already appear in the conflict
 * queue; this report makes the state divergence explicit.
 */
async function reconcileStates(): Promise<{
  stateConflicts: Array<{ id: string; states: string[] }>;
  invalidStates: Array<{ id: string; state: string }>;
}> {
  const result = await allDocs<CouchDocument & { _conflicts?: string[] }>("local", {
    include_docs: true,
    conflicts: true
  });

  const stateConflicts: Array<{ id: string; states: string[] }> = [];
  const invalidStates: Array<{ id: string; state: string }> = [];
  const workflowCache = new Map<string, WorkflowDefinition | null>();

  for (const row of result.rows) {
    const doc = row.doc;
    if (!doc || doc.kind !== "document") continue;

    if (!workflowCache.has(doc.docType)) {
      workflowCache.set(doc.docType, await workflowForDocType(doc.docType));
    }
    const def = workflowCache.get(doc.docType);
    if (!def) continue;

    if (doc._conflicts?.length) {
      const revs = await Promise.all(
        doc._conflicts.map((rev) =>
          getDoc<BusinessDocument>("local", doc._id, `?rev=${encodeURIComponent(rev)}`)
        )
      );
      const states = Array.from(new Set([currentState(doc, def), ...revs.map((rev) => currentState(rev, def))]));
      if (states.length > 1) stateConflicts.push({ id: doc._id, states });
    }

    const winningState = currentState(doc, def);
    if (!def.states.some((state) => state.name === winningState)) {
      invalidStates.push({ id: doc._id, state: winningState });
    }
  }

  if (stateConflicts.length || invalidStates.length) {
    console.warn("reconcileStates findings", { stateConflicts, invalidStates });
  }
  return { stateConflicts, invalidStates };
}

/**
 * Agent tick (M8). Server-authoritative and explicit, mirroring the manual
 * `/api/replicate` idiom: run scheduled agents that are due, then drain the
 * `_changes` feed since the stored checkpoint and run matching on-change agents.
 * At-least-once and idempotent — on-change work is deduped by (agentId + rev) so
 * a reprocessed change never runs twice, the checkpoint advances only after runs
 * are written, and a failing handler records a failed run via the fail-closed
 * `runAgentHandler` rather than crashing the tick or its siblings. Devices never
 * run agents; results replicate like any other local write.
 */
async function loadAgentState(appId: string): Promise<AgentState> {
  try {
    return await getDoc<AgentState>("local", "agent:state");
  } catch {
    return { _id: "agent:state", kind: "agentstate", appId, lastSeq: "0", lastRunAt: {} };
  }
}

async function existingRunKeys(): Promise<Set<string>> {
  // {kind:"agentrun"} binds the m2 index (kind is its leading field) — no new index.
  const result = await findDocs<AgentRun>("local", { selector: { kind: "agentrun" }, limit: 2000 });
  return new Set(result.docs.map((run) => agentRunKey(run.agentId, run.sourceRev)));
}

function buildAgentRun(
  appId: string,
  agent: AgentDefinition,
  trigger: AgentRun["trigger"],
  document: BusinessDocument | undefined,
  result: { ok: boolean; detail: string },
  now: string
): AgentRun {
  return {
    _id: `agentrun:${ulid()}`,
    kind: "agentrun",
    appId,
    agentId: agent._id,
    trigger,
    sourceId: document?._id,
    sourceRev: document?._rev,
    startedAt: now,
    ok: result.ok,
    detail: result.detail,
    readers: document?.readers ?? ["group:admins"]
  };
}

async function runAgentsOnce(now = timestamp()): Promise<{ ran: number; runs: AgentRun[] }> {
  const agents = (await findDocs<AgentDefinition>("local", { selector: { kind: "agent" }, limit: 100 })).docs.filter(
    agentIsEnabled
  );
  if (!agents.length) return { ran: 0, runs: [] };

  const appConfig = await getDoc<AppConfig>("local", "app:config");
  const state = await loadAgentState(appConfig.appId);
  const seenKeys = await existingRunKeys();
  const runs: AgentRun[] = [];

  // Scheduled agents that are due (dedupe via the per-agent lastRunAt stamp).
  for (const agent of agents) {
    if (agent.trigger.type !== "schedule" || !agentIsDue(agent, state.lastRunAt[agent._id], now)) continue;
    const result = await runAgentHandler(agent.handler, { agent, trigger: "schedule", now });
    runs.push(buildAgentRun(appConfig.appId, agent, "schedule", undefined, result, now));
    state.lastRunAt[agent._id] = now;
  }

  // On-change agents: drain the changes feed since the checkpoint.
  const onChangeAgents = agents.filter((agent) => agent.trigger.type === "on-change");
  if (onChangeAgents.length) {
    const changes = await changesSince("local", state.lastSeq);
    for (const change of changes.results) {
      const doc = change.doc;
      if (change.deleted || !doc || doc.kind !== "document") continue;
      for (const agent of onChangeAgents) {
        if (!agentMatchesChange(agent, doc)) continue;
        const key = agentRunKey(agent._id, doc._rev);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        const result = await runAgentHandler(agent.handler, { agent, trigger: "on-change", document: doc, now });
        runs.push(buildAgentRun(appConfig.appId, agent, "on-change", doc, result, now));
      }
    }
    state.lastSeq = String(changes.last_seq);
  }

  // Write runs first, then advance the checkpoint — a crash in between only
  // causes a (deduped) replay, never a lost run.
  for (const run of runs) await putDoc("local", run);
  await putDoc("local", state);
  return { ran: runs.length, runs };
}

// Serialize ticks: agent:state is read at tick start and written at tick end, so
// two overlapping ticks (a manual POST overlapping the optional interval loop, or
// two manual POSTs) could double-run or 409 on the checkpoint write. Chaining
// every tick onto the previous one makes the runtime single-writer in-process.
let agentTickChain: Promise<unknown> = Promise.resolve();
function runAgents(now = timestamp()): Promise<{ ran: number; runs: AgentRun[] }> {
  const next = agentTickChain.catch(() => undefined).then(() => runAgentsOnce(now));
  agentTickChain = next;
  return next;
}

// --- Audit & retention (M10) --------------------------------------------------
// Server-authoritative, CDC-driven, mirroring the agent runtime: the tick drains
// `_changes` since its own `audit:state` checkpoint, records a durable semantic
// event per business-document create/update, and prunes events past the policy's
// retention horizon. Deletes are recorded at the API delete path (the feed has no
// body for a deleted doc). `auditevent`/`audit:state` writes reappear in the feed
// but `shouldAudit` skips non-`document` kinds, so the recorder never audits
// itself. Audit visibility mirrors the source document's `readers`.

async function loadAuditState(appId: string): Promise<AuditState> {
  try {
    return await getDoc<AuditState>("local", "audit:state");
  } catch {
    return { _id: "audit:state", kind: "auditstate", appId, lastSeq: "0" };
  }
}

function buildAuditEvent(
  appId: string,
  doc: BusinessDocument,
  action: AuditAction,
  now: string,
  actor = doc.updatedBy
): AuditEvent {
  return {
    _id: `auditevent:${ulid()}`,
    kind: "auditevent",
    appId,
    docId: doc._id,
    docType: doc.docType,
    rev: doc._rev ?? "",
    action,
    actor,
    at: now,
    readers: doc.readers
  };
}

async function runAuditOnce(now = timestamp()): Promise<{ recorded: number; pruned: number }> {
  const appConfig = await getDoc<AppConfig>("local", "app:config");
  const policy = await loadAuditPolicy();
  const state = await loadAuditState(appConfig.appId);

  // One read serves both dedupe (docId@rev) and retention. {kind:"auditevent"}
  // binds the kind-leading m2 index — no new index.
  const existing = await findDocs<AuditEvent>("local", { selector: { kind: "auditevent" }, limit: 2000 });
  const seen = new Set(existing.docs.map((event) => `${event.docId}@${event.rev}`));

  const changes = await changesSince("local", state.lastSeq);
  const events: AuditEvent[] = [];
  for (const change of changes.results) {
    const doc = change.doc as BusinessDocument | undefined;
    if (change.deleted || !doc || !shouldAudit(doc, policy)) continue;
    const key = `${doc._id}@${doc._rev ?? ""}`;
    if (seen.has(key)) continue; // at-least-once: a replayed change is recorded once
    seen.add(key);
    events.push(buildAuditEvent(appConfig.appId, doc, auditAction(doc._rev, false), now));
  }

  // Write events first, then advance the checkpoint — a crash in between only
  // re-drains the same (deduped) change, never loses one.
  for (const event of events) await putDoc("local", event);
  state.lastSeq = String(changes.last_seq);
  await putDoc("local", state);

  // Retention: tombstone-DELETE expired events (replicates the prune to devices),
  // distinct from M5 `_purge` revocation. New events use `now`, never expired.
  const expired = existing.docs.filter((event) => eventIsExpired(event, now, policy));
  for (const event of expired) await deleteDoc("local", event._id, event._rev ?? "");
  return { recorded: events.length, pruned: expired.length };
}

// Serialize audit ticks for the same reason as agent ticks: audit:state is read
// at the start and written at the end, so overlapping ticks could double-record
// or 409 the checkpoint write.
let auditTickChain: Promise<unknown> = Promise.resolve();
function runAudit(now = timestamp()): Promise<{ recorded: number; pruned: number }> {
  const next = auditTickChain.catch(() => undefined).then(() => runAuditOnce(now));
  auditTickChain = next;
  return next;
}

/** Best-effort delete audit at the API delete path; never blocks the delete. */
async function recordDeleteAudit(doc: BusinessDocument, actor: string, now = timestamp()): Promise<void> {
  try {
    const policy = await loadAuditPolicy();
    if (!shouldAudit(doc, policy)) return;
    const appConfig = await getDoc<AppConfig>("local", "app:config");
    await putDoc("local", buildAuditEvent(appConfig.appId, doc, "deleted", now, actor));
  } catch (error) {
    console.error("delete audit failed", error);
  }
}

async function selectOptionsForForm(form: FormDefinition, scope: PrincipalScope): Promise<SelectOptionsByField> {
  const entries = await Promise.all(
    form.fields
      .filter((field) => field.type === "select" && field.source)
      .map(async (field) => {
        const docs = await getBusinessDocs("local", field.source!.docType, scope);
        return [
          field.name,
          docs.map((doc) => ({
            value: String(field.source!.valueField ? getPath(doc, field.source!.valueField) : doc._id),
            label: String(getPath(doc, field.source!.labelField) ?? doc._id)
          }))
        ] as const;
      })
  );

  return Object.fromEntries(entries);
}

function getPath(source: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, segment) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[segment];
  }, source);
}

app.get(
  "/api/health",
  asyncRoute(async (_request, response) => {
    response.json({ ok: true, appDb: config.appDb });
  })
);

app.get(
  "/api/status",
  asyncRoute(async (request, response) => {
    await requireSession(request);
    const [localReachable, serverReachable, localDbExists, serverDbExists, replications] =
      await Promise.all([
        ping("local"),
        ping("server"),
        dbExists("local"),
        dbExists("server"),
        replicationTasks()
      ]);

    response.json({ localReachable, serverReachable, localDbExists, serverDbExists, replications });
  })
);

app.get(
  "/api/ready",
  asyncRoute(async (_request, response) => {
    const [
      localReachable,
      serverReachable,
      localSetupDbExists,
      serverSetupDbExists,
      localPlatformDbExists,
      serverPlatformDbExists,
      localSetupInstalled,
      serverSetupInstalled,
      localPlatformInstalled,
      serverPlatformInstalled,
      state
    ] = await Promise.all([
      ping("local"),
      ping("server"),
      dbExists("local", config.setupDb),
      dbExists("server", config.setupDb),
      dbExists("local", config.platformDb),
      dbExists("server", config.platformDb),
      docExistsInDb("local", config.setupDb, "app:config"),
      docExistsInDb("server", config.setupDb, "app:config"),
      docExistsInDb("local", config.platformDb, "platform:config"),
      docExistsInDb("server", config.platformDb, "platform:config"),
      platformState(_request)
    ]);
    const ready =
      localReachable &&
      serverReachable &&
      localSetupDbExists &&
      serverSetupDbExists &&
      localPlatformDbExists &&
      serverPlatformDbExists &&
      localSetupInstalled &&
      serverSetupInstalled &&
      localPlatformInstalled &&
      serverPlatformInstalled;
    response.status(ready ? 200 : 503).json({
      ok: ready,
      setupDb: config.setupDb,
      platformDb: config.platformDb,
      localReachable,
      serverReachable,
      localSetupDbExists,
      serverSetupDbExists,
      localPlatformDbExists,
      serverPlatformDbExists,
      localSetupInstalled,
      serverSetupInstalled,
      localPlatformInstalled,
      serverPlatformInstalled,
      setupComplete: state.setupComplete
    });
  })
);

app.post(
  "/api/setup",
  asyncRoute(async (request, response) => {
    await requireSession(request, "manager");
    await Promise.all([seedTarget("local"), seedTarget("server")]);
    response.json({ ok: true });
  })
);

app.post(
  "/api/reset",
  asyncRoute(async (_request, response) => {
    if (process.env.NODE_ENV === "production" && process.env.E2E !== "1") {
      response.status(404).json({ error: "not_found" });
      return;
    }
    await Promise.all([seedTarget("local", true), seedTarget("server", true)]);
    await Promise.all([completeDevPlatformSetup("local"), completeDevPlatformSetup("server")]);
    clearEffectLog();
    response.json({ ok: true });
  })
);

app.get(
  "/api/platform/state",
  asyncRoute(async (request, response) => {
    response.json(await platformState(request));
  })
);

app.post(
  "/api/platform/setup",
  asyncRoute(async (request, response) => {
    const existingPlatform = await platformConfig();
    if (existingPlatform.setupComplete) {
      response.status(409).json({ error: "setup_complete", reason: "Setup is already complete" });
      return;
    }
    const orgName = String(request.body.orgName ?? "").trim();
    const domainName = String(request.body.domainName ?? "").trim();
    const adminUser = normalizeUsername(String(request.body.adminUser ?? ""));
    const adminPassword = String(request.body.adminPassword ?? "");
    const confirmPassword = String(request.body.confirmPassword ?? "");
    const errors: Array<{ field: string; message: string }> = [];
    if (!orgName) errors.push({ field: "orgName", message: "Organization name is required" });
    if (!domainName) errors.push({ field: "domainName", message: "Domain name is required" });
    if (!adminUser) errors.push({ field: "adminUser", message: "Admin username is required" });
    if (adminPassword.length < 8) errors.push({ field: "adminPassword", message: "Admin password must be at least 8 characters" });
    if (adminPassword !== confirmPassword) errors.push({ field: "confirmPassword", message: "Passwords must match" });
    if (errors.length) {
      response.status(422).json({ error: "setup_validation_failed", errors });
      return;
    }

    const now = timestamp();
    const [localPerson] = await Promise.all([
      upsertPerson("local", adminUser, adminUser, adminPassword),
      upsertPerson("server", adminUser, adminUser, adminPassword)
    ]);
    await Promise.all([
      upsertGroup("local", "group:admins", "Admins", [localPerson._id]),
      upsertGroup("server", "group:admins", "Admins", [localPerson._id])
    ]);
    const existing = existingPlatform;
    const next: PlatformConfig = {
      ...existing,
      setupComplete: true,
      orgName,
      domainName,
      adminUser,
      createdAt: existing.createdAt ?? now,
      updatedAt: now
    };
    const localResult = await upsertDocInDb("local", config.platformDb, next);
    await upsertDocInDb("server", config.platformDb, next);
    const session = await createSession(response, localPerson);
    response.json({ ...(await platformState()), session, rev: localResult.rev });
  })
);

app.get(
  "/api/session",
  asyncRoute(async (request, response) => {
    response.json(await sessionStateForRequest(request));
  })
);

app.post(
  "/api/session/login",
  asyncRoute(async (request, response) => {
    const username = normalizeUsername(String(request.body.username ?? ""));
    const password = String(request.body.password ?? "");
    if (!username || !password) {
      response.status(422).json({ error: "login_validation_failed", reason: "Username and password are required" });
      return;
    }
    try {
      const person = await getDocFromNamedDb<PersonDocument>("local", config.setupDb, personIdForUsername(username));
      if (!person.active || !(await verifyPassword(password, person))) {
        response.status(401).json({ error: "invalid_login", reason: "Invalid username or password" });
        return;
      }
      const session = await createSession(response, person);
      response.json(session);
    } catch (error) {
      if (error instanceof CouchError && error.status === 404) {
        response.status(401).json({ error: "invalid_login", reason: "Invalid username or password" });
        return;
      }
      throw error;
    }
  })
);

app.post(
  "/api/session/logout",
  asyncRoute(async (request, response) => {
    await logoutSession(request, response);
    response.json(emptySession());
  })
);

app.post(
  "/api/platform/install-sample/expense",
  asyncRoute(async (request, response) => {
    const scope = await requireSession(request, "manager");
    const state = await platformState(request);
    if (!state.setupComplete) {
      response.status(409).json({ error: "setup_required", reason: "Complete setup before installing sample apps" });
      return;
    }

    const [localInstalled, serverInstalled] = await Promise.all([expenseAppInstalled("local"), expenseAppInstalled("server")]);
    await Promise.all([
      seedExpenseSampleDirectory("local", scope.person as `person:${string}`),
      seedExpenseSampleDirectory("server", scope.person as `person:${string}`)
    ]);
    // M17: seedTarget installs the packaged `sample:expense` JSON template plus sample data.
    if (!localInstalled) await seedTarget("local");
    if (!serverInstalled) await seedTarget("server");

    const installedAt = timestamp();
    const install = expenseInstallRecord(installedAt, scopeUser(scope));
    const existing = await docExistsInDb("local", config.platformDb, install._id);
    const localResult = await upsertDocInDb("local", config.platformDb, install);
    await upsertDocInDb("server", config.platformDb, install);
    response.status(existing ? 200 : 201).json({ ...(await platformState(request)), rev: localResult.rev });
  })
);

app.post(
  "/api/replicate",
  asyncRoute(async (request, response) => {
    const scope = await requireSession(request);
    const replication = await replicateBidirectional(scope);
    const purge = await purgeUnreadableLocalDocs(scope);
    const reconcile = await reconcileStates();
    response.json({ ...replication, purge, reconcile });
  })
);

app.get(
  "/api/definitions",
  asyncRoute(async (request, response) => {
    const scope = await requireSession(request);
    const [appConfig, forms, views, workflows] = await Promise.all([
      getDesignDoc("local", "app:config"),
      findDocs<FormDefinition>("local", { selector: { kind: "form" }, limit: 100 }),
      findDocs<ViewDefinition>("local", { selector: { kind: "view" }, limit: 100 }),
      findDocs<WorkflowDefinition>("local", { selector: { kind: "workflow" }, limit: 100 })
    ]);
    response.json({
      appConfig,
      forms: forms.docs.sort((left, right) => left.title.localeCompare(right.title)),
      views: views.docs.sort((left, right) => left.title.localeCompare(right.title)),
      workflows: workflows.docs.sort((left, right) => left.title.localeCompare(right.title)),
      user: scope.person,
      roles: principalsFor(scope),
      accessLevel: scope.accessLevel,
      form: forms.docs.find((form) => form._id === "form:expense"),
      view: views.docs.find((view) => view._id === "view:my-expenses")
    });
  })
);

app.post(
  "/api/templates/export",
  asyncRoute(async (request, response) => {
    const scope = await requireSession(request, "designer");
    const appConfig = await getDoc<AppConfig>("local", "app:config");
    const version = String(request.body.version || generatedTemplateVersion());
    const source = String(request.body.source || "local");
    const template: TemplateArtifact = {
      kind: "template",
      templateId: `${appConfig.appId}:${version}`,
      appId: appConfig.appId,
      version,
      createdAt: timestamp(),
      createdBy: scopeUser(scope),
      source,
      definitions: await currentDefinitions()
    };
    response.json(template);
  })
);

app.post(
  "/api/templates/diff",
  asyncRoute(async (request, response) => {
    await requireSession(request, "designer");
    const template = request.body.template as TemplateArtifact;
    const errors = validateTemplateDefinitions(template);
    if (errors.length) {
      response.status(422).json({ error: "template_validation_failed", errors });
      return;
    }
    response.json(diffTemplateDefinitions(await currentDefinitions(), template.definitions));
  })
);

app.post(
  "/api/templates/apply",
  asyncRoute(async (request, response) => {
    await requireSession(request, "designer");
    const template = request.body.template as TemplateArtifact;
    const errors = validateTemplateDefinitions(template);
    if (errors.length) {
      response.status(422).json({ error: "template_validation_failed", errors });
      return;
    }
    const before = await currentDefinitions();
    const diff = diffTemplateDefinitions(before, template.definitions);
    const results = await Promise.all(normalizeDefinitions(template.definitions).map(applyDefinition));
    response.json({
      ok: true,
      templateId: template.templateId,
      diff,
      applied: results.map((result) => ({ id: result.id, rev: result.rev }))
    });
  })
);

app.get(
  "/api/documents",
  asyncRoute(async (request, response) => {
    const scope = await requireSession(request);
    const docType = typeof request.query.docType === "string" ? request.query.docType : "expense";
    const docs = await getBusinessDocs("local", docType, scope);
    response.json(docs);
  })
);

app.get(
  "/api/views/:id/documents",
  asyncRoute(async (request, response) => {
    const scope = await requireSession(request);
    const view = await getDoc<ViewDefinition>("local", routeParam(request.params.id));
    const sort = view.sort?.[0];
    const body: Record<string, unknown> = {
      selector: { ...mangoSelector(view.filters, view.docType), ...accessSelector(scope) },
      limit: 200
    };
    if (sort && sort.field === "updatedAt") {
      body.sort = [{ updatedAt: sort.direction }];
      // State-filtered worklists bind the m3 index (docType+state prefix);
      // everything else uses the general kind+docType index. Hints resolve now
      // that createIndex pins ddoc === name.
      const filtersByState = view.filters?.some((filter) => filter.field === "state");
      body.use_index = filtersByState ? "m3-docType-state-updatedAt" : "m2-kind-docType-updatedAt";
    }
    const result = await findDocs<BusinessDocument>("local", body);
    const readable = result.docs.filter((doc) => canReadDocument(doc, scope));
    // M9: free-text search narrows the ACL-scoped set with the shared matcher,
    // so it never widens visibility. Form (local) supplies the searchable fields.
    const query = typeof request.query.q === "string" ? request.query.q : "";
    if (query.trim()) {
      const form = await formForDocType(view.docType);
      response.json(searchDocuments(readable, form, query));
      return;
    }
    response.json(readable);
  })
);

app.get(
  "/api/documents/:id",
  asyncRoute(async (request, response) => {
    response.json(await getReadableDocument(routeParam(request.params.id), await requireSession(request)));
  })
);

app.get(
  "/api/forms/:docType/options",
  asyncRoute(async (request, response) => {
    const scope = await requireSession(request);
    const form = await formForDocType(routeParam(request.params.docType));
    response.json(await selectOptionsForForm(form, scope));
  })
);

app.post(
  "/api/documents",
  asyncRoute(async (request, response) => {
    const scope = await requireSession(request, "author");
    const docType = request.body.docType ?? "expense";
    const form = await formForDocType(docType);
    const optionsByField = await selectOptionsForForm(form, scope);
    const payload = applyComputedFields(form, normalizePayload(form, request.body.payload ?? {}));
    const errors = validatePayload(form, payload, undefined, optionsByField);
    if (errors.length) {
      response.status(422).json({ error: "validation_failed", errors });
      return;
    }
    const readers = readersForNewDocument(scope, docType);
    // M12: stamp the document generically so any scaffolded docType is correct
    // (was hardcoded to expense/vendor); readers come from the access policy.
    const doc = createDocument(docType, payload, scopeUser(scope), readers);
    const result = await putDoc("local", doc);
    response.status(201).json({ ...doc, _rev: result.rev });
  })
);

app.put(
  "/api/documents/:id",
  asyncRoute(async (request, response) => {
    const scope = await requireSession(request);
    const existing = await getReadableDocument(routeParam(request.params.id), scope);
    if (!canEditDocument(existing, scope)) {
      response.status(403).json({ error: "forbidden", reason: "Document is not editable by current user" });
      return;
    }
    const form = await formForDocType(existing.docType);
    const payload = applyComputedFields(form, normalizePayload(form, request.body.payload ?? existing.payload), existing);
    const errors = validatePayload(form, payload, existing, await selectOptionsForForm(form, scope));
    if (errors.length) {
      response.status(422).json({ error: "validation_failed", errors });
      return;
    }
    const updated: BusinessDocument = {
      ...existing,
      updatedAt: timestamp(),
      updatedBy: scopeUser(scope),
      payload
    };
    const result = await putDoc("local", updated);
    response.json({ ...updated, _rev: result.rev });
  })
);

app.delete(
  "/api/documents/:id",
  asyncRoute(async (request, response) => {
    const scope = await requireSession(request);
    const existing = await getReadableDocument(routeParam(request.params.id), scope);
    if (!canEditDocument(existing, scope)) {
      response.status(403).json({ error: "forbidden", reason: "Document is not editable by current user" });
      return;
    }
    // Record the delete before removing the doc — the envelope (readers/actor) is
    // gone afterward, and the CDC drain can't see a deleted body. Best-effort.
    await recordDeleteAudit(existing, scopeUser(scope));
    await deleteDoc("local", existing._id, existing._rev ?? "");
    response.status(204).end();
  })
);

app.post(
  "/api/documents/:id/transition",
  asyncRoute(async (request, response) => {
    const scope = await requireSession(request);
    const existing = await getReadableDocument(routeParam(request.params.id), scope);
    const def = await workflowForDocType(existing.docType);
    if (!def) {
      response.status(404).json({ error: "not_found", reason: `No workflow for ${existing.docType}` });
      return;
    }
    // Same shared engine the client uses to offer the action — authoritative here (A2/A3).
    const result = applyTransition(existing, def, request.body.transition, scopeUser(scope), principalsFor(scope), timestamp());
    if (!result.ok) {
      response.status(422).json({ error: "transition_failed", errors: result.errors });
      return;
    }
    const updated: BusinessDocument = { ...result.document, updatedAt: timestamp(), updatedBy: scopeUser(scope) };
    const put = await putDoc("local", updated);
    // M7: the state change is now committed and authoritative. The transition's
    // effect handler (if any) runs best-effort AFTER the write — server-only,
    // never throwing, never reverting — so a failing effect cannot block or
    // corrupt the lifecycle. Its outcome is surfaced, not enforced.
    const transition = def.transitions.find((candidate) => candidate.id === request.body.transition)!;
    const effect = runEffect(transition.action, {
      document: { ...updated, _rev: put.rev },
      transition,
      user: scopeUser(scope),
      now: timestamp()
    });
    response.json({ ...updated, _rev: put.rev, effects: effect ? [effect] : [] });
  })
);

app.get(
  "/api/plugins/manifest",
  asyncRoute(async (request, response) => {
    await requireSession(request);
    response.json(HANDLER_MANIFEST);
  })
);

app.get(
  "/api/plugins/log",
  asyncRoute(async (request, response) => {
    await requireSession(request, "designer");
    response.json(readEffectLog());
  })
);

app.post(
  "/api/agents/run",
  asyncRoute(async (request, response) => {
    await requireSession(request, "designer");
    const result = await runAgents();
    response.json({ ok: true, ran: result.ran, runs: result.runs });
  })
);

app.get(
  "/api/agents",
  asyncRoute(async (request, response) => {
    await requireSession(request, "designer");
    const result = await findDocs<AgentDefinition>("local", { selector: { kind: "agent" }, limit: 100 });
    response.json(result.docs.sort((left, right) => left._id.localeCompare(right._id)));
  })
);

app.get(
  "/api/agents/runs",
  asyncRoute(async (request, response) => {
    await requireSession(request, "designer");
    const result = await findDocs<AgentRun>("local", { selector: { kind: "agentrun" }, limit: 200 });
    response.json(result.docs.sort((left, right) => right.startedAt.localeCompare(left.startedAt)));
  })
);

app.post(
  "/api/audit/run",
  asyncRoute(async (request, response) => {
    await requireSession(request, "designer");
    const result = await runAudit();
    response.json({ ok: true, ...result });
  })
);

app.get(
  "/api/audit",
  asyncRoute(async (request, response) => {
    const principals = principalsFor(await requireSession(request));
    const docId = typeof request.query.docId === "string" ? request.query.docId : undefined;
    const docType = typeof request.query.docType === "string" ? request.query.docType : undefined;
    const result = await findDocs<AuditEvent>("local", { selector: { kind: "auditevent" }, limit: 500 });
    // ACL: audit visibility mirrors the source document's readers (A5).
    const events = result.docs
      .filter((event) => event.readers.some((reader) => principals.includes(reader)))
      .filter((event) => (docId ? event.docId === docId : true))
      .filter((event) => (docType ? event.docType === docType : true))
      .sort((left, right) => right.at.localeCompare(left.at));
    response.json(events);
  })
);

app.get(
  "/api/conflicts",
  asyncRoute(async (request, response) => {
    const scope = await requireSession(request);
    const result = await allDocs<CouchDocument>("local", {
      include_docs: true,
      conflicts: true
    });
    const docs = result.rows
      .map((row) => row.doc)
      .filter((doc): doc is CouchDocument => Boolean((doc as (CouchDocument & { _conflicts?: string[] }) | undefined)?._conflicts?.length))
      .filter((doc) => doc.kind !== "document" || canReadDocument(doc, scope));
    response.json(docs);
  })
);

app.put(
  "/api/definitions/:id",
  asyncRoute(async (request, response) => {
    await requireSession(request, "designer");
    const id = routeParam(request.params.id);
    if (!id.startsWith("form:") && !id.startsWith("view:") && !id.startsWith("workflow:") && !id.startsWith("agent:")) {
      response.status(400).json({ error: "bad_request", reason: "Only form:*, view:*, workflow:*, and agent:* docs are editable" });
      return;
    }
    const existing = await getDoc<CouchDocument>("local", id);
    const next = { ...request.body, _id: id, _rev: existing._rev } as CouchDocument;
    const errors = validateDesignDefinition(next);
    if (errors.length) {
      response.status(422).json({ error: "definition_validation_failed", errors });
      return;
    }
    const result = await putDoc("local", next);
    response.json({ ...next, _rev: result.rev });
  })
);

// M12: scaffold a brand-new document type — a form + a list view — so a citizen
// can create an app from scratch. The pair is built by the shared scaffold,
// validated by the shared validators, and written local-first (upsert), exactly
// like any other definition.
app.post(
  "/api/document-types",
  asyncRoute(async (request, response) => {
    await requireSession(request, "designer");
    const docType = (typeof request.body.docType === "string" ? request.body.docType : "").trim();
    const title = typeof request.body.title === "string" ? request.body.title : "";

    const slugErrors = validateDocType(docType);
    if (slugErrors.length) {
      response.status(422).json({ error: "document_type_validation_failed", errors: slugErrors });
      return;
    }
    if ((await definitionExists(`form:${docType}`)) || (await definitionExists(`view:${docType}`))) {
      response.status(409).json({ error: "conflict", reason: `Document type "${docType}" already exists` });
      return;
    }

    const appConfig = await getDoc<AppConfig>("local", "app:config");
    const { form, view } = scaffoldDocumentType(appConfig.appId, docType, title);
    const errors = [...validateDesignDefinition(form), ...validateDesignDefinition(view)];
    if (errors.length) {
      response.status(422).json({ error: "definition_validation_failed", errors });
      return;
    }
    await applyDefinition(form);
    await applyDefinition(view);
    response.status(201).json({ form, view });
  })
);

app.get(
  "/api/conflicts/:id",
  asyncRoute(async (request, response) => {
    const details = await conflictDetails(routeParam(request.params.id), await requireSession(request));
    if (!details) {
      response.status(404).json({ error: "not_found", reason: "Document has no local conflicts" });
      return;
    }
    response.json(details);
  })
);

app.post(
  "/api/conflicts/:id/resolve",
  asyncRoute(async (request, response) => {
    const scope = await requireSession(request);
    const details = await conflictDetails(routeParam(request.params.id), scope);
    if (!details) {
      response.status(404).json({ error: "not_found", reason: "Document has no local conflicts" });
      return;
    }

    // The human may elect which revision wins by passing its _rev. For a
    // concurrent transition this is how the intended terminal state is chosen,
    // not just payload (A4): the elected revision's state/history survive. The
    // chosen content is written onto the surviving (winning) lineage and every
    // conflict leaf is deleted, so exactly one revision remains.
    const chosenRev = request.body.chosenRev as string | undefined;
    const chosen = (chosenRev && details.conflicts.find((rev) => rev._rev === chosenRev)) || details.winning;
    if (chosen.kind === "document" && !canEditDocument(chosen, scope)) {
      response.status(403).json({ error: "forbidden", reason: "Document conflict is not editable by current user" });
      return;
    }

    const resolved =
      chosen.kind === "document"
        ? {
            ...chosen,
            _rev: details.winning._rev,
            _conflicts: undefined,
            updatedAt: timestamp(),
            updatedBy: scopeUser(scope),
            payload: request.body.payload ?? chosen.payload
          }
        : {
            ...chosen,
            _rev: details.winning._rev,
            _conflicts: undefined,
            ...(request.body.document ?? {})
          };
    const result = await putDoc("local", resolved);

    await Promise.all(details.conflicts.map((conflict) => deleteDoc("local", conflict._id, conflict._rev ?? "")));

    response.json({ ...resolved, _rev: result.rev });
  })
);

app.post(
  "/api/demo/conflict",
  asyncRoute(async (request, response) => {
    await requireSession(request, "manager");
    await ensureDb("local");
    await ensureDb("server");
    const doc = createExpenseDoc({ amount: 77, description: "Conflict seed", spentAt: "2026-06-12" });
    const localPut = await putDoc("local", doc);
    await replicateBidirectional();

    const localBase = await getDoc<BusinessDocument>("local", doc._id);
    const serverBase = await getDoc<BusinessDocument>("server", doc._id);

    await putDoc("local", {
      ...localBase,
      payload: { ...localBase.payload, description: `Local edit ${ulid()}` },
      updatedAt: timestamp()
    });
    await putDoc("server", {
      ...serverBase,
      payload: { ...serverBase.payload, description: `Server edit ${ulid()}` },
      updatedAt: timestamp()
    });

    await replicateBidirectional();
    response.json({ id: doc._id, baseRev: localPut.rev, details: await conflictDetails(doc._id) });
  })
);

app.post(
  "/api/demo/definition-conflict",
  asyncRoute(async (request, response) => {
    await requireSession(request, "manager");
    await ensureDb("local");
    await ensureDb("server");
    await replicateBidirectional();

    const localForm = await getDoc<FormDefinition>("local", "form:expense");
    const serverForm = await getDoc<FormDefinition>("server", "form:expense");

    await putDoc("local", {
      ...localForm,
      title: `Expense Local ${Date.now()}`
    });
    await putDoc("server", {
      ...serverForm,
      title: `Expense Server ${Date.now()}`
    });

    await replicateBidirectional();
    response.json({ id: "form:expense", details: await conflictDetails("form:expense") });
  })
);

app.post(
  "/api/demo/state-conflict",
  asyncRoute(async (request, response) => {
    await requireSession(request, "manager");
    await ensureDb("local");
    await ensureDb("server");
    const def = await getDoc<WorkflowDefinition>("local", "workflow:expense");
    const user = "person:alice";
    const roles = ["person:alice", "group:finance"];

    // Submit a fresh expense and replicate it to both replicas.
    const base = createExpenseDoc({ amount: 88, description: `State conflict ${ulid()}`, spentAt: "2026-06-13" });
    const submitted = applyTransition(base, def, "submit", user, roles, timestamp());
    if (!submitted.ok) throw new Error(submitted.errors[0]?.message ?? "submit failed");
    await putDoc("local", submitted.document);
    await replicateBidirectional();

    // Diverge: approve on local, reject on server — both from `submitted`.
    const localBase = await getDoc<BusinessDocument>("local", base._id);
    const serverBase = await getDoc<BusinessDocument>("server", base._id);
    const approved = applyTransition(localBase, def, "approve", user, roles, timestamp());
    const rejected = applyTransition(serverBase, def, "reject", user, roles, timestamp());
    if (!approved.ok || !rejected.ok) throw new Error("divergent transitions failed");
    await putDoc("local", { ...approved.document, updatedAt: timestamp() });
    await putDoc("server", { ...rejected.document, updatedAt: timestamp() });

    await replicateBidirectional();
    response.json({ id: base._id, details: await conflictDetails(base._id) });
  })
);

app.post(
  "/api/admin/revoke-reader",
  asyncRoute(async (request, response) => {
    await requireSession(request, "manager");
    const id = String(request.body.id ?? "");
    const readers = Array.isArray(request.body.readers) ? request.body.readers.map(String) : [];
    if (!id || !readers.length) {
      response.status(400).json({ error: "bad_request", reason: "id and readers are required" });
      return;
    }
    const doc = await getDoc<BusinessDocument>("server", id);
    const next: BusinessDocument = {
      ...doc,
      readers: doc.readers.filter((reader) => !readers.includes(reader)),
      updatedAt: timestamp()
    };
    const result = await putDoc("server", next);
    response.json({ ...next, _rev: result.rev });
  })
);

app.get(
  "/api/admin/server-definitions",
  asyncRoute(async (request, response) => {
    await requireSession(request, "manager");
    const [form, view] = await Promise.all([
      getDoc<FormDefinition>("server", "form:expense"),
      getDoc<ViewDefinition>("server", "view:my-expenses")
    ]);
    response.json({ form, view });
  })
);

app.post(
  "/api/admin/server-definition-demo",
  asyncRoute(async (request, response) => {
    await requireSession(request, "manager");
    const [form, view] = await Promise.all([
      getDoc<FormDefinition>("server", "form:expense"),
      getDoc<ViewDefinition>("server", "view:my-expenses")
    ]);

    const nextForm: FormDefinition = {
      ...form,
      fields: form.fields.some((field) => field.name === "merchant")
        ? form.fields
        : [...form.fields, { name: "merchant", type: "text", label: "Merchant" }]
    };
    const nextView: ViewDefinition = {
      ...view,
      columns: view.columns.some((column) => column.field === "payload.merchant")
        ? view.columns
        : [
            { field: "payload.merchant", label: "Merchant" },
            ...view.columns
          ]
    };

    const [formResult, viewResult] = await Promise.all([putDoc("server", nextForm), putDoc("server", nextView)]);
    response.json({ formRev: formResult.rev, viewRev: viewResult.rev });
  })
);

const staticDir = path.resolve(process.cwd(), "dist");
if (fs.existsSync(path.join(staticDir, "index.html"))) {
  app.use(express.static(staticDir));
  app.get(/^(?!\/api(?:\/|$)).*/, (_request, response) => {
    response.sendFile(path.join(staticDir, "index.html"));
  });
  console.log(`Serving built client from ${staticDir}`);
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error);
  const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 500;
  const reason = error instanceof Error ? error.message : "Unexpected error";
  response.status(status || 500).json({ error: "server_error", reason });
});

app.listen(config.apiPort, () => {
  console.log(`M1 API listening on ${config.apiPort}`);
  void autoSetupPackagedApp();
});

// Optional background agent loop. Off by default (and in tests) — agents are
// otherwise driven by explicit POST /api/agents/run, like POST /api/replicate —
// so set AGENTS_INTERVAL_MS only for a real always-on node.
const agentIntervalMs = Number(process.env.AGENTS_INTERVAL_MS ?? 0);
if (agentIntervalMs > 0) {
  setInterval(() => {
    runAgents().catch((error) => console.error("agent tick failed", error));
    // An always-on node audits on the same cadence (M10); both are otherwise
    // driven by their explicit POST endpoints and stay off in tests.
    runAudit().catch((error) => console.error("audit tick failed", error));
  }, agentIntervalMs);
  console.log(`Agent + audit tick loop enabled every ${agentIntervalMs}ms`);
}
