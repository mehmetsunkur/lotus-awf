import type {
  AccessibleApp,
  AppAccessUpdate,
  PlatformState,
  SessionState,
  TemplateArtifact,
  WorkflowDefinition
} from "../shared/types";

/**
 * Session cookie name. Mirrors `SESSION_COOKIE` in `src/server/auth.ts`; duplicated here
 * because `src/mcp/**` must not import from `src/server/**` (layering boundary).
 */
const SESSION_COOKIE = "lotus_session";

export type LotusClientConfig = {
  apiUrl: string;
  username?: string;
  password?: string;
  /**
   * Pre-supplied Lotus session token (the opaque value carried in the `lotus_session`
   * cookie). When present the client replays it directly instead of logging in, which
   * lets the HTTP host bind an inbound Bearer token to a per-session client.
   */
  sessionToken?: string;
};

/** One document ref in a `GET /api/work-queue` app entry (ADR-0022 `?items=true`). */
export type WorkQueueItem = {
  _id: string;
  docType: string;
  state: string | null;
  responsibleAt: string | null;
  assignedAt: string | null;
};

/** Per-app slice of the cross-app work queue (ADR-0022). Apps below `reader` are absent. */
export type WorkQueueEntry = {
  appId: string;
  database: string;
  count: number;
  items?: WorkQueueItem[];
};

/** `GET /api/work-queue` response: the caller's assigned-and-readable work, per app. */
export type WorkQueueResult = {
  total: number;
  byApp: WorkQueueEntry[];
};

export class LotusApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly path: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(`${method} ${path} -> ${status}: ${JSON.stringify(body)}`);
  }
}

function normalizeApiUrl(apiUrl: string): string {
  return apiUrl.replace(/\/+$/, "");
}

function cookieFrom(headers: Headers): string | undefined {
  const maybeGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = maybeGetSetCookie.getSetCookie?.();
  const raw = setCookies?.[0] ?? headers.get("set-cookie") ?? undefined;
  return raw?.split(";")[0];
}

export class LotusClient {
  private readonly apiUrl: string;
  private readonly username?: string;
  private readonly password?: string;
  private cookie?: string;

  constructor(config: LotusClientConfig) {
    this.apiUrl = normalizeApiUrl(config.apiUrl);
    this.username = config.username;
    this.password = config.password;
    if (config.sessionToken) this.cookie = `${SESSION_COOKIE}=${config.sessionToken}`;
  }

  async login(): Promise<SessionState> {
    if (!this.username || !this.password) {
      throw new Error("LOTUS_USERNAME and LOTUS_PASSWORD are required for protected Lotus MCP tools");
    }
    const response = await fetch(`${this.apiUrl}/api/session/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: this.username, password: this.password })
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new LotusApiError("POST", "/api/session/login", response.status, json);
    const cookie = cookieFrom(response.headers);
    if (!cookie) throw new Error("Lotus login succeeded but did not return a session cookie");
    this.cookie = cookie;
    return json as SessionState;
  }

  async getSession(): Promise<SessionState> {
    if (!this.cookie) await this.login();
    return this.request<SessionState>("GET", "/api/session", undefined, false);
  }

  async listAccessibleApps(): Promise<AccessibleApp[]> {
    return this.request<AccessibleApp[]>("GET", "/api/apps");
  }

  async platformState(): Promise<PlatformState> {
    return this.request<PlatformState>("GET", "/api/platform/state");
  }

  async createApp(body: { appId: string; title: string; docType: string; docTypeTitle: string }): Promise<PlatformState> {
    return this.request<PlatformState>("POST", "/api/platform/apps", body);
  }

  async appAccess(appId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", `/api/apps/${encodeURIComponent(appId)}/access`);
  }

  async updateAppAccess(appId: string, body: AppAccessUpdate): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("PUT", `/api/apps/${encodeURIComponent(appId)}/access`, body);
  }

  async appDefinitions(appId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", `/api/apps/${encodeURIComponent(appId)}/definitions`);
  }

  /**
   * ADR-0023 Phase 2: lean, self-describing index of an app's definitions —
   * ids + kinds + titles + descriptions, no field/column/state bodies. The
   * operator reads this first to learn the app's shape, then pulls one full
   * definition with `getForm`/`getView`/`getWorkflow` as needed.
   */
  async appDefinitionsSummary(appId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", `/api/apps/${encodeURIComponent(appId)}/definitions/summary`);
  }

  async getForm(appId: string, docType: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/api/apps/${encodeURIComponent(appId)}/definitions/forms/${encodeURIComponent(docType)}`
    );
  }

  async getWorkflow(appId: string, docType: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/api/apps/${encodeURIComponent(appId)}/definitions/workflows/${encodeURIComponent(docType)}`
    );
  }

  async getView(appId: string, viewId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/api/apps/${encodeURIComponent(appId)}/definitions/views/${encodeURIComponent(viewId)}`
    );
  }

  async workflow(appId: string, docType: string): Promise<WorkflowDefinition> {
    const definitions = await this.appDefinitions(appId);
    const workflows = Array.isArray(definitions.workflows) ? definitions.workflows : [];
    const workflow = workflows.find((item): item is WorkflowDefinition =>
      Boolean(item && typeof item === "object" && (item as WorkflowDefinition)._id === `workflow:${docType}`)
    );
    if (!workflow) throw new Error(`workflow:${docType} was not found in app ${appId}`);
    return workflow;
  }

  async workflowScaffoldOptions(appId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", `/api/apps/${encodeURIComponent(appId)}/workflows/scaffold-options`);
  }

  async exportTemplate(appId: string, body: { version?: string; source?: string } = {}): Promise<TemplateArtifact> {
    return this.request<TemplateArtifact>("POST", `/api/apps/${encodeURIComponent(appId)}/templates/export`, body);
  }

  async diffTemplate(appId: string, template: TemplateArtifact): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", `/api/apps/${encodeURIComponent(appId)}/templates/diff`, { template });
  }

  async applyTemplate(appId: string, template: TemplateArtifact): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", `/api/apps/${encodeURIComponent(appId)}/templates/apply`, { template });
  }

  async createDocumentType(appId: string, body: { docType: string; title: string }): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", `/api/apps/${encodeURIComponent(appId)}/document-types`, body);
  }

  async scaffoldApprovalWorkflow(
    appId: string,
    body: { docType: string; approverPrincipal: string }
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", `/api/apps/${encodeURIComponent(appId)}/workflows/scaffold`, body);
  }

  async updateDefinition(appId: string, id: string, definition: unknown): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "PUT",
      `/api/apps/${encodeURIComponent(appId)}/definitions/${encodeURIComponent(id)}`,
      definition
    );
  }

  async listDocuments(appId: string, docType: string): Promise<Record<string, unknown>[]> {
    const query = new URLSearchParams({ docType });
    return this.request<Record<string, unknown>[]>("GET", `/api/apps/${encodeURIComponent(appId)}/documents?${query.toString()}`);
  }

  async queryView(appId: string, viewId: string, queryText?: string): Promise<Record<string, unknown>[]> {
    const query = new URLSearchParams();
    if (queryText) query.set("q", queryText);
    const suffix = query.size ? `?${query.toString()}` : "";
    return this.request<Record<string, unknown>[]>(
      "GET",
      `/api/apps/${encodeURIComponent(appId)}/views/${encodeURIComponent(viewId)}/documents${suffix}`
    );
  }

  /**
   * Cross-app work queue (ADR-0022): "does the authenticated caller have work anywhere?"
   * Caller-scoped by construction — the endpoint resolves identity from the session and
   * never accepts a principal, so this is a read adapter, not an app-scoped tool. The
   * operator uses it as its ADR-0021 poll gate in place of a single per-app inbox view.
   */
  async workQueue(options: { items?: boolean; actionable?: boolean } = {}): Promise<WorkQueueResult> {
    const query = new URLSearchParams();
    if (options.items) query.set("items", "true");
    if (options.actionable) query.set("actionable", "true");
    const suffix = query.size ? `?${query.toString()}` : "";
    return this.request<WorkQueueResult>("GET", `/api/work-queue${suffix}`);
  }

  /**
   * Fetch one readable document. Bare envelope by default (the shape internal
   * callers like the operator daemon rely on). ADR-0023 Phase 2: pass
   * `{ transitions: true }` to opt into the runtime affordances — the server then
   * wraps the response as `{ document, availableTransitions }`, the raw envelope
   * preserved untouched inside it. Only the workspace `get_document` tool sets it,
   * so an operator agent sees "what can I do now, and what does it mean" on open.
   */
  async getDocument(
    appId: string,
    id: string,
    opts: { transitions?: boolean } = {}
  ): Promise<Record<string, unknown>> {
    const suffix = opts.transitions ? "?include=transitions" : "";
    return this.request<Record<string, unknown>>(
      "GET",
      `/api/apps/${encodeURIComponent(appId)}/documents/${encodeURIComponent(id)}${suffix}`
    );
  }

  async createDocument(appId: string, body: { docType: string; payload: Record<string, unknown> }): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", `/api/apps/${encodeURIComponent(appId)}/documents`, body);
  }

  async updateDocument(appId: string, id: string, body: { payload: Record<string, unknown> }): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "PUT",
      `/api/apps/${encodeURIComponent(appId)}/documents/${encodeURIComponent(id)}`,
      body
    );
  }

  async transitionDocument(appId: string, id: string, transition: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "POST",
      `/api/apps/${encodeURIComponent(appId)}/documents/${encodeURIComponent(id)}/transition`,
      { transition }
    );
  }

  private async request<T>(method: string, path: string, body?: unknown, retryOnUnauthorized = true): Promise<T> {
    if (!this.cookie && path !== "/api/session") await this.login();
    const response = await fetch(`${this.apiUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(this.cookie ? { cookie: this.cookie } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const json = await response.json().catch(() => ({}));
    // Only auto-relogin when we hold credentials. A token-only (Bearer) client cannot log
    // in, so an expired/revoked token must surface as a real 401 the host can act on rather
    // than a misleading "credentials required" error.
    if (response.status === 401 && retryOnUnauthorized && this.username && this.password) {
      this.cookie = undefined;
      await this.login();
      return this.request<T>(method, path, body, false);
    }
    if (!response.ok) throw new LotusApiError(method, path, response.status, json);
    return json as T;
  }
}

export function lotusClientFromEnv(env = process.env): LotusClient {
  return new LotusClient({
    apiUrl: env.LOTUS_API_URL ?? "http://localhost:3001",
    username: env.LOTUS_USERNAME,
    password: env.LOTUS_PASSWORD
  });
}

/** Build a client that logs in with the supplied username/password (HTTP Basic surface). */
export function lotusClientWithCredentials(apiUrl: string, username: string, password: string): LotusClient {
  return new LotusClient({ apiUrl, username, password });
}

/** Build a client that replays an existing Lotus session token (HTTP Bearer surface). */
export function lotusClientWithToken(apiUrl: string, sessionToken: string): LotusClient {
  return new LotusClient({ apiUrl, sessionToken });
}
