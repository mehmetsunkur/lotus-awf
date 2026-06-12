import type { BusinessDocument } from "../shared/types";
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

export async function couchRequest<T>(
  target: CouchTarget,
  path = "",
  init: RequestInit = {}
): Promise<T> {
  const url = `${targetUrl(target)}${path}`;
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(url, { ...init, headers });
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

export async function putDoc<T extends { _id: string; _rev?: string }>(
  target: CouchTarget,
  doc: T
): Promise<{ ok: boolean; id: string; rev: string }> {
  return couchRequest(target, `/${config.appDb}/${encodeURIComponent(doc._id)}`, {
    method: "PUT",
    body: JSON.stringify(doc)
  });
}

export async function bulkDocs(target: CouchTarget, docs: object[]) {
  return couchRequest(target, `/${config.appDb}/_bulk_docs`, {
    method: "POST",
    body: JSON.stringify({ docs })
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

export async function docsByKind<T>(target: CouchTarget, kind: string): Promise<T[]> {
  const result = await allDocs<T & { kind?: string }>(target, {
    include_docs: true,
    conflicts: true
  });
  return result.rows
    .map((row) => row.doc)
    .filter((doc): doc is T & { kind?: string } => Boolean(doc && doc.kind === kind)) as T[];
}

export async function getDesignDoc(target: CouchTarget, id: string) {
  return getDoc(target, id);
}

export async function getBusinessDocs(target: CouchTarget, docType = "expense") {
  const docs = await docsByKind<BusinessDocument>(target, "document");
  return docs.filter((doc) => doc.docType === docType && !("_deleted" in doc));
}
