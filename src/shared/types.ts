export type CouchId = string;

export type AppConfig = {
  _id: "app:config";
  _rev?: string;
  kind: "app";
  appId: string;
  title: string;
  database: string;
  /**
   * ADR-0023: one-line prose describing what the app is for, so an operator agent
   * (or app listing) can pick the right app without opening every definition.
   * Optional and back-compatible — absent means no purpose declared. Design data,
   * authored via templates/designer; mirrors `SystemApp.description`/`AppTemplate.description`.
   */
  description?: string;
};

export type FieldType = "text" | "textarea" | "number" | "date" | "boolean" | "select";

/**
 * ADR-0019: Notes-style field computation modes, orthogonal to the datatype.
 * Absent = editable (user input). `computed` = server resolves the async-lane
 * formula and stamps the payload on EVERY payload write; `computed-once` =
 * resolve iff the stored value is absent (create/backfill), never overwrite;
 * `computed-for-display` = per-request resolution, never stored (the former
 * `type: "formula"`). Non-editable values are server-owned: client-supplied
 * values for them are discarded on every write path.
 */
export type FieldMode = "computed" | "computed-once" | "computed-for-display";

export type ExpressionRule = {
  expression: string;
  message?: string;
};

/**
 * Plugin/handler runtime (M7). Handlers are name-registered native code, NOT
 * replicated data: definitions reference a handler by name and the code ships
 * with the app. `pure` handlers are portable (run identically on client and
 * server, offline); `effect` handlers do server-only I/O. The manifest is the
 * portable source of truth that validation checks a reference against.
 */
export type HandlerKind = "pure" | "effect" | "agent";

export type HandlerManifestEntry = {
  name: string;
  kind: HandlerKind;
  description: string;
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
  /**
   * Per-field prose. ADR-0023 keeps this as the ONLY field-level description
   * channel (no parallel agent field) — it already carries operator-facing
   * guidance in shipped apps, so definition `description` stops at the
   * form/view/workflow/column/state/transition level and fields reuse `helpText`.
   */
  helpText?: string;
  options?: SelectOption[];
  source?: FieldSource;
  validate?: ExpressionRule[];
  /**
   * M7: name of a registered `pure` handler that derives this field's value from
   * the rest of the payload. Optional — absent on every M1–M6 form. A computed
   * field is read-only in the runtime and recomputed on both client and server.
   */
  compute?: string;
  /**
   * ADR-0019: the field's computation mode; absent means editable. Computed
   * modes require `formula` and reject user-input rules (`required`,
   * `defaultValue`, `validate`, `compute`).
   */
  mode?: FieldMode;
  /**
   * ADR-0014/0019: async-lane formula (may call `@DbColumn`/`@DbLookup`),
   * resolved server-side under the writer's/reader's ACL scope against the
   * local replica. Required by every computed mode, forbidden on editable
   * fields.
   */
  formula?: string;
  /**
   * M9: opt this field into full-text search. Optional and back-compatible —
   * when absent, text-ish fields (`text`/`textarea`/`select`) are searchable by
   * default and other types are not. Set `true` to index a non-text field or
   * `false` to exclude a text field. See `src/shared/search.ts`.
   */
  searchable?: boolean;
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
  /** ADR-0023: optional prose describing what this form/document type is for. */
  description?: string;
  sections?: FormSection[];
  fields: FormField[];
  /**
   * ADR-0015: principals ALWAYS added to a new document's `readers` beyond the
   * creator's own (e.g. `["group:finance"]` so finance can approve). Optional and
   * back-compatible — absent means creator-scoped. Keeps app-specific readers
   * policy in the template as data, not in base code.
   */
  defaultReaders?: string[];
};

export type ViewColumn = {
  field: string;
  label: string;
  /** ADR-0023: optional prose explaining what this column shows. */
  description?: string;
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
  /** ADR-0023: optional prose describing what this view lists and when to use it. */
  description?: string;
  columns: ViewColumn[];
  filters?: ViewFilter[];
  sort?: ViewSort[];
};

export type WorkflowState = {
  name: string;
  label: string;
  /**
   * ADR-0023: optional prose describing what this state means and who owes action
   * while a document sits in it — the highest-value description for an operator
   * agent deciding what to do next. Descriptive, not a gate.
   */
  description?: string;
  final?: boolean;
  /**
   * ADR-0018: who owes action while a document sits in this state. `responsible`
   * is a static principal; `responsibleFormula` (async lane, server-resolved) wins
   * when both are present. Stamped as the document's `assignee` on state ENTRY via
   * a transition — creation never stamps, so an initial-state declaration only
   * matters for re-entry transitions (e.g. revise → draft). Routing metadata, not
   * a gate: resolution failure never fails a transition.
   */
  responsible?: string;
  responsibleFormula?: string;
};

export type WorkflowTransition = {
  id: string;
  label: string;
  /**
   * ADR-0023: optional prose describing when to use this transition and what it
   * requires (mirrors the guard in words) — the branch points where an operator
   * agent most needs guidance. Descriptive, not a gate.
   */
  description?: string;
  /** Source state name, or "*" to allow from any non-final state. */
  from: string;
  to: string;
  /** M2 expression over { payload, doc, user, now }; must be truthy to allow. */
  guard?: string;
  /** Principal (such as group:finance) required to perform this transition. */
  requiredRole?: string;
  /**
   * M7: name of a registered `effect` handler run after the authoritative state
   * change on the online transition route. Optional — absent on every M1–M6
   * workflow. Effects are best-effort: they never block or revert the transition.
   */
  action?: string;
};

export type WorkflowDefinition = {
  _id: `workflow:${string}`;
  _rev?: string;
  kind: "workflow";
  appId: string;
  docType: string;
  title: string;
  /** ADR-0023: optional prose describing the lifecycle this workflow governs. */
  description?: string;
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
  /** ADR-0018: who the entered state assigned (absent when the entry cleared it). */
  assignee?: string;
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
  /**
   * ADR-0018: who owes the next action in the current state — routing metadata,
   * stamped ONLY by `applyTransition` on state entry (from the target state's
   * resolved/static responsibility), cleared on final states, never a gate.
   * Optional and absent until the first assigning transition, like the state trio.
   */
  assignee?: string;
  assignedAt?: string;
};

/**
 * Agent runtime (M8). Agents are replicated `agent:*` definitions that run a
 * registered `agent`-kind handler on a trigger. Execution is server-authoritative
 * and tick-driven (see docs/M8); the matching/scheduling logic is pure (in
 * `src/shared/agents.ts`) so it is portable and unit-testable.
 */
export type AgentTrigger =
  | { type: "schedule"; everyMs: number }
  | { type: "on-change"; docType?: string };

export type AgentDefinition = {
  _id: `agent:${string}`;
  _rev?: string;
  kind: "agent";
  appId: string;
  title: string;
  /** Name of a registered `agent`-kind handler (validated against the manifest). */
  handler: string;
  trigger: AgentTrigger;
  /** When false the agent is defined but never fires. Absent means enabled. */
  enabled?: boolean;
};

/** Durable record of one agent execution (`agentrun:*`). Runtime data, never templated. */
export type AgentRun = {
  _id: `agentrun:${string}`;
  _rev?: string;
  kind: "agentrun";
  appId: string;
  agentId: string;
  trigger: AgentTrigger["type"];
  /** Triggering document id + rev for on-change runs; absent for scheduled runs. */
  sourceId?: string;
  sourceRev?: string;
  startedAt: string;
  ok: boolean;
  detail: string;
  readers: string[];
};

/** Singleton checkpoint (`agent:state`): change-feed cursor + per-agent last-run stamps. Runtime data. */
export type AgentState = {
  _id: "agent:state";
  _rev?: string;
  kind: "agentstate";
  appId: string;
  lastSeq: string;
  lastRunAt: Record<string, string>;
};

export type AclRules = {
  _id: "acl:rules";
  _rev?: string;
  kind: "acl";
  appId: string;
  policy: string;
  entries: Array<{ principal: string; level: AccessLevel }>;
};

export type AccessLevel = "none" | "reader" | "author" | "editor" | "designer" | "manager";

export type PasswordParams = {
  algorithm: "scrypt";
  keyLength: number;
};

export type PersonDocument = {
  _id: `person:${string}`;
  _rev?: string;
  kind: "person";
  username: string;
  displayName: string;
  active: boolean;
  passwordHash: string;
  passwordSalt: string;
  passwordParams: PasswordParams;
  createdAt: string;
  updatedAt: string;
};

export type PublicPerson = {
  _id: `person:${string}`;
  kind: "person";
  username: string;
  displayName: string;
  active: boolean;
};

export type GroupDocument = {
  _id: `group:${string}`;
  _rev?: string;
  kind: "group";
  name: string;
  members: Array<`person:${string}`>;
  createdAt: string;
  updatedAt: string;
};

export type PublicGroup = {
  _id: `group:${string}`;
  kind: "group";
  name: string;
  members: Array<`person:${string}`>;
};

export type SessionDocument = {
  _id: `session:${string}`;
  _rev?: string;
  kind: "session";
  personId: `person:${string}`;
  createdAt: string;
  expiresAt: string;
};

export type SessionState = {
  authenticated: boolean;
  person?: PublicPerson;
  groups: Array<`group:${string}`>;
  principals: string[];
  accessLevel?: AccessLevel;
};

/**
 * Audit & retention (M10). Audit is server-authoritative and CDC-driven (the
 * server drains `_changes` and records a semantic change trail), mirroring the
 * M8 agent runtime. The policy is design data (replicated, templated like
 * `acl:rules`); the events and checkpoint are runtime data (never templated).
 * The pure decisions — should this change be audited? is this event expired? —
 * live in `src/shared/audit.ts`, exactly like the agent matching engine.
 */
export type AuditAction = "created" | "updated" | "deleted";

/** Policy (`audit:policy`): retention horizon + optional docType allowlist. Design data, templated. */
export type AuditPolicy = {
  _id: "audit:policy";
  _rev?: string;
  kind: "auditpolicy";
  appId: string;
  /** Events older than this many days are pruned on a tick. */
  retentionDays: number;
  /** When set, only these business docTypes are audited; absent means all. */
  docTypes?: string[];
};

/** Durable record of one document change (`auditevent:*`). Runtime data, never templated. */
export type AuditEvent = {
  _id: `auditevent:${string}`;
  _rev?: string;
  kind: "auditevent";
  appId: string;
  docId: string;
  docType: string;
  rev: string;
  action: AuditAction;
  actor: string;
  at: string;
  readers: string[];
};

/** Singleton checkpoint (`audit:state`): the `_changes` cursor for the audit drain. Runtime data. */
export type AuditState = {
  _id: "audit:state";
  _rev?: string;
  kind: "auditstate";
  appId: string;
  lastSeq: string;
};

export type PlatformConfig = {
  _id: "platform:config";
  _rev?: string;
  kind: "platformconfig";
  setupComplete: boolean;
  orgName?: string;
  domainName?: string;
  adminUser?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type AppInstall = {
  _id: `appinstall:${string}`;
  _rev?: string;
  kind: "appinstall";
  appId: string;
  title: string;
  database: string;
  /**
   * ADR-0023: optional purpose mirrored from the app's `app:config.description`
   * at install time, so `lotus_admin_list_apps` can show what each app is for
   * without opening every app's definitions. Optional/back-compatible.
   */
  description?: string;
  templateId?: string;
  installedAt: string;
  installedBy: string;
};

export type SystemApp = {
  appId: string;
  title: string;
  database: string;
  route: string;
  description: string;
};

/**
 * A bundled, appId-agnostic template the deployment ships (ADR-0016). Instantiated
 * as an app of the operator's choosing via `POST /api/platform/apps { fromTemplate }`.
 * Replaces the old "sample app" concept — a template is a design, not a fixed app.
 */
export type AppTemplate = {
  id: string;
  title: string;
  description: string;
};

export type PlatformState = {
  setupComplete: boolean;
  orgName?: string;
  domainName?: string;
  adminUser?: string;
  session: SessionState;
  systemApps: SystemApp[];
  installedApps: AppInstall[];
  availableTemplates: AppTemplate[];
};

export type DirectoryState = {
  people: PublicPerson[];
  groups: PublicGroup[];
  installedApps: AppInstall[];
};

export type AppAccessEntry = AclRules["entries"][number];

export type AppAccessState = {
  appId: string;
  entries: AppAccessEntry[];
  people: PublicPerson[];
  groups: PublicGroup[];
  levels: Exclude<AccessLevel, "none">[];
};

export type AppAccessUpdate = {
  entries: AppAccessEntry[];
};

export type DesignDocument =
  | AppConfig
  | FormDefinition
  | ViewDefinition
  | WorkflowDefinition
  | AgentDefinition
  | AclRules
  | AuditPolicy;

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
