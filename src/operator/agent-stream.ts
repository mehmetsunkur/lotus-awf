export type AgentStreamDriver = "claude-code" | "codex";

export type ToolTranscriptEntry = {
  tool: string;
  input: string;
  server?: string;
  status?: string;
  error?: string;
};

export type TurnSummary = {
  schemaVersion: 1;
  driver: AgentStreamDriver;
  eventCount: number;
  parseErrorCount: number;
  turnStartedCount: number;
  turnCompletedCount: number;
  assistantMessageCount: number;
  toolCallCount: number;
  completedToolCallCount: number;
  failedToolCallCount: number;
  commandExecutionCount: number;
  providerRetryCount: number;
  rateLimitEventCount: number;
  mcpConnected: boolean;
  mcpServers: string[];
  advertisedTools: string[];
  lastEventType: string | null;
  lastEventSubtype: string | null;
  resultSubtype?: string;
  terminalReason?: string;
  finalResultSeen: boolean;
};

export type TimeoutDiagnostics = {
  schemaVersion: 1;
  timedOut: boolean;
  classification:
    | "not_timeout"
    | "no_agent_events"
    | "provider_retry"
    | "mcp_not_connected"
    | "mcp_connected_no_turn"
    | "agent_turn_without_tool"
    | "tool_loop_or_slow_tool"
    | "completed_without_final";
  reason: string;
  lastEventType: string | null;
  lastEventSubtype: string | null;
  providerRetryCount: number;
  mcpConnected: boolean;
  toolCallCount: number;
  completedToolCallCount: number;
  assistantMessageCount: number;
  stderrTail: string;
};

export type AgentStreamDiagnostics = {
  eventsJsonl: string;
  toolTranscriptJsonl: string;
  turnSummary: TurnSummary;
  timeoutDiagnostics: TimeoutDiagnostics;
  rawResult?: Record<string, unknown>;
};

type ParsedLine = {
  value: Record<string, unknown>;
  line: string;
};

export function summarizeAgentStream(options: {
  driver: AgentStreamDriver;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}): AgentStreamDiagnostics {
  const parsed = parseJsonLines(options.stdout);
  const events = parsed.values.map((entry) => entry.value);
  const toolTranscript = options.driver === "claude-code" ? claudeToolTranscript(events) : codexToolTranscript(events);
  const summary = options.driver === "claude-code" ? summarizeClaude(events, parsed.parseErrorCount) : summarizeCodex(events, parsed.parseErrorCount, options.stderr);
  const timeoutDiagnostics = classifyTimeout(summary, options.exitCode, options.stderr);
  return {
    eventsJsonl: parsed.values.map((entry) => entry.line).join("\n"),
    toolTranscriptJsonl: toolTranscript.map((entry) => JSON.stringify(entry)).join("\n"),
    turnSummary: summary,
    timeoutDiagnostics,
    rawResult: rawResultFor(options.driver, events)
  };
}

function parseJsonLines(text: string): { values: ParsedLine[]; parseErrorCount: number } {
  const values: ParsedLine[] = [];
  let parseErrorCount = 0;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("{")) continue;
    try {
      const value = JSON.parse(line) as unknown;
      if (isRecord(value)) values.push({ value, line: JSON.stringify(value) });
    } catch {
      parseErrorCount += 1;
    }
  }
  return { values, parseErrorCount };
}

function summarizeClaude(events: Array<Record<string, unknown>>, parseErrorCount: number): TurnSummary {
  const init = events.find((event) => event.type === "system" && event.subtype === "init");
  const result = [...events].reverse().find((event) => event.type === "result");
  const mcpServers = Array.isArray(init?.mcp_servers)
    ? init.mcp_servers.flatMap((server) => (isRecord(server) && typeof server.name === "string" ? [server.name] : []))
    : [];
  const advertisedTools = Array.isArray(init?.tools) ? init.tools.filter((tool): tool is string => typeof tool === "string") : [];
  const last = events.at(-1);
  const toolTranscript = claudeToolTranscript(events);
  return {
    schemaVersion: 1,
    driver: "claude-code",
    eventCount: events.length,
    parseErrorCount,
    turnStartedCount: 0,
    turnCompletedCount: typeof result?.num_turns === "number" ? result.num_turns : result ? 1 : 0,
    assistantMessageCount: events.filter((event) => event.type === "assistant").length,
    toolCallCount: toolTranscript.length,
    completedToolCallCount: toolTranscript.filter((entry) => entry.status !== "failed").length,
    failedToolCallCount: toolTranscript.filter((entry) => entry.status === "failed").length,
    commandExecutionCount: 0,
    providerRetryCount: events.filter((event) => event.type === "system" && event.subtype === "api_retry").length,
    rateLimitEventCount: events.filter((event) => event.type === "rate_limit_event").length,
    mcpConnected: Array.isArray(init?.mcp_servers) && init.mcp_servers.some((server) => isRecord(server) && server.status === "connected"),
    mcpServers,
    advertisedTools,
    lastEventType: typeof last?.type === "string" ? last.type : null,
    lastEventSubtype: typeof last?.subtype === "string" ? last.subtype : null,
    resultSubtype: typeof result?.subtype === "string" ? result.subtype : undefined,
    terminalReason: typeof result?.terminal_reason === "string" ? result.terminal_reason : undefined,
    finalResultSeen: Boolean(result)
  };
}

function summarizeCodex(events: Array<Record<string, unknown>>, parseErrorCount: number, stderr: string): TurnSummary {
  const last = events.at(-1);
  const mcpCalls = codexToolTranscript(events).filter((entry) => entry.tool.startsWith("mcp:"));
  const commandExecutions = events.filter((event) => isCodexItemEvent(event, "command_execution"));
  const jsonReconnects = events.filter((event) => event.type === "error" && typeof event.message === "string" && event.message.includes("Reconnecting...")).length;
  return {
    schemaVersion: 1,
    driver: "codex",
    eventCount: events.length,
    parseErrorCount,
    turnStartedCount: events.filter((event) => event.type === "turn.started").length,
    turnCompletedCount: events.filter((event) => event.type === "turn.completed").length,
    assistantMessageCount: events.filter((event) => isCodexItemEvent(event, "agent_message")).length,
    toolCallCount: mcpCalls.length,
    completedToolCallCount: mcpCalls.filter((entry) => entry.status === "completed").length,
    failedToolCallCount: mcpCalls.filter((entry) => entry.status === "failed").length,
    commandExecutionCount: commandExecutions.length,
    providerRetryCount: jsonReconnects + countMatches(stderr, /ERROR: Reconnecting\.\.\. \d+\/\d+/g),
    rateLimitEventCount: 0,
    mcpConnected: mcpCalls.length > 0,
    mcpServers: Array.from(new Set(mcpCalls.flatMap((entry) => (entry.server ? [entry.server] : [])))),
    advertisedTools: [],
    lastEventType: typeof last?.type === "string" ? last.type : null,
    lastEventSubtype: codexItemType(last),
    finalResultSeen: events.some((event) => event.type === "turn.completed")
  };
}

function claudeToolTranscript(events: Array<Record<string, unknown>>): ToolTranscriptEntry[] {
  return events
    .filter((entry) => entry.type === "assistant")
    .flatMap((entry) => {
      const content = isRecord(entry.message) && Array.isArray(entry.message.content) ? entry.message.content : [];
      return content
        .filter((block): block is Record<string, unknown> => isRecord(block) && block.type === "tool_use")
        .map((block) => ({
          tool: String(block.name ?? ""),
          input: JSON.stringify(block.input ?? {}).slice(0, 2000),
          status: "started"
        }));
    });
}

function codexToolTranscript(events: Array<Record<string, unknown>>): ToolTranscriptEntry[] {
  const byId = new Map<string, ToolTranscriptEntry>();
  for (const event of events) {
    if (!isRecord(event.item)) continue;
    const id = typeof event.item.id === "string" ? event.item.id : `${String(event.item.type ?? "item")}:${byId.size}`;
    if (event.item.type === "mcp_tool_call") {
      const error = event.item.error === null || event.item.error === undefined ? undefined : JSON.stringify(event.item.error).slice(0, 1000);
      const status = typeof event.item.status === "string" ? event.item.status : undefined;
      byId.set(id, {
        tool: `mcp:${String(event.item.tool ?? "")}`,
        server: typeof event.item.server === "string" ? event.item.server : undefined,
        input: JSON.stringify(event.item.arguments ?? {}).slice(0, 2000),
        status: error ? "failed" : status,
        error
      });
      continue;
    }
    if (event.item.type === "command_execution") {
      byId.set(id, {
        tool: "command_execution",
        input: String(event.item.command ?? "").slice(0, 2000),
        status: typeof event.item.status === "string" ? event.item.status : undefined
      });
    }
  }
  return Array.from(byId.values());
}

function classifyTimeout(summary: TurnSummary, exitCode: number | null, stderr: string): TimeoutDiagnostics {
  const timedOut = exitCode === 124;
  if (!timedOut) {
    return timeoutDiagnostics(summary, timedOut, "not_timeout", "Agent run did not end through the container timeout.", stderr);
  }
  if (summary.providerRetryCount > 0) {
    return timeoutDiagnostics(summary, timedOut, "provider_retry", "Provider/API retry events or reconnect messages were captured before timeout.", stderr);
  }
  if (summary.eventCount === 0) {
    return timeoutDiagnostics(summary, timedOut, "no_agent_events", "No structured agent events were captured before timeout.", stderr);
  }
  if (!summary.mcpConnected && summary.toolCallCount === 0) {
    return timeoutDiagnostics(summary, timedOut, "mcp_not_connected", "No connected MCP server or MCP tool call was observed before timeout.", stderr);
  }
  if (summary.mcpConnected && summary.turnStartedCount === 0 && summary.assistantMessageCount === 0) {
    return timeoutDiagnostics(summary, timedOut, "mcp_connected_no_turn", "MCP connected, but no assistant turn was observed before timeout.", stderr);
  }
  if (summary.toolCallCount === 0) {
    return timeoutDiagnostics(summary, timedOut, "agent_turn_without_tool", "Agent produced turn activity but no tool call before timeout.", stderr);
  }
  if (!summary.finalResultSeen) {
    return timeoutDiagnostics(summary, timedOut, "tool_loop_or_slow_tool", "Tool calls were observed, but no final result was captured before timeout.", stderr);
  }
  return timeoutDiagnostics(summary, timedOut, "completed_without_final", "A completed turn/result was observed, but the runner timed out before finalization.", stderr);
}

function timeoutDiagnostics(
  summary: TurnSummary,
  timedOut: boolean,
  classification: TimeoutDiagnostics["classification"],
  reason: string,
  stderr: string
): TimeoutDiagnostics {
  return {
    schemaVersion: 1,
    timedOut,
    classification,
    reason,
    lastEventType: summary.lastEventType,
    lastEventSubtype: summary.lastEventSubtype,
    providerRetryCount: summary.providerRetryCount,
    mcpConnected: summary.mcpConnected,
    toolCallCount: summary.toolCallCount,
    completedToolCallCount: summary.completedToolCallCount,
    assistantMessageCount: summary.assistantMessageCount,
    stderrTail: stderr.slice(-2000)
  };
}

function rawResultFor(driver: AgentStreamDriver, events: Array<Record<string, unknown>>): Record<string, unknown> | undefined {
  if (driver === "claude-code") {
    return [...events].reverse().find((event) => event.type === "result");
  }
  const completed = [...events].reverse().find((event) => event.type === "turn.completed");
  const failed = [...events].reverse().find((event) => event.type === "turn.failed");
  if (completed) return { turnCompleted: completed };
  if (failed) return { turnFailed: failed };
  return undefined;
}

function isCodexItemEvent(event: Record<string, unknown> | undefined, itemType: string): boolean {
  return isRecord(event?.item) && event.item.type === itemType;
}

function codexItemType(event: Record<string, unknown> | undefined): string | null {
  return isRecord(event?.item) && typeof event.item.type === "string" ? event.item.type : null;
}

function countMatches(text: string, pattern: RegExp): number {
  return Array.from(text.matchAll(pattern)).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
