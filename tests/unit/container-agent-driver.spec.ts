import { describe, expect, it } from "vitest";
import { summarizeAgentStream } from "../../src/operator/agent-stream";
import { CLAUDE_CONTAINER_DISALLOWED_TOOLS, checkAgentIsolationPolicy } from "../../src/operator/container-agent-driver";

describe("container agent isolation policy", () => {
  it("allows ordinary MCP transcript text", () => {
    expect(checkAgentIsolationPolicy("mcp: lotus-workspace/lotus_workspace_get_session completed").ok).toBe(true);
  });

  it("flags repo, fixture, direct CouchDB, and direct API leakage", () => {
    const result = checkAgentIsolationPolicy(
      [
        "/workspace/sunkur-ai/lotus-notes/src/operator/agent-driver.ts",
        "tests/mcp/agent/fixtures/field-services/template.json",
        "http://admin:password@server-couchdb:5984/_all_dbs",
        "GET /api/apps/agent-field-services/documents",
        "GET /api/work-queue?items=true"
      ].join("\n")
    );

    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        "repo workspace path",
        "agent fixture path",
        "direct CouchDB URL",
        "direct Lotus app API route",
        "direct work-queue API route"
      ])
    );
  });

  it("blocks Claude built-ins that would bypass the workspace MCP boundary", () => {
    expect(CLAUDE_CONTAINER_DISALLOWED_TOOLS).toEqual(
      expect.arrayContaining([
        "Bash",
        "Read",
        "Write",
        "Edit",
        "Glob",
        "Grep",
        "WebFetch",
        "WebSearch",
        "Task",
        "EnterWorktree",
        "Workflow",
        "TaskCreate",
        "SendMessage"
      ])
    );
  });
});

describe("container agent stream diagnostics", () => {
  it("summarizes Codex JSONL MCP tool turns", () => {
    const stdout = [
      { type: "thread.started", thread_id: "thread-1" },
      { type: "turn.started" },
      { type: "item.completed", item: { id: "item_0", type: "agent_message", text: "I will check the session." } },
      {
        type: "item.started",
        item: {
          id: "item_1",
          type: "mcp_tool_call",
          server: "lotus-workspace",
          tool: "lotus_workspace_get_session",
          arguments: {},
          result: null,
          error: null,
          status: "in_progress"
        }
      },
      {
        type: "item.completed",
        item: {
          id: "item_1",
          type: "mcp_tool_call",
          server: "lotus-workspace",
          tool: "lotus_workspace_get_session",
          arguments: {},
          result: { content: [{ type: "text", text: "{\"authenticated\":true}" }] },
          error: null,
          status: "completed"
        }
      },
      { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } }
    ]
      .map((event) => JSON.stringify(event))
      .join("\n");

    const diagnostics = summarizeAgentStream({ driver: "codex", stdout, stderr: "", exitCode: 0 });

    expect(diagnostics.turnSummary).toMatchObject({
      driver: "codex",
      eventCount: 6,
      turnStartedCount: 1,
      turnCompletedCount: 1,
      assistantMessageCount: 1,
      toolCallCount: 1,
      completedToolCallCount: 1,
      mcpConnected: true,
      mcpServers: ["lotus-workspace"],
      finalResultSeen: true
    });
    expect(diagnostics.toolTranscriptJsonl).toContain("lotus_workspace_get_session");
    expect(diagnostics.timeoutDiagnostics.classification).toBe("not_timeout");
  });

  it("classifies a Codex timeout with reconnect noise as provider retry", () => {
    const diagnostics = summarizeAgentStream({
      driver: "codex",
      stdout: [
        { type: "thread.started", thread_id: "thread-1" },
        { type: "turn.started" },
        { type: "error", message: "Reconnecting... 1/5 (stream disconnected before completion)" },
        { type: "error", message: "Reconnecting... 2/5 (stream disconnected before completion)" }
      ]
        .map((event) => JSON.stringify(event))
        .join("\n"),
      stderr: "ERROR: Reconnecting... 1/5\nERROR: Reconnecting... 2/5\ncontainer agent did not finish before timeout\n",
      exitCode: 124
    });

    expect(diagnostics.turnSummary.providerRetryCount).toBe(4);
    expect(diagnostics.timeoutDiagnostics).toMatchObject({
      timedOut: true,
      classification: "provider_retry",
      mcpConnected: false
    });
  });

  it("summarizes Claude stream-json init, tool use, retries, and result", () => {
    const stdout = [
      {
        type: "system",
        subtype: "init",
        tools: ["mcp__lotus-workspace__lotus_workspace_get_session"],
        mcp_servers: [{ name: "lotus-workspace", status: "connected" }]
      },
      { type: "system", subtype: "api_retry", attempt: 1 },
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "mcp__lotus-workspace__lotus_workspace_get_session",
              input: {}
            }
          ]
        }
      },
      { type: "result", subtype: "success", is_error: false, num_turns: 1, result: "done" }
    ]
      .map((event) => JSON.stringify(event))
      .join("\n");

    const diagnostics = summarizeAgentStream({ driver: "claude-code", stdout, stderr: "", exitCode: 0 });

    expect(diagnostics.turnSummary).toMatchObject({
      driver: "claude-code",
      eventCount: 4,
      turnCompletedCount: 1,
      assistantMessageCount: 1,
      toolCallCount: 1,
      providerRetryCount: 1,
      mcpConnected: true,
      resultSubtype: "success",
      finalResultSeen: true
    });
    expect(diagnostics.toolTranscriptJsonl).toContain("mcp__lotus-workspace__lotus_workspace_get_session");
  });
});
