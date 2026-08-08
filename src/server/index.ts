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
  AppAccessEntry,
  AppAccessState,
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
  PublicGroup,
  PublicPerson,
  AppTemplate,
  SessionDocument,
  SessionState,
  SelectOptionsByField,
  DirectoryState,
  SystemApp,
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
  rollupAclProjection,
  type PrincipalScope
} from "../shared/access";
import { validateDesignDefinition } from "../shared/definition-validation";
import {
  diffTemplateDefinitions,
  normalizeDefinitions,
  stripDefinitionRev
} from "../shared/template";
import { applyComputedFields, coerceFieldValue, normalizePayload, validatePayload } from "../shared/validation";
import { mangoSelector } from "../shared/view-query";
import { evaluateFormulaAsync, type DbReader } from "../shared/formula";
import {
  applyTransition,
  availableTransitions,
  currentState,
  normalizeResolvedPrincipals,
  transitionAffordances,
  type ResolvedTransitionContext
} from "../shared/workflow";
import { agentIsDue, agentIsEnabled, agentMatchesChange, agentRunKey } from "../shared/agents";
import { searchDocuments } from "../shared/search";
import { auditAction, eventIsExpired, shouldAudit } from "../shared/audit";
import { databaseForAppId, scaffoldBlankApp, validateAppId } from "../shared/app-scaffold";
import { scaffoldDocumentType, validateDocType } from "../shared/scaffold";
import { scaffoldApprovalWorkflow, validateApproverPrincipal } from "../shared/workflow-scaffold";
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
  listDbs,
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
import { listSampleTemplates, loadSampleTemplate, sampleTemplateForApp } from "./template-registry";
import { validateTemplateDefinitions } from "../shared/template-validation";
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

if (config.trustProxy) app.set("trust proxy", 1);

app.use(config.corsOrigin ? cors({ origin: config.corsOrigin, credentials: true }) : cors());
app.use(express.json());

const asyncRoute =
  (handler: express.RequestHandler): express.RequestHandler =>
  (request, response, next) =>
    Promise.resolve(handler(request, response, next)).catch(next);

const timestamp = () => new Date().toISOString();
const routeParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value ?? "");
const DEV_PASSWORD = "password123";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const APP_ACCESS_LEVELS: Array<Exclude<AccessLevel, "none">> = ["reader", "author", "editor", "designer", "manager"];

type BusinessAppContext = {
  appId: string;
  title: string;
  database: string;
};

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
    const rows = await allDocsFromDb<GroupDocument>(target, config.namesDb);
    return rows.rows
      .map((row) => row.doc)
      .filter((doc): doc is GroupDocument => Boolean(doc && doc.kind === "group" && doc.members.includes(personId)));
  } catch (error) {
    if (error instanceof CouchError && error.status === 404) return [];
    throw error;
  }
}

function publicGroup(group: GroupDocument): PublicGroup {
  return {
    _id: group._id,
    kind: "group",
    name: group.name,
    members: group.members
  };
}

async function listPeople(target: "local" | "server" = "local"): Promise<PersonDocument[]> {
  try {
    const rows = await allDocsFromDb<PersonDocument>(target, config.namesDb);
    return rows.rows
      .map((row) => row.doc)
      .filter((doc): doc is PersonDocument => Boolean(doc && doc.kind === "person"))
      .sort((left, right) => left.username.localeCompare(right.username));
  } catch (error) {
    if (error instanceof CouchError && error.status === 404) return [];
    throw error;
  }
}

async function listGroups(target: "local" | "server" = "local"): Promise<GroupDocument[]> {
  try {
    const rows = await allDocsFromDb<GroupDocument>(target, config.namesDb);
    return rows.rows
      .map((row) => row.doc)
      .filter((doc): doc is GroupDocument => Boolean(doc && doc.kind === "group"))
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    if (error instanceof CouchError && error.status === 404) return [];
    throw error;
  }
}

async function directoryState(): Promise<DirectoryState> {
  const [people, groups, apps] = await Promise.all([listPeople(), listGroups(), installedApps()]);
  return {
    people: people.map(publicPerson),
    groups: groups.map(publicGroup),
    installedApps: apps
  };
}

async function appAccessLevel(principals: string[], db = config.appDb): Promise<AccessLevel> {
  const levels: AccessLevel[] = [];
  if (principals.includes("group:admins")) levels.push("manager");
  try {
    const acl = await getDoc<AclRules>("local", "acl:rules", "", db);
    for (const entry of acl.entries ?? []) {
      if (principals.includes(entry.principal)) levels.push(entry.level);
    }
  } catch (error) {
    if (!(error instanceof CouchError) || error.status !== 404) throw error;
  }
  return bestAccessLevel(levels);
}

function platformAccessLevel(principals: string[]): AccessLevel {
  return principals.includes("group:admins") ? "manager" : "reader";
}

async function sessionStateForPerson(person: PersonDocument): Promise<SessionState> {
  const groups = (await groupsForPerson("local", person._id)).map((group) => group._id);
  const principals = Array.from(new Set([person._id, ...groups]));
  return {
    authenticated: true,
    person: publicPerson(person),
    groups,
    principals,
    accessLevel: platformAccessLevel(principals)
  };
}

async function sessionStateForRequest(request?: Request): Promise<SessionState> {
  if (!request) return emptySession();
  const token = sessionTokenFromRequest(request);
  if (!token) return emptySession();
  try {
    const session = await getDocFromNamedDb<SessionDocument>("local", config.platformDb, `session:${hashSessionToken(token)}`);
    if (session.expiresAt <= timestamp()) return emptySession();
    const person = await getDocFromNamedDb<PersonDocument>("local", config.namesDb, session.personId);
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

async function requireAppSession(request: Request, db: string, required: AccessLevel = "reader"): Promise<PrincipalScope> {
  const session = await sessionStateForRequest(request);
  if (!session.authenticated || !session.person) {
    throw new CouchError(401, { error: "unauthorized", reason: "Login required" });
  }
  const accessLevel = await appAccessLevel(session.principals, db);
  const scope: PrincipalScope = {
    person: session.person._id,
    groups: session.groups,
    principals: session.principals,
    accessLevel
  };
  if (!hasAccessLevel(scope, required)) {
    throw new CouchError(403, { error: "forbidden", reason: `${required} access is required` });
  }
  return scope;
}

function normalizeAccessEntries(entries: unknown): AppAccessEntry[] {
  if (!Array.isArray(entries)) {
    throw new CouchError(422, { error: "access_validation_failed", reason: "entries must be an array" });
  }
  const byPrincipal = new Map<string, Exclude<AccessLevel, "none">>();
  for (const entry of entries as Array<Partial<AppAccessEntry>>) {
    const principal = typeof entry.principal === "string" ? entry.principal.trim() : "";
    const level = entry.level;
    if (!principal || !level) {
      throw new CouchError(422, { error: "access_validation_failed", reason: "Each entry requires principal and level" });
    }
    if (!APP_ACCESS_LEVELS.includes(level as Exclude<AccessLevel, "none">)) {
      throw new CouchError(422, { error: "access_validation_failed", reason: `Invalid access level: ${level}` });
    }
    byPrincipal.set(principal, level as Exclude<AccessLevel, "none">);
  }
  return Array.from(byPrincipal.entries())
    .map(([principal, level]) => ({ principal, level }))
    .sort((left, right) => left.principal.localeCompare(right.principal));
}

async function validateAccessEntries(entries: AppAccessEntry[]): Promise<void> {
  const [people, groups] = await Promise.all([listPeople(), listGroups()]);
  const activePeople = new Set(people.filter((person) => person.active).map((person) => person._id));
  const groupIds = new Set(groups.map((group) => group._id));
  for (const entry of entries) {
    if (entry.principal.startsWith("person:")) {
      if (!activePeople.has(entry.principal as `person:${string}`)) {
        throw new CouchError(422, { error: "access_validation_failed", reason: `Unknown or inactive person: ${entry.principal}` });
      }
    } else if (entry.principal.startsWith("group:")) {
      if (!groupIds.has(entry.principal as `group:${string}`)) {
        throw new CouchError(422, { error: "access_validation_failed", reason: `Unknown group: ${entry.principal}` });
      }
    } else {
      throw new CouchError(422, { error: "access_validation_failed", reason: `Unsupported principal: ${entry.principal}` });
    }
  }
}

async function validateWorkflowApproverPrincipal(principal: string): Promise<void> {
  const principalErrors = validateApproverPrincipal(principal);
  if (principalErrors.length) {
    throw new CouchError(422, { error: "workflow_scaffold_validation_failed", reason: principalErrors.map((item) => item.message).join("; ") });
  }
  const [people, groups] = await Promise.all([listPeople(), listGroups()]);
  const activePeople = new Set(people.filter((person) => person.active).map((person) => person._id));
  const groupIds = new Set(groups.map((group) => group._id));
  if (principal.startsWith("person:") && !activePeople.has(principal as `person:${string}`)) {
    throw new CouchError(422, { error: "workflow_scaffold_validation_failed", reason: `Unknown or inactive person: ${principal}` });
  }
  if (principal.startsWith("group:") && !groupIds.has(principal as `group:${string}`)) {
    throw new CouchError(422, { error: "workflow_scaffold_validation_failed", reason: `Unknown group: ${principal}` });
  }
}

async function assertAppHasActiveManager(entries: AppAccessEntry[]): Promise<void> {
  const [people, groups] = await Promise.all([listPeople(), listGroups()]);
  const activePeople = new Set(people.filter((person) => person.active).map((person) => person._id));
  const groupById = new Map(groups.map((group) => [group._id, group]));
  const managerEntries = entries.filter((entry) => entry.level === "manager");
  const activeManager =
    managerEntries.some((entry) => entry.principal.startsWith("person:") && activePeople.has(entry.principal as `person:${string}`)) ||
    managerEntries.some((entry) => {
      if (!entry.principal.startsWith("group:")) return false;
      return groupById.get(entry.principal as `group:${string}`)?.members.some((member) => activePeople.has(member)) ?? false;
    }) ||
    (groupById.get("group:admins")?.members.some((member) => activePeople.has(member)) ?? false);
  if (!activeManager) {
    throw new CouchError(422, { error: "access_validation_failed", reason: "At least one active app manager is required" });
  }
}

async function appAccessState(appContext: BusinessAppContext): Promise<AppAccessState> {
  const [acl, people, groups] = await Promise.all([
    getDoc<AclRules>("local", "acl:rules", "", appContext.database),
    listPeople(),
    listGroups()
  ]);
  return {
    appId: appContext.appId,
    entries: [...(acl.entries ?? [])].sort((left, right) => left.principal.localeCompare(right.principal)),
    people: people.filter((person) => person.active).map(publicPerson),
    groups: groups.map(publicGroup),
    levels: APP_ACCESS_LEVELS
  };
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
  setSessionCookie(response, token, expiresAt, config.cookieSecure);
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
  clearSessionCookie(response, config.cookieSecure);
}

async function upsertPerson(target: "local" | "server", username: string, displayName: string, password: string): Promise<PersonDocument> {
  const normalized = normalizeUsername(username);
  const now = timestamp();
  const passwordFields = await hashPassword(password);
  const existing = await docExistsInDb(target, config.namesDb, personIdForUsername(normalized));
  const current = existing ? await getDocFromNamedDb<PersonDocument>(target, config.namesDb, personIdForUsername(normalized)) : undefined;
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
  await upsertDocInDb(target, config.namesDb, person);
  return person;
}

async function upsertGroup(target: "local" | "server", id: `group:${string}`, name: string, members: Array<`person:${string}`>) {
  const now = timestamp();
  let createdAt = now;
  try {
    createdAt = (await getDocFromNamedDb<GroupDocument>(target, config.namesDb, id)).createdAt;
  } catch (error) {
    if (!(error instanceof CouchError) || error.status !== 404) throw error;
  }
  await upsertDocInDb<GroupDocument>(target, config.namesDb, {
    _id: id,
    kind: "group",
    name,
    members,
    createdAt,
    updatedAt: now
  });
}

function normalizeGroupSlug(slug: string): string {
  return normalizeUsername(slug);
}

function groupIdForSlug(slug: string): `group:${string}` {
  return `group:${normalizeGroupSlug(slug)}`;
}

async function deleteSessionsForPerson(personId: `person:${string}`): Promise<void> {
  await Promise.all(
    (["local", "server"] as const).map(async (target) => {
      try {
        const rows = await allDocsFromDb<SessionDocument>(target, config.platformDb);
        await Promise.all(
          rows.rows
            .map((row) => row.doc)
            .filter((doc): doc is SessionDocument => Boolean(doc && doc.kind === "session" && doc.personId === personId && doc._rev))
            .map((doc) => deleteDocInDb(target, config.platformDb, doc._id, doc._rev!))
        );
      } catch (error) {
        if (!(error instanceof CouchError) || error.status !== 404) throw error;
      }
    })
  );
}

async function assertPeopleExist(personIds: Array<`person:${string}`>): Promise<void> {
  const people = await listPeople();
  const existing = new Set(people.map((person) => person._id));
  const missing = personIds.filter((personId) => !existing.has(personId));
  if (missing.length) {
    throw new CouchError(422, { error: "directory_validation_failed", reason: `Unknown people: ${missing.join(", ")}` });
  }
}

async function assertActiveAdminExists(nextGroups?: GroupDocument[], nextPeople?: PersonDocument[]): Promise<void> {
  const [currentPeople, currentGroups] = await Promise.all([listPeople(), listGroups()]);
  const people = nextPeople ?? currentPeople;
  const groups = nextGroups ?? currentGroups;
  const admins = groups.find((group) => group._id === "group:admins");
  const activePeople = new Set(people.filter((person) => person.active).map((person) => person._id));
  const activeAdminCount = admins?.members.filter((member) => activePeople.has(member)).length ?? 0;
  if (activeAdminCount < 1) {
    throw new CouchError(422, { error: "directory_validation_failed", reason: "At least one active admin is required" });
  }
}

async function writePersonBothTargets(person: PersonDocument): Promise<void> {
  await Promise.all([
    upsertDocInDb("local", config.namesDb, person),
    upsertDocInDb("server", config.namesDb, person)
  ]);
}

async function writeGroupBothTargets(group: GroupDocument): Promise<void> {
  await Promise.all([
    upsertDocInDb("local", config.namesDb, group),
    upsertDocInDb("server", config.namesDb, group)
  ]);
}

async function seedDevDirectory(target: "local" | "server", adminUser = "alice", adminPassword = DEV_PASSWORD) {
  await seedNamesTarget(target);
  const alice = await upsertPerson(target, "alice", "Alice Finance", adminUser === "alice" ? adminPassword : DEV_PASSWORD);
  const bob = await upsertPerson(target, "bob", "Bob Sales", DEV_PASSWORD);
  if (adminUser !== "alice") await upsertPerson(target, adminUser, adminUser, adminPassword);
  await upsertGroup(target, "group:admins", "Admins", [personIdForUsername(adminUser)]);
  await upsertGroup(target, "group:finance", "Finance", [alice._id]);
  await upsertGroup(target, "group:sales", "Sales", [bob._id]);
}

async function ensureIndexes(target: "local" | "server", db = config.appDb) {
  await createIndex(target, "m2-kind-docType-updatedAt", ["kind", "docType", "updatedAt"], db);
  await createIndex(target, "m2-readers", ["readers"], db);
  await createIndex(target, "m3-docType-state-updatedAt", ["docType", "state", "updatedAt"], db);
}

async function seedNamesTarget(target: "local" | "server") {
  await ensureNamedDb(target, config.namesDb);
  if (!(await docExistsInDb(target, config.namesDb, "app:config"))) {
    await putDocInDb<AppConfig>(target, config.namesDb, {
      _id: "app:config",
      kind: "app",
      appId: "names",
      title: "Directory",
      database: config.namesDb
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

async function installedApp(appId: string): Promise<AppInstall | undefined> {
  return (await installedApps()).find((app) => app.appId === appId);
}

async function resolveBusinessApp(appId: string): Promise<BusinessAppContext> {
  // Every business app — including the expense sample — resolves via its install
  // record; nothing is assumed in base (ADR-0015).
  const install = await installedApp(appId);
  if (!install) {
    throw new CouchError(404, { error: "app_not_found", reason: `Unknown app: ${appId}` });
  }
  return { appId: install.appId, title: install.title, database: install.database };
}

async function appContextFromRequest(request: Request): Promise<BusinessAppContext> {
  // ADR-0015: the runtime is app-scoped only — no default app. An unscoped
  // request (no :appId) is rejected rather than silently resolving to expense.
  const appId = routeParam(request.params.appId);
  if (!appId) {
    throw new CouchError(400, { error: "app_required", reason: "An app id is required (use /api/apps/:appId/…)" });
  }
  return resolveBusinessApp(appId);
}

function systemApps(): SystemApp[] {
  return [
    {
      appId: "names",
      title: "Directory",
      database: config.namesDb,
      route: "/names.nsf",
      description: "People, groups, and directory administration."
    }
  ];
}

async function platformState(request?: Request): Promise<PlatformState> {
  const [platform, apps, session] = await Promise.all([
    platformConfig(),
    installedApps(),
    sessionStateForRequest(request)
  ]);
  const availableTemplates: AppTemplate[] = listSampleTemplates().map((sample) => ({
    id: sample.appId,
    title: sample.title,
    description: sample.description
  }));
  return {
    setupComplete: platform.setupComplete,
    orgName: platform.orgName,
    domainName: platform.domainName,
    adminUser: platform.adminUser,
    session,
    systemApps: systemApps(),
    installedApps: apps,
    availableTemplates
  };
}

function appInstallRecord(
  appId: string,
  title: string,
  database: string,
  installedAt = timestamp(),
  installedBy = "person:alice",
  templateId = "blank:app",
  description?: string
): AppInstall {
  return {
    _id: `appinstall:${appId}`,
    kind: "appinstall",
    appId,
    title,
    database,
    templateId,
    installedAt,
    installedBy,
    // ADR-0023: cheap purpose blurb mirrored from app:config at install time so
    // lotus_admin_list_apps can show what each app is for without reading every
    // app database. Authoritative copy stays on app:config; only set when present.
    ...(description ? { description } : {})
  };
}

/**
 * Instantiate a bundled template as an app under the CHOSEN appId (Level 2). A
 * template is a portable design: its docs are re-stamped with the target appId,
 * and `app:config` gets the target database/title. The template's own appId is
 * just an authored default — one template can deploy as many apps.
 */
function instantiateTemplate(
  templateId: string,
  appId: string,
  title: string
): { definitions: DesignDocument[]; documents: BusinessDocument[] } {
  const { template, sampleData } = loadSampleTemplate(templateId);
  const database = databaseForAppId(appId);
  const definitions = template.definitions.map((doc) =>
    doc._id === "app:config"
      ? ({ ...doc, appId, title: title.trim() || (doc as AppConfig).title, database } as DesignDocument)
      : ({ ...doc, appId } as DesignDocument)
  );
  const documents = sampleData.map((doc) => ({ ...doc, appId }) as BusinessDocument);
  return { definitions, documents };
}

async function completeDevPlatformSetup(target: "local" | "server") {
  const now = timestamp();
  await seedNamesTarget(target);
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
  // Dev/e2e convenience: the expense sample DB is seeded by seedTarget; record it
  // as installed so it resolves like any catalog app (ADR-0015). No expense-specific
  // helper — the generic install record + template registry drive it.
  await upsertDocInDb(
    target,
    config.platformDb,
    appInstallRecord("expense", "Expense sample", databaseForAppId("expense"), now, "person:alice", "sample:expense")
  );
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
    await Promise.all([seedNamesTarget("local"), seedNamesTarget("server"), seedPlatformTarget("local"), seedPlatformTarget("server")]);
    console.log(`Installed names.nsf (${config.namesDb}) and platform catalog (${config.platformDb})`);
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

async function conflictDetails(id: string, scope?: PrincipalScope, db = config.appDb): Promise<ConflictDetails | null> {
  const winning = await getDoc<CouchDocument & { _conflicts?: string[] }>("local", id, "?conflicts=true", db);
  if (scope && winning.kind === "document" && !canReadDocument(winning, scope)) {
    throw new CouchError(403, { error: "forbidden", reason: "Document is not readable by current user" });
  }
  if (!winning._conflicts?.length) return null;

  const conflicts = await Promise.all(
    winning._conflicts.map((rev: string) =>
        getDoc<CouchDocument>("local", id, `?rev=${encodeURIComponent(rev)}`, db)
    )
  );

  return { document: winning, winning, conflicts };
}

async function formForDocType(docType: string, db = config.appDb) {
  return getDoc<FormDefinition>("local", `form:${docType}`, "", db);
}

async function workflowForDocType(docType: string, db = config.appDb): Promise<WorkflowDefinition | null> {
  try {
    return await getDoc<WorkflowDefinition>("local", `workflow:${docType}`, "", db);
  } catch (error) {
    if (error instanceof CouchError && error.status === 404) return null;
    throw error;
  }
}

async function loadAuditPolicy(db = config.appDb): Promise<AuditPolicy | undefined> {
  try {
    return await getDoc<AuditPolicy>("local", "audit:policy", "", db);
  } catch (error) {
    if (error instanceof CouchError && error.status === 404) return undefined;
    throw error;
  }
}

async function currentDefinitions(db = config.appDb): Promise<DesignDocument[]> {
  const [appConfig, acl, auditPolicy, forms, views, workflows, agents] = await Promise.all([
    getDoc<AppConfig>("local", "app:config", "", db),
    getDoc<AclRules>("local", "acl:rules", "", db),
    loadAuditPolicy(db),
    findDocs<FormDefinition>("local", { selector: { kind: "form" }, limit: 100 }, db),
    findDocs<ViewDefinition>("local", { selector: { kind: "view" }, limit: 100 }, db),
    findDocs<WorkflowDefinition>("local", { selector: { kind: "workflow" }, limit: 100 }, db),
    findDocs<AgentDefinition>("local", { selector: { kind: "agent" }, limit: 100 }, db)
  ]);

  const designDocs: DesignDocument[] = [appConfig, acl];
  if (auditPolicy) designDocs.push(auditPolicy);
  return normalizeDefinitions([...designDocs, ...forms.docs, ...views.docs, ...workflows.docs, ...agents.docs]);
}

function generatedTemplateVersion() {
  return `v${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
}

async function applyDefinition(definition: DesignDocument, db = config.appDb) {
  let currentRev: string | undefined;
  try {
    currentRev = (await getDoc<DesignDocument>("local", definition._id, "", db))._rev;
  } catch (error) {
    if (!(error instanceof CouchError) || error.status !== 404) throw error;
  }

  const next = { ...stripDefinitionRev(definition), _rev: currentRev } as DesignDocument;
  return putDoc("local", next, db);
}

/** Whether a design document with this id already exists locally. */
async function definitionExists(id: string, db = config.appDb): Promise<boolean> {
  try {
    await getDoc("local", id, "", db);
    return true;
  } catch (error) {
    if (error instanceof CouchError && error.status === 404) return false;
    throw error;
  }
}

async function getReadableDocument(id: string, scope: PrincipalScope, db = config.appDb): Promise<BusinessDocument> {
  const doc = await getDoc<BusinessDocument>("local", id, "", db);
  if (!canReadDocument(doc, scope)) {
    throw new CouchError(403, { error: "forbidden", reason: "Document is not readable by current user" });
  }
  return doc;
}

async function purgeUnreadableLocalDocs(scope: PrincipalScope, db = config.appDb) {
  const [localResult, serverVisible] = await Promise.all([
    allDocs<BusinessDocument & { _conflicts?: string[] }>("local", {
      include_docs: true,
      conflicts: true
    }, db),
    findDocs<BusinessDocument>("server", {
      selector: {
        kind: "document",
        ...accessSelector(scope)
      },
      limit: 1000
    }, db)
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
  await purgeDocs("local", revisions, db);
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
async function reconcileStates(db = config.appDb): Promise<{
  stateConflicts: Array<{ id: string; states: string[] }>;
  invalidStates: Array<{ id: string; state: string }>;
}> {
  const result = await allDocs<CouchDocument & { _conflicts?: string[] }>("local", {
    include_docs: true,
    conflicts: true
  }, db);

  const stateConflicts: Array<{ id: string; states: string[] }> = [];
  const invalidStates: Array<{ id: string; state: string }> = [];
  const workflowCache = new Map<string, WorkflowDefinition | null>();

  for (const row of result.rows) {
    const doc = row.doc;
    if (!doc || doc.kind !== "document") continue;

    if (!workflowCache.has(doc.docType)) {
      workflowCache.set(doc.docType, await workflowForDocType(doc.docType, db));
    }
    const def = workflowCache.get(doc.docType);
    if (!def) continue;

    if (doc._conflicts?.length) {
      const revs = await Promise.all(
        doc._conflicts.map((rev) =>
          getDoc<BusinessDocument>("local", doc._id, `?rev=${encodeURIComponent(rev)}`, db)
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
async function loadAgentState(appId: string, db = config.appDb): Promise<AgentState> {
  try {
    return await getDoc<AgentState>("local", "agent:state", "", db);
  } catch {
    return { _id: "agent:state", kind: "agentstate", appId, lastSeq: "0", lastRunAt: {} };
  }
}

async function existingRunKeys(db = config.appDb): Promise<Set<string>> {
  // {kind:"agentrun"} binds the m2 index (kind is its leading field) — no new index.
  const result = await findDocs<AgentRun>("local", { selector: { kind: "agentrun" }, limit: 2000 }, db);
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

async function runAgentsOnce(now = timestamp(), db = config.appDb): Promise<{ ran: number; runs: AgentRun[] }> {
  const agents = (await findDocs<AgentDefinition>("local", { selector: { kind: "agent" }, limit: 100 }, db)).docs.filter(
    agentIsEnabled
  );
  if (!agents.length) return { ran: 0, runs: [] };

  const appConfig = await getDoc<AppConfig>("local", "app:config", "", db);
  const state = await loadAgentState(appConfig.appId, db);
  const seenKeys = await existingRunKeys(db);
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
    const changes = await changesSince("local", state.lastSeq, db);
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
  for (const run of runs) await putDoc("local", run, db);
  await putDoc("local", state, db);
  return { ran: runs.length, runs };
}

// Serialize ticks: agent:state is read at tick start and written at tick end, so
// two overlapping ticks (a manual POST overlapping the optional interval loop, or
// two manual POSTs) could double-run or 409 on the checkpoint write. Chaining
// every tick onto the previous one makes the runtime single-writer in-process.
let agentTickChain: Promise<unknown> = Promise.resolve();
function runAgents(now = timestamp(), db = config.appDb): Promise<{ ran: number; runs: AgentRun[] }> {
  const next = agentTickChain.catch(() => undefined).then(() => runAgentsOnce(now, db));
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

async function loadAuditState(appId: string, db = config.appDb): Promise<AuditState> {
  try {
    return await getDoc<AuditState>("local", "audit:state", "", db);
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

async function runAuditOnce(now = timestamp(), db = config.appDb): Promise<{ recorded: number; pruned: number }> {
  const appConfig = await getDoc<AppConfig>("local", "app:config", "", db);
  const policy = await loadAuditPolicy(db);
  const state = await loadAuditState(appConfig.appId, db);

  // One read serves both dedupe (docId@rev) and retention. {kind:"auditevent"}
  // binds the kind-leading m2 index — no new index.
  const existing = await findDocs<AuditEvent>("local", { selector: { kind: "auditevent" }, limit: 2000 }, db);
  const seen = new Set(existing.docs.map((event) => `${event.docId}@${event.rev}`));

  const changes = await changesSince("local", state.lastSeq, db);
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
  for (const event of events) await putDoc("local", event, db);
  state.lastSeq = String(changes.last_seq);
  await putDoc("local", state, db);

  // Retention: tombstone-DELETE expired events (replicates the prune to devices),
  // distinct from M5 `_purge` revocation. New events use `now`, never expired.
  const expired = existing.docs.filter((event) => eventIsExpired(event, now, policy));
  for (const event of expired) await deleteDoc("local", event._id, event._rev ?? "", db);
  return { recorded: events.length, pruned: expired.length };
}

// Serialize audit ticks for the same reason as agent ticks: audit:state is read
// at the start and written at the end, so overlapping ticks could double-record
// or 409 the checkpoint write.
let auditTickChain: Promise<unknown> = Promise.resolve();
function runAudit(now = timestamp(), db = config.appDb): Promise<{ recorded: number; pruned: number }> {
  const next = auditTickChain.catch(() => undefined).then(() => runAuditOnce(now, db));
  auditTickChain = next;
  return next;
}

/** Best-effort delete audit at the API delete path; never blocks the delete. */
async function recordDeleteAudit(doc: BusinessDocument, actor: string, now = timestamp(), db = config.appDb): Promise<void> {
  try {
    const policy = await loadAuditPolicy(db);
    if (!shouldAudit(doc, policy)) return;
    const appConfig = await getDoc<AppConfig>("local", "app:config", "", db);
    await putDoc("local", buildAuditEvent(appConfig.appId, doc, "deleted", now, actor), db);
  } catch (error) {
    console.error("delete audit failed", error);
  }
}

async function selectOptionsForForm(form: FormDefinition, scope: PrincipalScope, db = config.appDb): Promise<SelectOptionsByField> {
  const entries = await Promise.all(
    form.fields
      .filter((field) => field.type === "select" && field.source)
      .map(async (field) => {
        const docs = await getBusinessDocs("local", field.source!.docType, scope, db);
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

/**
 * ADR-0014: a `DbReader` for the async formula lane. Reads the LOCAL replica only
 * (offline-first, no server round-trip), returning ALL rows of a docType — the
 * formula lane applies the single ACL filter (`canReadDocument`) against the
 * caller's scope. A per-call memo bounds N+1 when several formulas hit the same
 * source. Unknown/uninstalled target apps read as empty.
 */
function makeDbReader(): DbReader {
  const memo = new Map<string, Promise<BusinessDocument[]>>();
  return (appId, docType) => {
    const key = `${appId}:${docType}`;
    let pending = memo.get(key);
    if (!pending) {
      pending = (async () => {
        try {
          const app = await resolveBusinessApp(appId);
          return await getBusinessDocs("local", docType, undefined, app.database);
        } catch {
          return [];
        }
      })();
      memo.set(key, pending);
    }
    return pending;
  };
}

/** Resolve a document's `computed-for-display` fields, ACL-scoped to `scope`. */
async function resolveFormulaFields(
  form: FormDefinition,
  doc: BusinessDocument,
  scope: PrincipalScope
): Promise<Record<string, unknown>> {
  const fields = form.fields.filter((field) => field.mode === "computed-for-display" && field.formula);
  if (!fields.length) return {};
  const read = makeDbReader();
  // allSettled + fail-closed eval: one bad formula can never reject the batch and
  // drop its siblings' values (defence in depth — evaluateFormulaAsync never throws).
  const results = await Promise.allSettled(
    fields.map((field) =>
      evaluateFormulaAsync(field.formula, {
        payload: doc.payload,
        doc: doc as unknown as Record<string, unknown>,
        user: scope.person,
        scope,
        read
      })
    )
  );
  const entries = fields.map(
    (field, index) => [field.name, results[index].status === "fulfilled" ? results[index].value : undefined] as const
  );
  return Object.fromEntries(entries);
}

/**
 * ADR-0019: stamp computed-mode field values — the server is their single
 * writer. `computed` re-resolves on every payload write with PRESERVE-ON-EMPTY
 * (a degraded resolution keeps the prior stamp — never clears, never widens to
 * a fallback); `computed-once` resolves iff absent (create, or backfill for
 * docs predating the field) and never overwrites a present value;
 * `computed-for-display` is stripped (never stored). Client-supplied values
 * for all three are thereby discarded on every write path (tamper rule).
 * Resolution runs in the async lane under the WRITER's ACL scope against the
 * local replica, with `doc` bound to the built/merged envelope so
 * `doc.createdBy` is the creator, never the acting editor (review M2); results
 * are coerced to the field's datatype and non-primitive results are treated as
 * empty (review m7). Fail-closed: never throws into the route.
 */
async function stampComputedFields(
  form: FormDefinition,
  doc: BusinessDocument,
  previousPayload: Record<string, unknown> | undefined,
  scope: PrincipalScope
): Promise<BusinessDocument> {
  const stampFields = form.fields.filter((field) => field.mode === "computed" || field.mode === "computed-once");
  const displayFields = form.fields.filter((field) => field.mode === "computed-for-display");
  if (!stampFields.length && !displayFields.length) return doc;

  const payload = { ...doc.payload };
  for (const field of displayFields) delete payload[field.name];

  const read = makeDbReader();
  for (const field of stampFields) {
    const previous = previousPayload?.[field.name];
    const hasPrevious = previous !== undefined && previous !== null && previous !== "";
    if (field.mode === "computed-once" && hasPrevious) {
      payload[field.name] = previous;
      continue;
    }
    const raw = await evaluateFormulaAsync(field.formula, {
      payload,
      doc: { ...doc, payload } as unknown as Record<string, unknown>,
      user: scope.person,
      scope,
      read
    });
    if (field.aclRole === "reader" || field.aclRole === "author") {
      // ADR-0024 §1/§3: an ACL-flagged field resolves to a principal LIST, not a
      // scalar — normalized principal-shaped (same posture as `responsibleFormula`)
      // so a malformed formula can never stamp a non-principal into the projection.
      // Stored as the field's value; it feeds the readers/authors rollup below.
      // Never primitive-coerced (that path drops arrays). PRESERVE-ON-EMPTY: a
      // degraded resolution keeps the prior stamp rather than dropping ACL (fails
      // closed — narrows, never widens).
      const resolved = normalizeResolvedPrincipals(raw);
      payload[field.name] = resolved.length ? resolved : hasPrevious ? previous : resolved;
      continue;
    }
    const primitive =
      typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" ? raw : undefined;
    if (primitive === undefined || primitive === "") {
      if (hasPrevious) payload[field.name] = previous;
      else delete payload[field.name];
      continue;
    }
    payload[field.name] = coerceFieldValue(field, primitive);
  }

  // ADR-0024 §2: materialize the envelope readers/authors as the $Readers-style
  // projection — the creator BASE already on `doc` (its principals, captured at
  // create; on later writes `doc.readers/authors` already carry it) UNIONED with
  // every aclRole field's resolved principals. Additive by design: the creator
  // base survives a write by a different editor, and a re-rolled `computed`
  // author field appends (ADR-0024 Consequences: additive-only in practice). The
  // projection lands on the same top-level `readers` field, so the m2-readers
  // index (invariant 120) and the coarse-gate model (invariant 93) are untouched.
  const { readers, authors } = rollupAclProjection({ readers: doc.readers, authors: doc.authors }, form.fields, payload);
  return { ...doc, payload, readers, authors };
}

app.get(
  "/api/health",
  asyncRoute(async (_request, response) => {
    response.json({ ok: true, appDb: config.appDb });
  })
);

app.get(
  "/api/apps/:appId/status",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    await requireAppSession(request, appContext.database);
    const [localReachable, serverReachable, localDbExists, serverDbExists, replications] =
      await Promise.all([
        ping("local"),
        ping("server"),
        dbExists("local", appContext.database),
        dbExists("server", appContext.database),
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
      dbExists("local", config.namesDb),
      dbExists("server", config.namesDb),
      dbExists("local", config.platformDb),
      dbExists("server", config.platformDb),
      docExistsInDb("local", config.namesDb, "app:config"),
      docExistsInDb("server", config.namesDb, "app:config"),
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
      namesDb: config.namesDb,
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

// ADR-0022: cross-app work queue. Answers "does the AUTHENTICATED caller have
// actionable work anywhere?" so a controller can spawn an agent on demand instead
// of each agent polling per-app inbox views (the operator's ADR-0021 poll loop is
// the motivating consumer). Caller-scoped by construction: identity is the session
// (never a caller-supplied `?principal=`), so this stays inside the Identity and
// ACL invariants — to ask about a persona's queue the caller authenticates AS that
// persona (the M27/M28 persona-bearer mechanism), exactly as `@me` resolves to the
// session in ADR-0020.
//
// The cheap gate is a single selector per app db: `responsible ∈ principals`
// (ADR-0025: element membership against the array field). It needs no workflow
// definition and no explicit final-state filter — `applyTransition` CLEARS
// `responsible` on entry to a final state, so a completed/failed document carries
// no standing responsibility and never matches. `?actionable=true` tightens this
// to "has a transition the caller may take right now" by loading the workflow def
// per docType; `?items=true` returns the document refs for the spawn payload.
app.get(
  "/api/work-queue",
  asyncRoute(async (request, response) => {
    // Platform-level session (spans apps); per-app authority is checked below.
    const scope = await requireSession(request);
    const principals = principalsFor(scope);
    const wantItems = request.query.items === "true";
    const wantActionable = request.query.actionable === "true";

    const apps = await installedApps();
    const byApp = await Promise.all(
      apps.map(async (app) => {
        // Skip apps the caller cannot even read — never a 403 (this is an
        // aggregate, not a per-app request) and never a leak of their contents.
        const level = await appAccessLevel(scope.principals, app.database);
        if (accessRank(level) < accessRank("reader")) return null;
        const appScope: PrincipalScope = { ...scope, accessLevel: level };

        // Bind the existing ACL index (`m2-readers`): the `readers ∈ principals`
        // predicate is the selective one, and `responsible`/`kind` are in-memory
        // predicates on the scanned rows — the ADR-0020 cost class, literally the
        // same index the ACL filter already relies on (no new index; three-site
        // rule untouched). `responsible` is an array field, so `$in` matches on
        // element membership (ADR-0025 §1), exactly like the `readers` predicate.
        const result = await findDocs<BusinessDocument>(
          "local",
          {
            selector: { kind: "document", responsible: { $in: principals }, ...accessSelector(appScope) },
            use_index: "m2-readers",
            limit: 200
          },
          app.database
        );
        // ACL post-filter mirrors every list route: the Mango `readers` predicate
        // is a coarse gate; `canReadDocument` is the authority.
        let readable = result.docs.filter((doc) => canReadDocument(doc, appScope));

        if (wantActionable) {
          const defs = new Map<string, WorkflowDefinition | null>();
          const actionable: BusinessDocument[] = [];
          for (const doc of readable) {
            if (!defs.has(doc.docType)) defs.set(doc.docType, await workflowForDocType(doc.docType, app.database));
            const def = defs.get(doc.docType);
            // No workflow for the type ⇒ the responsible stamp is inert; treat it as
            // non-actionable rather than guessing a transition exists.
            if (def && availableTransitions(doc, def, scope.person, principals).length > 0) actionable.push(doc);
          }
          readable = actionable;
        }

        return {
          appId: app.appId,
          database: app.database,
          count: readable.length,
          ...(wantItems
            ? {
                items: readable.map((doc) => ({
                  _id: doc._id,
                  docType: doc.docType,
                  state: doc.state ?? null,
                  responsibleAt: doc.responsibleAt ?? null
                }))
              }
            : {})
        };
      })
    );

    const visible = byApp.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    response.json({
      total: visible.reduce((sum, entry) => sum + entry.count, 0),
      byApp: visible
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
    // Reset must return a clean slate: also drop every business-app database
    // (catalog- or template-created, `<appId>_app`), or their leftovers make the
    // next create-app 409 even though the install records were wiped with
    // platform_app. The control databases are recreated below; the default
    // expense database is force-recreated by seedTarget.
    const isBusinessAppDb = (db: string) =>
      db.endsWith("_app") && db !== config.namesDb && db !== config.platformDb;
    const [localDbs, serverDbs] = await Promise.all([listDbs("local"), listDbs("server")]);
    await Promise.all([
      ...localDbs.filter(isBusinessAppDb).map((db) => deleteDb("local", db)),
      ...serverDbs.filter(isBusinessAppDb).map((db) => deleteDb("server", db)),
      deleteDb("local", config.namesDb),
      deleteDb("server", config.namesDb),
      deleteDb("local", config.platformDb),
      deleteDb("server", config.platformDb)
    ]);
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
      const person = await getDocFromNamedDb<PersonDocument>("local", config.namesDb, personIdForUsername(username));
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

app.get(
  "/api/names/directory",
  asyncRoute(async (request, response) => {
    await requireSession(request);
    response.json(await directoryState());
  })
);

app.post(
  "/api/names/people",
  asyncRoute(async (request, response) => {
    await requireSession(request, "manager");
    const username = normalizeUsername(String(request.body.username ?? ""));
    const displayName = String(request.body.displayName ?? "").trim();
    const password = String(request.body.password ?? "");
    const errors: Array<{ field: string; message: string }> = [];
    if (!username) errors.push({ field: "username", message: "Username is required" });
    if (!displayName) errors.push({ field: "displayName", message: "Display name is required" });
    if (password.length < 8) errors.push({ field: "password", message: "Password must be at least 8 characters" });
    if (username && (await docExistsInDb("local", config.namesDb, personIdForUsername(username)))) {
      errors.push({ field: "username", message: "Username already exists" });
    }
    if (errors.length) {
      response.status(422).json({ error: "directory_validation_failed", errors });
      return;
    }

    const [localPerson] = await Promise.all([
      upsertPerson("local", username, displayName, password),
      upsertPerson("server", username, displayName, password)
    ]);
    response.status(201).json({ person: publicPerson(localPerson), directory: await directoryState() });
  })
);

app.put(
  "/api/names/people/:username",
  asyncRoute(async (request, response) => {
    await requireSession(request, "manager");
    const username = normalizeUsername(routeParam(request.params.username));
    const existing = await getDocFromNamedDb<PersonDocument>("local", config.namesDb, personIdForUsername(username));
    const displayName = String(request.body.displayName ?? existing.displayName).trim();
    const active = typeof request.body.active === "boolean" ? request.body.active : existing.active;
    if (!displayName) {
      response.status(422).json({ error: "directory_validation_failed", errors: [{ field: "displayName", message: "Display name is required" }] });
      return;
    }

    const next: PersonDocument = { ...existing, displayName, active, updatedAt: timestamp() };
    const people = (await listPeople()).map((person) => (person._id === next._id ? next : person));
    await assertActiveAdminExists(undefined, people);
    await writePersonBothTargets(next);
    if (!next.active) await deleteSessionsForPerson(next._id);
    response.json({ person: publicPerson(next), directory: await directoryState() });
  })
);

app.post(
  "/api/names/people/:username/password",
  asyncRoute(async (request, response) => {
    await requireSession(request, "manager");
    const username = normalizeUsername(routeParam(request.params.username));
    const password = String(request.body.password ?? "");
    if (password.length < 8) {
      response.status(422).json({ error: "directory_validation_failed", errors: [{ field: "password", message: "Password must be at least 8 characters" }] });
      return;
    }
    const existing = await getDocFromNamedDb<PersonDocument>("local", config.namesDb, personIdForUsername(username));
    const passwordFields = await hashPassword(password);
    const next: PersonDocument = { ...existing, ...passwordFields, updatedAt: timestamp() };
    await writePersonBothTargets(next);
    response.json({ person: publicPerson(next), directory: await directoryState() });
  })
);

app.post(
  "/api/names/groups",
  asyncRoute(async (request, response) => {
    await requireSession(request, "manager");
    const slug = normalizeGroupSlug(String(request.body.slug ?? ""));
    const name = String(request.body.name ?? "").trim();
    const members = Array.isArray(request.body.members)
      ? Array.from(new Set(request.body.members.map((member: unknown) => String(member)).filter((member: string) => member.startsWith("person:")))) as Array<`person:${string}`>
      : [];
    const errors: Array<{ field: string; message: string }> = [];
    if (!slug) errors.push({ field: "slug", message: "Group slug is required" });
    if (!name) errors.push({ field: "name", message: "Group name is required" });
    const id = groupIdForSlug(slug);
    if (slug && (await docExistsInDb("local", config.namesDb, id))) {
      errors.push({ field: "slug", message: "Group already exists" });
    }
    if (errors.length) {
      response.status(422).json({ error: "directory_validation_failed", errors });
      return;
    }
    await assertPeopleExist(members);
    const now = timestamp();
    const group: GroupDocument = { _id: id, kind: "group", name, members, createdAt: now, updatedAt: now };
    const groups = [...(await listGroups()), group];
    await assertActiveAdminExists(groups);
    await writeGroupBothTargets(group);
    response.status(201).json({ group: publicGroup(group), directory: await directoryState() });
  })
);

app.put(
  "/api/names/groups/:slug",
  asyncRoute(async (request, response) => {
    await requireSession(request, "manager");
    const slug = normalizeGroupSlug(routeParam(request.params.slug));
    const existing = await getDocFromNamedDb<GroupDocument>("local", config.namesDb, groupIdForSlug(slug));
    const name = String(request.body.name ?? existing.name).trim();
    const members = Array.isArray(request.body.members)
      ? Array.from(new Set(request.body.members.map((member: unknown) => String(member)).filter((member: string) => member.startsWith("person:")))) as Array<`person:${string}`>
      : existing.members;
    if (!name) {
      response.status(422).json({ error: "directory_validation_failed", errors: [{ field: "name", message: "Group name is required" }] });
      return;
    }
    await assertPeopleExist(members);
    const next: GroupDocument = { ...existing, name, members, updatedAt: timestamp() };
    const groups = (await listGroups()).map((group) => (group._id === next._id ? next : group));
    await assertActiveAdminExists(groups);
    await writeGroupBothTargets(next);
    response.json({ group: publicGroup(next), directory: await directoryState() });
  })
);

// ADR-0016: no dedicated sample-install route. A template is deployed as an app
// via POST /api/platform/apps { appId, title, fromTemplate } (see below).

app.post(
  "/api/platform/apps",
  asyncRoute(async (request, response) => {
    const scope = await requireSession(request, "manager");
    const state = await platformState(request);
    if (!state.setupComplete) {
      response.status(409).json({ error: "setup_required", reason: "Complete setup before creating apps" });
      return;
    }

    const appId = (typeof request.body.appId === "string" ? request.body.appId : "").trim();
    const title = (typeof request.body.title === "string" ? request.body.title : "").trim();
    // Level 2: create a blank app OR instantiate a bundled template as this app.
    const fromTemplate = (typeof request.body.fromTemplate === "string" ? request.body.fromTemplate : "").trim();
    const template = fromTemplate ? sampleTemplateForApp(fromTemplate) : undefined;

    const errors = [...validateAppId(appId)];
    if (!title) errors.push({ field: "title", message: "App title is required" });
    let docType = "";
    let docTypeTitle = "";
    if (fromTemplate) {
      if (!template) errors.push({ field: "fromTemplate", message: `Unknown template: ${fromTemplate}` });
    } else {
      docType = (typeof request.body.docType === "string" ? request.body.docType : "").trim();
      docTypeTitle = (typeof request.body.docTypeTitle === "string" ? request.body.docTypeTitle : "").trim();
      errors.push(...validateDocType(docType));
      if (!docTypeTitle) errors.push({ field: "docTypeTitle", message: "Document type title is required" });
    }
    if (errors.length) {
      response.status(422).json({ error: "app_validation_failed", errors });
      return;
    }

    const database = databaseForAppId(appId);
    const install = appInstallRecord(appId, title, database, timestamp(), scopeUser(scope), template ? template.templateId : "blank:app");
    const [installExists, localDbExists, serverDbExists] = await Promise.all([
      docExistsInDb("local", config.platformDb, install._id),
      dbExists("local", database),
      dbExists("server", database)
    ]);
    if (installExists || localDbExists || serverDbExists) {
      response.status(409).json({ error: "conflict", reason: `App "${appId}" already exists` });
      return;
    }

    const built = template
      ? instantiateTemplate(template.templateId, appId, title)
      : { definitions: scaffoldBlankApp(appId, title, docType, docTypeTitle, scopeUser(scope), database), documents: [] as BusinessDocument[] };
    // ADR-0023: mirror the app:config purpose blurb onto the install record so
    // lotus_admin_list_apps stays a single platform-db read. app:config remains
    // authoritative; a later designer edit to it is not re-mirrored here.
    const builtAppConfig = built.definitions.find((doc) => doc._id === "app:config") as AppConfig | undefined;
    if (builtAppConfig?.description) install.description = builtAppConfig.description;
    const definitionErrors = validateTemplateDefinitions({
      kind: "template",
      templateId: template ? template.templateId : `blank:${appId}`,
      appId,
      version: "created",
      createdAt: timestamp(),
      createdBy: scopeUser(scope),
      source: "catalog",
      definitions: built.definitions
    });
    if (definitionErrors.length) {
      response.status(422).json({ error: "definition_validation_failed", errors: definitionErrors });
      return;
    }

    const seedDocs = [...built.definitions, ...built.documents];
    await Promise.all([ensureNamedDb("local", database), ensureNamedDb("server", database)]);
    await Promise.all([ensureIndexes("local", database), ensureIndexes("server", database)]);
    await Promise.all([
      bulkDocs("local", seedDocs, database),
      bulkDocs("server", seedDocs, database)
    ]);
    await Promise.all([
      upsertDocInDb("local", config.platformDb, install),
      upsertDocInDb("server", config.platformDb, install)
    ]);
    response.status(201).json(await platformState(request));
  })
);

app.post(
  "/api/apps/:appId/replicate",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    const scope = await requireAppSession(request, appContext.database);
    const replication = await replicateBidirectional(scope, appContext.database);
    const purge = await purgeUnreadableLocalDocs(scope, appContext.database);
    const reconcile = await reconcileStates(appContext.database);
    response.json({ ...replication, purge, reconcile });
  })
);

app.get(
  "/api/apps/:appId/definitions",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    const scope = await requireAppSession(request, appContext.database);
    const [appConfig, forms, views, workflows] = await Promise.all([
      getDesignDoc("local", "app:config", appContext.database),
      findDocs<FormDefinition>("local", { selector: { kind: "form" }, limit: 100 }, appContext.database),
      findDocs<ViewDefinition>("local", { selector: { kind: "view" }, limit: 100 }, appContext.database),
      findDocs<WorkflowDefinition>("local", { selector: { kind: "workflow" }, limit: 100 }, appContext.database)
    ]);
    response.json({
      appConfig,
      forms: forms.docs.sort((left, right) => left.title.localeCompare(right.title)),
      views: views.docs.sort((left, right) => left.title.localeCompare(right.title)),
      workflows: workflows.docs.sort((left, right) => left.title.localeCompare(right.title)),
      user: scope.person,
      roles: principalsFor(scope),
      accessLevel: scope.accessLevel
    });
  })
);

// ADR-0023 Phase 2: progressive disclosure. The full `/definitions` endpoint
// above stays authoritative for the client editor and the designer surface; the
// routes below let an operator agent read the app's shape cheaply — a lean
// self-describing index first, then one definition at a time — instead of
// pulling every field/column/state body up front. All are app-ACL-scoped
// through `requireAppSession` (design reads, no per-document `readers`), and
// carry the ADR-0023 `description` prose so the lean listing explains itself.

/** Trim a definition down to its self-describing header (ADR-0023). */
function definitionSummary(
  def: { _id: string; kind: string; docType: string; title: string; description?: string }
) {
  return {
    _id: def._id,
    kind: def.kind,
    docType: def.docType,
    title: def.title,
    ...(def.description ? { description: def.description } : {})
  };
}

app.get(
  "/api/apps/:appId/definitions/summary",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    const scope = await requireAppSession(request, appContext.database);
    const [appConfig, forms, views, workflows] = await Promise.all([
      getDoc<AppConfig>("local", "app:config", "", appContext.database),
      findDocs<FormDefinition>("local", { selector: { kind: "form" }, limit: 100 }, appContext.database),
      findDocs<ViewDefinition>("local", { selector: { kind: "view" }, limit: 100 }, appContext.database),
      findDocs<WorkflowDefinition>("local", { selector: { kind: "workflow" }, limit: 100 }, appContext.database)
    ]);
    const byTitle = <T extends { title: string }>(list: T[]) =>
      [...list].sort((left, right) => left.title.localeCompare(right.title));
    response.json({
      appConfig: {
        title: appConfig.title,
        ...(appConfig.description ? { description: appConfig.description } : {})
      },
      forms: byTitle(forms.docs).map(definitionSummary),
      views: byTitle(views.docs).map(definitionSummary),
      workflows: byTitle(workflows.docs).map(definitionSummary),
      accessLevel: scope.accessLevel
    });
  })
);

app.get(
  "/api/apps/:appId/definitions/forms/:docType",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    await requireAppSession(request, appContext.database);
    const docType = routeParam(request.params.docType);
    try {
      response.json(await formForDocType(docType, appContext.database));
    } catch (error) {
      if (error instanceof CouchError && error.status === 404) {
        response.status(404).json({ error: "not_found", reason: `No form for ${docType}` });
        return;
      }
      throw error;
    }
  })
);

app.get(
  "/api/apps/:appId/definitions/workflows/:docType",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    await requireAppSession(request, appContext.database);
    const docType = routeParam(request.params.docType);
    const def = await workflowForDocType(docType, appContext.database);
    if (!def) {
      response.status(404).json({ error: "not_found", reason: `No workflow for ${docType}` });
      return;
    }
    response.json(def);
  })
);

app.get(
  // Views are N-per-docType, so this one is keyed by the full view id (matching
  // `query_view`/`/views/:id/documents`), not by docType like forms/workflows.
  "/api/apps/:appId/definitions/views/:id",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    await requireAppSession(request, appContext.database);
    const id = routeParam(request.params.id);
    if (!id.startsWith("view:")) {
      response.status(400).json({ error: "bad_request", reason: "View id must start with view:" });
      return;
    }
    try {
      response.json(await getDoc<ViewDefinition>("local", id, "", appContext.database));
    } catch (error) {
      if (error instanceof CouchError && error.status === 404) {
        response.status(404).json({ error: "not_found", reason: `No view ${id}` });
        return;
      }
      throw error;
    }
  })
);

app.get(
  "/api/apps/:appId/access",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    await requireAppSession(request, appContext.database, "manager");
    response.json(await appAccessState(appContext));
  })
);

app.get(
  "/api/apps/:appId/workflows/scaffold-options",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    await requireAppSession(request, appContext.database, "designer");
    const [people, groups] = await Promise.all([listPeople(), listGroups()]);
    response.json({
      people: people.filter((person) => person.active).map(publicPerson),
      groups: groups.map(publicGroup)
    });
  })
);

app.put(
  "/api/apps/:appId/access",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    await requireAppSession(request, appContext.database, "manager");
    const entries = normalizeAccessEntries(request.body.entries);
    await validateAccessEntries(entries);
    await assertAppHasActiveManager(entries);

    const existing = await getDoc<AclRules>("local", "acl:rules", "", appContext.database);
    const next: AclRules = {
      ...existing,
      appId: appContext.appId,
      entries
    };
    const result = await putDoc("local", next, appContext.database);
    response.json({
      ...(await appAccessState(appContext)),
      rev: result.rev
    });
  })
);

app.post(
  "/api/apps/:appId/templates/export",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    const scope = await requireAppSession(request, appContext.database, "designer");
    const appConfig = await getDoc<AppConfig>("local", "app:config", "", appContext.database);
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
      definitions: await currentDefinitions(appContext.database)
    };
    response.json(template);
  })
);

app.post(
  "/api/apps/:appId/templates/diff",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    await requireAppSession(request, appContext.database, "designer");
    const template = request.body.template as TemplateArtifact;
    const errors = validateTemplateDefinitions(template);
    if (errors.length) {
      response.status(422).json({ error: "template_validation_failed", errors });
      return;
    }
    response.json(diffTemplateDefinitions(await currentDefinitions(appContext.database), template.definitions));
  })
);

app.post(
  "/api/apps/:appId/templates/apply",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    await requireAppSession(request, appContext.database, "designer");
    const template = request.body.template as TemplateArtifact;
    const errors = validateTemplateDefinitions(template);
    if (errors.length) {
      response.status(422).json({ error: "template_validation_failed", errors });
      return;
    }
    const before = await currentDefinitions(appContext.database);
    const diff = diffTemplateDefinitions(before, template.definitions);
    const results = await Promise.all(normalizeDefinitions(template.definitions).map((definition) => applyDefinition(definition, appContext.database)));
    response.json({
      ok: true,
      templateId: template.templateId,
      diff,
      applied: results.map((result) => ({ id: result.id, rev: result.rev }))
    });
  })
);

app.get(
  "/api/apps/:appId/documents",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    const scope = await requireAppSession(request, appContext.database);
    const docType = typeof request.query.docType === "string" ? request.query.docType : "";
    const docs = await getBusinessDocs("local", docType, scope, appContext.database);
    response.json(docs);
  })
);

app.get(
  "/api/apps/:appId/views/:id/documents",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    const scope = await requireAppSession(request, appContext.database);
    const view = await getDoc<ViewDefinition>("local", routeParam(request.params.id), "", appContext.database);
    const sort = view.sort?.[0];
    const body: Record<string, unknown> = {
      // ADR-0020: authored filters (incl. @me substitution from THIS caller's
      // principals) first, ACL selector spread last so it always wins.
      selector: { ...mangoSelector(view.filters, view.docType, principalsFor(scope)), ...accessSelector(scope) },
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
    const result = await findDocs<BusinessDocument>("local", body, appContext.database);
    const readable = result.docs.filter((doc) => canReadDocument(doc, scope));
    // M9: free-text search narrows the ACL-scoped set with the shared matcher,
    // so it never widens visibility. Form (local) supplies the searchable fields.
    const query = typeof request.query.q === "string" ? request.query.q : "";
    if (query.trim()) {
      const form = await formForDocType(view.docType, appContext.database);
      response.json(searchDocuments(readable, form, query));
      return;
    }
    response.json(readable);
  })
);

app.get(
  "/api/apps/:appId/documents/:id",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    const scope = await requireAppSession(request, appContext.database);
    const doc = await getReadableDocument(routeParam(request.params.id), scope, appContext.database);
    // ADR-0023 Phase 2: opt-in runtime affordances. Absent the flag the response
    // is the bare document (back-compat with every existing reader); with it the
    // envelope is wrapped and the actor's currently-available transitions are
    // annotated. The block is server-computed through the SAME shared engine that
    // authorizes the write (`availableTransitions`, sync parity lane), so a
    // surfaced action is never one the transition endpoint would then reject.
    const include = new Set(String(request.query.include ?? "").split(",").map((part) => part.trim()));
    if (!include.has("transitions")) {
      response.json(doc);
      return;
    }
    const def = await workflowForDocType(doc.docType, appContext.database);
    // No workflow for the type ⇒ no affordances (not an error): a plain document.
    let form: FormDefinition | null = null;
    if (def) {
      try {
        form = await formForDocType(doc.docType, appContext.database);
      } catch (error) {
        // Guard-field helpText is advisory; a missing form just drops the hints.
        if (!(error instanceof CouchError && error.status === 404)) throw error;
      }
    }
    response.json({
      document: doc,
      availableTransitions: def
        ? transitionAffordances(doc, def, scopeUser(scope), principalsFor(scope), form, timestamp())
        : []
    });
  })
);

app.get(
  // ADR-0014: resolved values for a document's `type: "formula"` fields. Kept off
  // the document/list read paths — the client fetches this only when a form has
  // formula fields. ACL-scoped to the caller both to read the document and inside
  // each lookup (canReadDocument), so it can never widen visibility.
  "/api/apps/:appId/documents/:id/formulas",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    const scope = await requireAppSession(request, appContext.database);
    const doc = await getReadableDocument(routeParam(request.params.id), scope, appContext.database);
    let form: FormDefinition;
    try {
      form = await formForDocType(doc.docType, appContext.database);
    } catch (error) {
      if (error instanceof CouchError && error.status === 404) {
        response.json({});
        return;
      }
      throw error;
    }
    response.json(await resolveFormulaFields(form, doc, scope));
  })
);

app.get(
  "/api/apps/:appId/forms/:docType/options",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    const scope = await requireAppSession(request, appContext.database);
    const form = await formForDocType(routeParam(request.params.docType), appContext.database);
    response.json(await selectOptionsForForm(form, scope, appContext.database));
  })
);

app.post(
  "/api/apps/:appId/documents",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    const scope = await requireAppSession(request, appContext.database, "author");
    const docType = request.body.docType ?? "";
    const form = await formForDocType(docType, appContext.database);
    const optionsByField = await selectOptionsForForm(form, scope, appContext.database);
    const payload = applyComputedFields(form, normalizePayload(form, request.body.payload ?? {}));
    const errors = validatePayload(form, payload, undefined, optionsByField);
    if (errors.length) {
      response.status(422).json({ error: "validation_failed", errors });
      return;
    }
    // ADR-0024: the creator's own principals are the readers/authors BASE; any
    // extra readers/authors come from `aclRole`-flagged computed fields, unioned
    // in by `stampComputedFields` (§2). No app-specific readers rule in base.
    const readers = principalsFor(scope);
    // M12: stamp the document generically so any scaffolded docType is correct
    // (was hardcoded to expense/vendor).
    const doc = await stampComputedFields(
      form,
      createDocument(docType, payload, scopeUser(scope), readers, appContext.appId),
      undefined,
      scope
    );
    const result = await putDoc("local", doc, appContext.database);
    response.status(201).json({ ...doc, _rev: result.rev });
  })
);

app.put(
  "/api/apps/:appId/documents/:id",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    const scope = await requireAppSession(request, appContext.database);
    const existing = await getReadableDocument(routeParam(request.params.id), scope, appContext.database);
    if (!canEditDocument(existing, scope)) {
      response.status(403).json({ error: "forbidden", reason: "Document is not editable by current user" });
      return;
    }
    const form = await formForDocType(existing.docType, appContext.database);
    const payload = applyComputedFields(form, normalizePayload(form, request.body.payload ?? existing.payload), existing);
    const errors = validatePayload(form, payload, existing, await selectOptionsForForm(form, scope, appContext.database));
    if (errors.length) {
      response.status(422).json({ error: "validation_failed", errors });
      return;
    }
    const updated = await stampComputedFields(
      form,
      { ...existing, updatedAt: timestamp(), updatedBy: scopeUser(scope), payload },
      existing.payload,
      scope
    );
    const result = await putDoc("local", updated, appContext.database);
    response.json({ ...updated, _rev: result.rev });
  })
);

app.delete(
  "/api/apps/:appId/documents/:id",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    const scope = await requireAppSession(request, appContext.database);
    const existing = await getReadableDocument(routeParam(request.params.id), scope, appContext.database);
    if (!canEditDocument(existing, scope)) {
      response.status(403).json({ error: "forbidden", reason: "Document is not editable by current user" });
      return;
    }
    // Record the delete before removing the doc — the envelope (readers/actor) is
    // gone afterward, and the CDC drain can't see a deleted body. Best-effort.
    await recordDeleteAudit(existing, scopeUser(scope), timestamp(), appContext.database);
    await deleteDoc("local", existing._id, existing._rev ?? "", appContext.database);
    response.status(204).end();
  })
);

app.post(
  "/api/apps/:appId/documents/:id/transition",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    const scope = await requireAppSession(request, appContext.database);
    const existing = await getReadableDocument(routeParam(request.params.id), scope, appContext.database);
    const def = await workflowForDocType(existing.docType, appContext.database);
    if (!def) {
      response.status(404).json({ error: "not_found", reason: `No workflow for ${existing.docType}` });
      return;
    }
    // ADR-0025 (gating itself is sync-lane per ADR-0019): resolve the target
    // state's standing responsibility in the async formula lane BEFORE the pure
    // engine runs — under the ACTOR's ACL scope (lookups can only narrow) and
    // against the LOCAL replica (offline nodes resolve too). The result is a
    // normalized principal SET (not narrowed to one). Assignment is routing
    // metadata: resolution fails closed and never fails the transition.
    const requested = def.transitions.find((candidate) => candidate.id === request.body.transition);
    const resolved: ResolvedTransitionContext = {};
    const targetState = def.states.find((candidate) => candidate.name === requested?.to);
    if (targetState?.responsibleFormula) {
      resolved.responsible = normalizeResolvedPrincipals(
        await evaluateFormulaAsync(targetState.responsibleFormula, {
          payload: existing.payload,
          doc: existing as unknown as Record<string, unknown>,
          user: scopeUser(scope),
          scope,
          read: makeDbReader()
        })
      );
    }
    // Same shared engine the client uses to offer the action — authoritative here (A2/A3).
    const result = applyTransition(existing, def, request.body.transition, scopeUser(scope), principalsFor(scope), timestamp(), resolved);
    if (!result.ok) {
      response.status(422).json({ error: "transition_failed", errors: result.errors });
      return;
    }
    const updated: BusinessDocument = { ...result.document, updatedAt: timestamp(), updatedBy: scopeUser(scope) };
    let put: { rev: string };
    try {
      put = await putDoc("local", updated, appContext.database);
    } catch (error) {
      // The async resolution above widens the read-modify-write window; a
      // concurrent transition surfaces as a Couch 409 — return it retryable
      // instead of leaking a 500 (review n4).
      if (error instanceof CouchError && error.status === 409) {
        response.status(409).json({ error: "conflict", reason: "Document changed while transitioning; retry" });
        return;
      }
      throw error;
    }
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
  "/api/apps/:appId/agents/run",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    await requireAppSession(request, appContext.database, "designer");
    const result = await runAgents(timestamp(), appContext.database);
    response.json({ ok: true, ran: result.ran, runs: result.runs });
  })
);

app.get(
  "/api/apps/:appId/agents",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    await requireAppSession(request, appContext.database, "designer");
    const result = await findDocs<AgentDefinition>("local", { selector: { kind: "agent" }, limit: 100 }, appContext.database);
    response.json(result.docs.sort((left, right) => left._id.localeCompare(right._id)));
  })
);

app.get(
  "/api/apps/:appId/agents/runs",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    await requireAppSession(request, appContext.database, "designer");
    const result = await findDocs<AgentRun>("local", { selector: { kind: "agentrun" }, limit: 200 }, appContext.database);
    response.json(result.docs.sort((left, right) => right.startedAt.localeCompare(left.startedAt)));
  })
);

app.post(
  "/api/apps/:appId/audit/run",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    await requireAppSession(request, appContext.database, "designer");
    const result = await runAudit(timestamp(), appContext.database);
    response.json({ ok: true, ...result });
  })
);

app.get(
  "/api/apps/:appId/audit",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    const principals = principalsFor(await requireAppSession(request, appContext.database));
    const docId = typeof request.query.docId === "string" ? request.query.docId : undefined;
    const docType = typeof request.query.docType === "string" ? request.query.docType : undefined;
    const result = await findDocs<AuditEvent>("local", { selector: { kind: "auditevent" }, limit: 500 }, appContext.database);
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
  "/api/apps/:appId/conflicts",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    const scope = await requireAppSession(request, appContext.database);
    const result = await allDocs<CouchDocument>("local", {
      include_docs: true,
      conflicts: true
    }, appContext.database);
    const docs = result.rows
      .map((row) => row.doc)
      .filter((doc): doc is CouchDocument => Boolean((doc as (CouchDocument & { _conflicts?: string[] }) | undefined)?._conflicts?.length))
      .filter((doc) => doc.kind !== "document" || canReadDocument(doc, scope));
    response.json(docs);
  })
);

app.put(
  "/api/apps/:appId/definitions/:id",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    await requireAppSession(request, appContext.database, "designer");
    const id = routeParam(request.params.id);
    if (!id.startsWith("form:") && !id.startsWith("view:") && !id.startsWith("workflow:") && !id.startsWith("agent:")) {
      response.status(400).json({ error: "bad_request", reason: "Only form:*, view:*, workflow:*, and agent:* docs are editable" });
      return;
    }
    const existing = await getDoc<CouchDocument>("local", id, "", appContext.database);
    const next = { ...request.body, _id: id, _rev: existing._rev } as CouchDocument;
    const errors = validateDesignDefinition(next);
    if (errors.length) {
      response.status(422).json({ error: "definition_validation_failed", errors });
      return;
    }
    const result = await putDoc("local", next, appContext.database);
    response.json({ ...next, _rev: result.rev });
  })
);

// M23: add the standard approval lifecycle to an existing document type. This
// creates ordinary design docs only; business document readers/authors stay
// untouched and transition authorization remains the existing workflow gate.
app.post(
  "/api/apps/:appId/workflows/scaffold",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    await requireAppSession(request, appContext.database, "designer");
    const docType = (typeof request.body.docType === "string" ? request.body.docType : "").trim();
    const approverPrincipal = (typeof request.body.approverPrincipal === "string" ? request.body.approverPrincipal : "").trim();

    const slugErrors = validateDocType(docType);
    if (slugErrors.length) {
      response.status(422).json({ error: "workflow_scaffold_validation_failed", errors: slugErrors });
      return;
    }
    await validateWorkflowApproverPrincipal(approverPrincipal);
    let form: FormDefinition;
    try {
      form = await formForDocType(docType, appContext.database);
    } catch (error) {
      if (error instanceof CouchError && error.status === 404) {
        response.status(404).json({ error: "not_found", reason: `No form for ${docType}` });
        return;
      }
      throw error;
    }
    const { workflow, views } = scaffoldApprovalWorkflow(appContext.appId, docType, form.title, approverPrincipal);
    const candidates = [workflow, ...views];
    for (const definition of candidates) {
      if (await definitionExists(definition._id, appContext.database)) {
        response.status(409).json({ error: "conflict", reason: `${definition._id} already exists` });
        return;
      }
    }
    const errors = candidates.flatMap((definition) => validateDesignDefinition(definition));
    if (errors.length) {
      response.status(422).json({ error: "definition_validation_failed", errors });
      return;
    }
    await Promise.all(candidates.map((definition) => applyDefinition(definition, appContext.database)));
    response.status(201).json({ workflow, views });
  })
);

// M12: scaffold a brand-new document type — a form + a list view — so a citizen
// can create an app from scratch. The pair is built by the shared scaffold,
// validated by the shared validators, and written local-first (upsert), exactly
// like any other definition.
app.post(
  "/api/apps/:appId/document-types",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    await requireAppSession(request, appContext.database, "designer");
    const docType = (typeof request.body.docType === "string" ? request.body.docType : "").trim();
    const title = typeof request.body.title === "string" ? request.body.title : "";

    const slugErrors = validateDocType(docType);
    if (slugErrors.length) {
      response.status(422).json({ error: "document_type_validation_failed", errors: slugErrors });
      return;
    }
    if ((await definitionExists(`form:${docType}`, appContext.database)) || (await definitionExists(`view:${docType}`, appContext.database))) {
      response.status(409).json({ error: "conflict", reason: `Document type "${docType}" already exists` });
      return;
    }

    const appConfig = await getDoc<AppConfig>("local", "app:config", "", appContext.database);
    const { form, view } = scaffoldDocumentType(appConfig.appId, docType, title);
    const errors = [...validateDesignDefinition(form), ...validateDesignDefinition(view)];
    if (errors.length) {
      response.status(422).json({ error: "definition_validation_failed", errors });
      return;
    }
    await applyDefinition(form, appContext.database);
    await applyDefinition(view, appContext.database);
    response.status(201).json({ form, view });
  })
);

app.get(
  "/api/apps/:appId/conflicts/:id",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    const details = await conflictDetails(routeParam(request.params.id), await requireAppSession(request, appContext.database), appContext.database);
    if (!details) {
      response.status(404).json({ error: "not_found", reason: "Document has no local conflicts" });
      return;
    }
    response.json(details);
  })
);

app.post(
  "/api/apps/:appId/conflicts/:id/resolve",
  asyncRoute(async (request, response) => {
    const appContext = await appContextFromRequest(request);
    const scope = await requireAppSession(request, appContext.database);
    const details = await conflictDetails(routeParam(request.params.id), scope, appContext.database);
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

    // ADR-0019 (review B1): the elected payload is a payload WRITE — it runs the
    // normalize -> compute-handlers -> stamp pipeline so a resolver cannot
    // smuggle a tampered computed value (e.g. a self-serving approver) past the
    // tamper rule. Elected payloads keep their pre-existing exemption from
    // user-input validatePayload (electing a historic revision must not be
    // blockable by later-tightened rules).
    let electedPayload = request.body.payload;
    let electedEnvelope: { readers: string[]; authors: string[] } | undefined;
    if (chosen.kind === "document") {
      const chosenDoc = chosen as BusinessDocument;
      electedPayload = electedPayload ?? chosenDoc.payload;
      const form = await formForDocType(chosenDoc.docType, appContext.database);
      electedPayload = applyComputedFields(form, normalizePayload(form, electedPayload), chosenDoc);
      const stamped = await stampComputedFields(
        form,
        { ...chosenDoc, payload: electedPayload },
        chosenDoc.payload,
        scope
      );
      electedPayload = stamped.payload;
      // ADR-0024 §2: envelope readers/authors are a server-materialized projection
      // of the aclRole fields in the elected payload. Persist the WHOLE stamped
      // envelope, not just its payload — else a re-resolved aclRole principal lands
      // in the payload field while readers/authors omit it (payload-vs-projection
      // divergence). Matches the POST/PUT stamped-envelope writes.
      electedEnvelope = { readers: stamped.readers, authors: stamped.authors };
    }
    const resolved =
      chosen.kind === "document"
        ? {
            ...chosen,
            _rev: details.winning._rev,
            _conflicts: undefined,
            updatedAt: timestamp(),
            updatedBy: scopeUser(scope),
            payload: electedPayload,
            ...(electedEnvelope ?? {})
          }
        : {
            ...chosen,
            _rev: details.winning._rev,
            _conflicts: undefined,
            ...(request.body.document ?? {})
          };
    const result = await putDoc("local", resolved, appContext.database);

    await Promise.all(details.conflicts.map((conflict) => deleteDoc("local", conflict._id, conflict._rev ?? "", appContext.database)));

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
