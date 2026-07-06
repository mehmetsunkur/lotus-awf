import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { AgentOperator, type OperatorConfig } from "./operator";
import { ClaudeCodeDriver, CodexDriver } from "./agent-driver";

/**
 * `npm run agent-operator` — the M28 daemon entry point (ADR-0021). All configuration
 * is environment-only, mirroring the MCP HTTP host; driver credentials use the same
 * LOTUS_AGENT_<DRIVER>_* contract as the test suites. See docs/M28/02-operator-contract.md.
 */
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function main(): void {
  const config: OperatorConfig = {
    apiUrl: required("LOTUS_OPERATOR_API_URL"),
    username: process.env.LOTUS_OPERATOR_USERNAME?.trim() || "agent-operator",
    password: required("LOTUS_OPERATOR_PASSWORD"),
    personaPassword: required("LOTUS_OPERATOR_PERSONA_PASSWORD"),
    mcpWorkspaceUrl: required("LOTUS_OPERATOR_MCP_WORKSPACE_URL"),
    appId: process.env.LOTUS_OPERATOR_APP_ID?.trim() || "agent-ops",
    orgAppId: process.env.LOTUS_OPERATOR_ORG_APP_ID?.trim() || "org",
    kbAppId: process.env.LOTUS_OPERATOR_KB_APP_ID?.trim() || "kb",
    companyName: process.env.LOTUS_OPERATOR_COMPANY_NAME?.trim() || "the company",
    pollMs: Number(process.env.LOTUS_OPERATOR_POLL_MS ?? 15000),
    maxSessionsPerDay: Number(process.env.LOTUS_OPERATOR_MAX_SESSIONS_PER_DAY ?? 20),
    diagnosticsRoot: resolve(process.env.LOTUS_OPERATOR_DIAGNOSTICS_DIR ?? "agent-operator-diagnostics")
  };
  mkdirSync(config.diagnosticsRoot, { recursive: true });

  const operator = new AgentOperator(config, [new ClaudeCodeDriver(), new CodexDriver()]);
  const stop = () => {
    console.log("[agent-operator] stop requested; finishing the in-flight session");
    operator.stop();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  operator.run().catch((error) => {
    console.error("[agent-operator] fatal:", error);
    process.exit(1);
  });
}

main();
