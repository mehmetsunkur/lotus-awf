import type { AclRules, AppConfig, AuditPolicy, DesignDocument, ValidationError } from "./types";
import { scaffoldDocumentType } from "./scaffold";
import { fold } from "./search";

const APP_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const RESERVED_APP_IDS = new Set(["setup", "catalog", "login", "platform", "expense"]);

export function slugifyAppId(input: string): string {
  return fold(input)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function validateAppId(appId: string): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!appId || !appId.trim()) {
    errors.push({ field: "appId", message: "App id is required" });
    return errors;
  }
  if (!APP_ID_PATTERN.test(appId)) {
    errors.push({ field: "appId", message: "App id must be a lowercase slug (a-z, 0-9, dashes; starting with a letter)" });
  }
  if (RESERVED_APP_IDS.has(appId)) {
    errors.push({ field: "appId", message: `App id "${appId}" is reserved` });
  }
  return errors;
}

export function databaseForAppId(appId: string): string {
  return `${appId}_app`;
}

export function scaffoldBlankApp(
  appId: string,
  title: string,
  docType: string,
  docTypeTitle: string,
  owner: string,
  database = databaseForAppId(appId)
): DesignDocument[] {
  const appConfig: AppConfig = {
    _id: "app:config",
    kind: "app",
    appId,
    title: title.trim() || appId,
    database
  };
  const acl: AclRules = {
    _id: "acl:rules",
    kind: "acl",
    appId,
    policy: "M21: created app ACL grants manager access to the creator.",
    entries: [{ principal: owner, level: "manager" }]
  };
  const auditPolicy: AuditPolicy = {
    _id: "audit:policy",
    kind: "auditpolicy",
    appId,
    retentionDays: 365
  };
  const { form, view } = scaffoldDocumentType(appId, docType, docTypeTitle);
  return [acl, appConfig, auditPolicy, form, view];
}
