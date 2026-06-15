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

export type WorkflowState = {
  name: string;
  label: string;
  final?: boolean;
};

export type WorkflowTransition = {
  id: string;
  label: string;
  /** Source state name, or "*" to allow from any non-final state. */
  from: string;
  to: string;
  /** M2 expression over { payload, doc, user, now }; must be truthy to allow. */
  guard?: string;
  /** Role (as in acl:rules) required to perform this transition. */
  requiredRole?: string;
};

export type WorkflowDefinition = {
  _id: `workflow:${string}`;
  _rev?: string;
  kind: "workflow";
  appId: string;
  docType: string;
  title: string;
  initialState: string;
  states: WorkflowState[];
  transitions: WorkflowTransition[];
};

export type TransitionEvent = {
  transition: string;
  from: string;
  to: string;
  at: string;
  by: string;
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
  /**
   * Workflow lifecycle (M3). All optional and absent until the first transition,
   * so already-replicated M1/M2 documents stay valid. A document with no `state`
   * is treated as the workflow's `initialState`.
   */
  state?: string;
  stateUpdatedAt?: string;
  stateUpdatedBy?: string;
  history?: TransitionEvent[];
};

export type AclRules = {
  _id: "acl:rules";
  _rev?: string;
  kind: "acl";
  appId: string;
  policy: string;
  users: Array<{ user: string; roles: string[] }>;
};

export type DesignDocument = AppConfig | FormDefinition | ViewDefinition | WorkflowDefinition | AclRules;

export type TemplateArtifact = {
  kind: "template";
  templateId: string;
  appId: string;
  version: string;
  createdAt: string;
  createdBy: string;
  source: string;
  definitions: DesignDocument[];
};

export type TemplateDiffEntry = {
  id: string;
  kind: DesignDocument["kind"];
};

export type TemplateDiff = {
  added: TemplateDiffEntry[];
  removed: TemplateDiffEntry[];
  changed: TemplateDiffEntry[];
  unchanged: TemplateDiffEntry[];
};

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
