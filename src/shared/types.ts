export type CouchId = string;

export type AppConfig = {
  _id: "app:config";
  _rev?: string;
  kind: "app";
  appId: string;
  title: string;
  database: string;
};

export type FieldType = "text" | "textarea" | "number" | "date" | "boolean" | "select";

export type ExpressionRule = {
  expression: string;
  message?: string;
};

export type SelectOption = {
  label: string;
  value: string;
};

export type FieldSource = {
  docType: string;
  labelField: string;
  valueField?: string;
};

export type FormField = {
  name: string;
  type: FieldType;
  label: string;
  required?: boolean;
  requiredWhen?: string;
  visibleWhen?: string;
  readOnlyWhen?: string;
  defaultValue?: unknown;
  helpText?: string;
  options?: SelectOption[];
  source?: FieldSource;
  validate?: ExpressionRule[];
};

export type FormSection = {
  title: string;
  fields: string[];
};

export type FormDefinition = {
  _id: `form:${string}`;
  _rev?: string;
  kind: "form";
  appId: string;
  docType: string;
  title: string;
  sections?: FormSection[];
  fields: FormField[];
};

export type ViewColumn = {
  field: string;
  label: string;
};

export type ViewSort = {
  field: string;
  direction: "asc" | "desc";
};

export type ViewFilter = {
  field: string;
  op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in";
  value: unknown;
};

export type ViewDefinition = {
  _id: `view:${string}`;
  _rev?: string;
  kind: "view";
  appId: string;
  docType: string;
  title: string;
  columns: ViewColumn[];
  filters?: ViewFilter[];
  sort?: ViewSort[];
};

export type BusinessDocument = {
  _id: `doc:${string}:${string}`;
  _rev?: string;
  _conflicts?: string[];
  kind: "document";
  appId: string;
  docType: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  readers: string[];
  authors: string[];
  payload: Record<string, unknown>;
};

export type AclRules = {
  _id: "acl:rules";
  _rev?: string;
  kind: "acl";
  appId: string;
  policy: string;
  users: Array<{ user: string; roles: string[] }>;
};

export type DesignDocument = AppConfig | FormDefinition | ViewDefinition | AclRules;

export type ReplicationStatus = {
  localReachable: boolean;
  serverReachable: boolean;
  localDbExists: boolean;
  serverDbExists: boolean;
  replications: unknown[];
};

export type ConflictDetails = {
  document: CouchDocument;
  winning: CouchDocument;
  conflicts: CouchDocument[];
};

export type CouchDocument = BusinessDocument | DesignDocument;

export type ValidationError = {
  field: string;
  message: string;
};

export type SelectOptionsByField = Record<string, SelectOption[]>;
