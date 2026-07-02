import type { BusinessDocument, CouchDocument } from "../shared/types";
import { accessSelector, type PrincipalScope } from "../shared/access";
import { config } from "./config";

export type CouchTarget = "local" | "server";

export type CouchRow<T> = {
  id: string;
  key: string;
  value: { rev: string };
  doc?: T;
};

type CouchErrorBody = {
  error?: string;
  reason?: string;
};

export class CouchError extends Error {
  status: number;
  body: CouchErrorBody;

  constructor(status: number, body: CouchErrorBody) {
    super(body.reason ?? body.error ?? `CouchDB request failed with ${status}`);
    this.status = status;
    this.body = body;
  }
}

export const targetUrl = (target: CouchTarget) =>
  target === "local" ? config.localCouchUrl : config.serverCouchUrl;

export const dbUrl = (target: CouchTarget, db = config.appDb) => `${targetUrl(target)}/${db}`;
export const replicationDbUrl = (target: CouchTarget, db = config.appDb) =>
  `${target === "local" ? config.localReplicationUrl : config.serverReplicationUrl}/${db}`;

export async function couchRequest<T>(
  target: CouchTarget,
  path = "",
  init: RequestInit = {}
): Promise<T> {
  const parsedUrl = new URL(`${targetUrl(target)}${path}`);
  const headers = new Headers(init.headers);
  if (parsedUrl.username || parsedUrl.password) {
    const credentials = Buffer.from(`${decodeURIComponent(parsedUrl.username)}:${decodeURIComponent(parsedUrl.password)}`);
    headers.set("authorization", `Basic ${credentials.toString("base64")}`);
    parsedUrl.username = "";
    parsedUrl.password = "";
  }
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(parsedUrl, { ...init, headers });
  if (!response.ok) {
    let body: CouchErrorBody = {};
    try {
      body = (await response.json()) as CouchErrorBody;
    } catch {
      body = { reason: response.statusText };
    }
    throw new CouchError(response.status, body);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function rawCouchRequest<T>(
  target: CouchTarget,
  path = "",
  init: RequestInit = {}
): Promise<T> {
  return couchRequest<T>(target, path, init);
}

export async function ping(target: CouchTarget): Promise<boolean> {
  try {
    await couchRequest(target);
    return true;
  } catch {
    return false;
  }
}

export async function dbExists(target: CouchTarget, db = config.appDb): Promise<boolean> {
  try {
    await couchRequest(target, `/${db}`);
    return true;
  } catch (error) {
    if (error instanceof CouchError && error.status === 404) return false;
    return false;
  }
}

export async function ensureDb(target: CouchTarget, db = config.appDb) {
  try {
    await couchRequest(target, `/${db}`, { method: "PUT" });
  } catch (error) {
    if (!(error instanceof CouchError) || error.status !== 412) throw error;
  }
}

export async function listDbs(target: CouchTarget): Promise<string[]> {
  return await couchRequest<string[]>(target, "/_all_dbs");
}

export async function deleteDb(target: CouchTarget, db = config.appDb) {
  try {
    await couchRequest(target, `/${db}`, { method: "DELETE" });
  } catch (error) {
    if (!(error instanceof CouchError) || error.status !== 404) throw error;
  }
}

export async function getDoc<T>(target: CouchTarget, id: string, query = "", db = config.appDb): Promise<T> {
  return couchRequest<T>(target, `/${db}/${encodeURIComponent(id)}${query}`);
}

export async function getDocFromDb<T>(target: CouchTarget, db: string, id: string, query = ""): Promise<T> {
  return couchRequest<T>(target, `/${db}/${encodeURIComponent(id)}${query}`);
}

export async function putDoc<T extends { _id: string; _rev?: string }>(
  target: CouchTarget,
  doc: T,
  db = config.appDb
): Promise<{ ok: boolean; id: string; rev: string }> {
  return couchRequest(target, `/${db}/${encodeURIComponent(doc._id)}`, {
    method: "PUT",
    body: JSON.stringify(doc)
  });
}

export async function deleteDoc(target: CouchTarget, id: string, rev: string, db = config.appDb) {
  return couchRequest(target, `/${db}/${encodeURIComponent(id)}?rev=${encodeURIComponent(rev)}`, {
    method: "DELETE"
  });
}

export async function purgeDocs(target: CouchTarget, revisions: Record<string, string[]>, db = config.appDb) {
  return couchRequest(target, `/${db}/_purge`, {
    method: "POST",
    body: JSON.stringify(revisions)
  });
}

export async function bulkDocs(target: CouchTarget, docs: object[], db = config.appDb) {
  return couchRequest(target, `/${db}/_bulk_docs`, {
    method: "POST",
    body: JSON.stringify({ docs })
  });
}

export async function createIndex(target: CouchTarget, name: string, fields: string[], db = config.appDb) {
  // Pin the design-doc id to the index name (ddoc === name). Without this CouchDB
  // auto-generates a hashed ddoc id, and a `use_index: "<name>"` hint — which
  // CouchDB resolves as a ddoc id — never binds, silently falling back to
  // auto-selection. With an explicit ddoc the name resolves and hints bind.
  return couchRequest(target, `/${db}/_index`, {
    method: "POST",
    body: JSON.stringify({ index: { fields }, name, ddoc: name, type: "json" })
  });
}

export async function allDocs<T>(target: CouchTarget, options: Record<string, unknown> = {}, db = config.appDb) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    params.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  return couchRequest<{ rows: Array<CouchRow<T>> }>(
    target,
    `/${db}/_all_docs?${params.toString()}`
  );
}

export type ChangesResponse = {
  last_seq: string | number;
  results: Array<{ id: string; seq: string | number; deleted?: boolean; doc?: CouchDocument }>;
};

/** Drain the CouchDB `_changes` feed since a checkpoint sequence (M8 agent CDC). */
export async function changesSince(target: CouchTarget, since: string, db = config.appDb): Promise<ChangesResponse> {
  const params = new URLSearchParams({ since, include_docs: "true" });
  return couchRequest<ChangesResponse>(target, `/${db}/_changes?${params.toString()}`);
}

export async function findDocs<T>(target: CouchTarget, body: Record<string, unknown>, db = config.appDb) {
  return couchRequest<{ docs: T[] }>(target, `/${db}/_find`, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function docsByKind<T>(target: CouchTarget, kind: string, db = config.appDb): Promise<T[]> {
  const result = await allDocs<T & { kind?: string }>(target, {
    include_docs: true,
    conflicts: true
  }, db);
  return result.rows
    .map((row) => row.doc)
    .filter((doc): doc is T & { kind?: string } => Boolean(doc && doc.kind === kind)) as T[];
}

export async function allRuntimeDocs(target: CouchTarget, db = config.appDb) {
  const result = await allDocs<CouchDocument>(target, {
    include_docs: true,
    conflicts: true
  }, db);
  return result.rows
    .map((row) => row.doc)
    .filter((doc): doc is CouchDocument => Boolean(doc && !("_deleted" in doc)));
}

export async function getDesignDoc(target: CouchTarget, id: string, db = config.appDb) {
  return getDoc(target, id, "", db);
}

export async function getBusinessDocs(target: CouchTarget, docType: string, scope?: PrincipalScope, db = config.appDb) {
  const result = await findDocs<BusinessDocument>(target, {
    selector: {
      kind: "document",
      docType,
      ...(scope ? accessSelector(scope) : {})
    },
    sort: [{ updatedAt: "desc" }],
    use_index: "m2-kind-docType-updatedAt",
    limit: 200
  }, db);
  return result.docs.filter((doc) => !("_deleted" in doc));
}

export async function replicateOnce(direction: "push" | "pull", selector?: Record<string, unknown>, db = config.appDb) {
  const body =
    direction === "push"
      ? { source: replicationDbUrl("local", db), target: replicationDbUrl("server", db), create_target: true, selector }
      : { source: replicationDbUrl("server", db), target: replicationDbUrl("local", db), create_target: true, selector };

  return couchRequest("local", "/_replicate", {
    method: "POST",
    body: JSON.stringify(Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)))
  });
}

export async function replicateBidirectional(scope?: PrincipalScope, db = config.appDb) {
  const push = await replicateOnce("push", undefined, db);
  if (!scope) {
    const pull = await replicateOnce("pull", undefined, db);
    return { push, pull };
  }

  const pullDesign = await replicateOnce("pull", {
    kind: {
      $in: ["app", "form", "view", "workflow", "acl", "auditpolicy", "agent"]
    }
  }, db);
  const pullBusiness = await replicateOnce("pull", {
    kind: "document",
    ...accessSelector(scope)
  }, db);
  return { push, pull: { design: pullDesign, business: pullBusiness } };
}
