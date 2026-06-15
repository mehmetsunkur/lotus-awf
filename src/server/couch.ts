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

export async function deleteDb(target: CouchTarget, db = config.appDb) {
  try {
    await couchRequest(target, `/${db}`, { method: "DELETE" });
  } catch (error) {
    if (!(error instanceof CouchError) || error.status !== 404) throw error;
  }
}

export async function getDoc<T>(target: CouchTarget, id: string, query = ""): Promise<T> {
  return couchRequest<T>(target, `/${config.appDb}/${encodeURIComponent(id)}${query}`);
}

export async function getDocFromDb<T>(target: CouchTarget, db: string, id: string, query = ""): Promise<T> {
  return couchRequest<T>(target, `/${db}/${encodeURIComponent(id)}${query}`);
}

export async function putDoc<T extends { _id: string; _rev?: string }>(
  target: CouchTarget,
  doc: T
): Promise<{ ok: boolean; id: string; rev: string }> {
  return couchRequest(target, `/${config.appDb}/${encodeURIComponent(doc._id)}`, {
    method: "PUT",
    body: JSON.stringify(doc)
  });
}

export async function deleteDoc(target: CouchTarget, id: string, rev: string) {
  return couchRequest(target, `/${config.appDb}/${encodeURIComponent(id)}?rev=${encodeURIComponent(rev)}`, {
    method: "DELETE"
  });
}

export async function purgeDocs(target: CouchTarget, revisions: Record<string, string[]>) {
  return couchRequest(target, `/${config.appDb}/_purge`, {
    method: "POST",
    body: JSON.stringify(revisions)
  });
}

export async function bulkDocs(target: CouchTarget, docs: object[]) {
  return couchRequest(target, `/${config.appDb}/_bulk_docs`, {
    method: "POST",
    body: JSON.stringify({ docs })
  });
}

export async function createIndex(target: CouchTarget, name: string, fields: string[]) {
  // Pin the design-doc id to the index name (ddoc === name). Without this CouchDB
  // auto-generates a hashed ddoc id, and a `use_index: "<name>"` hint — which
  // CouchDB resolves as a ddoc id — never binds, silently falling back to
  // auto-selection. With an explicit ddoc the name resolves and hints bind.
  return couchRequest(target, `/${config.appDb}/_index`, {
    method: "POST",
    body: JSON.stringify({ index: { fields }, name, ddoc: name, type: "json" })
  });
}

export async function allDocs<T>(target: CouchTarget, options: Record<string, unknown> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    params.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  return couchRequest<{ rows: Array<CouchRow<T>> }>(
    target,
    `/${config.appDb}/_all_docs?${params.toString()}`
  );
}

export type ChangesResponse = {
  last_seq: string | number;
  results: Array<{ id: string; seq: string | number; deleted?: boolean; doc?: CouchDocument }>;
};

/** Drain the CouchDB `_changes` feed since a checkpoint sequence (M8 agent CDC). */
export async function changesSince(target: CouchTarget, since: string): Promise<ChangesResponse> {
  const params = new URLSearchParams({ since, include_docs: "true" });
  return couchRequest<ChangesResponse>(target, `/${config.appDb}/_changes?${params.toString()}`);
}

export async function findDocs<T>(target: CouchTarget, body: Record<string, unknown>) {
  return couchRequest<{ docs: T[] }>(target, `/${config.appDb}/_find`, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function docsByKind<T>(target: CouchTarget, kind: string): Promise<T[]> {
  const result = await allDocs<T & { kind?: string }>(target, {
    include_docs: true,
    conflicts: true
  });
  return result.rows
    .map((row) => row.doc)
    .filter((doc): doc is T & { kind?: string } => Boolean(doc && doc.kind === kind)) as T[];
}

export async function allRuntimeDocs(target: CouchTarget) {
  const result = await allDocs<CouchDocument>(target, {
    include_docs: true,
    conflicts: true
  });
  return result.rows
    .map((row) => row.doc)
    .filter((doc): doc is CouchDocument => Boolean(doc && !("_deleted" in doc)));
}

export async function getDesignDoc(target: CouchTarget, id: string) {
  return getDoc(target, id);
}

export async function getBusinessDocs(target: CouchTarget, docType = "expense", scope?: PrincipalScope) {
  const result = await findDocs<BusinessDocument>(target, {
    selector: {
      kind: "document",
      docType,
      ...(scope ? accessSelector(scope) : {})
    },
    sort: [{ updatedAt: "desc" }],
    use_index: "m2-kind-docType-updatedAt",
    limit: 200
  });
  return result.docs.filter((doc) => !("_deleted" in doc));
}

export async function replicateOnce(direction: "push" | "pull", selector?: Record<string, unknown>) {
  const body =
    direction === "push"
      ? { source: replicationDbUrl("local"), target: replicationDbUrl("server"), create_target: true, selector }
      : { source: replicationDbUrl("server"), target: replicationDbUrl("local"), create_target: true, selector };

  return couchRequest("local", "/_replicate", {
    method: "POST",
    body: JSON.stringify(Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)))
  });
}

export async function replicateBidirectional(scope?: PrincipalScope) {
  const push = await replicateOnce("push");
  if (!scope) {
    const pull = await replicateOnce("pull");
    return { push, pull };
  }

  const pullDesign = await replicateOnce("pull", {
    kind: {
      $in: ["app", "form", "view", "workflow", "acl"]
    }
  });
  const pullBusiness = await replicateOnce("pull", {
    kind: "document",
    ...accessSelector(scope)
  });
  return { push, pull: { design: pullDesign, business: pullBusiness } };
}
