import { ulid } from "ulid";
import type { BusinessDocument, DesignDocument } from "../shared/types";
import { config } from "./config";
import { sampleTemplateDocuments } from "./template-registry";

const now = () => new Date().toISOString();

/** Generic business-document constructor (M12) — stamps the given appId/docType/_id. */
export function createDocument(
  docType: string,
  payload: Record<string, unknown>,
  user = config.appUser,
  readers = [user],
  appId = ""
): BusinessDocument {
  const timestamp = now();
  return {
    _id: `doc:${docType}:${ulid()}`,
    kind: "document",
    appId,
    docType,
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: user,
    updatedBy: user,
    readers,
    authors: [user],
    payload
  };
}

export function createExpenseDoc(
  payload: Record<string, unknown>,
  user = config.appUser,
  readers = ["person:alice", "group:finance"]
): BusinessDocument {
  return createDocument("expense", payload, user, readers, "expense");
}

export function createVendorDoc(
  payload: Record<string, unknown>,
  user = config.appUser,
  readers = ["person:alice", "group:finance"]
): BusinessDocument {
  return createDocument("vendor", payload, user, readers, "expense");
}

export function seedDocuments(): Array<
  DesignDocument | BusinessDocument
> {
  return sampleTemplateDocuments("sample:expense");
}
