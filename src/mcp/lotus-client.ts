import type {
  PlatformState,
  SessionState,
  TemplateArtifact,
  WorkflowDefinition
} from "../shared/types";

export type LotusClientConfig = {
  apiUrl: string;
  username?: string;
  password?: string;
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
    return this.request<SessionState>("GET", "/api/session", undefined, false);
  }

  async platformState(): Promise<PlatformState> {
    return this.request<PlatformState>("GET", "/api/platform/state");
  }

  async appDefinitions(appId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", `/api/apps/${encodeURIComponent(appId)}/definitions`);
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
    if (response.status === 401 && retryOnUnauthorized) {
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
