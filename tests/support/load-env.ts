import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Side-effect module: load a local `.env` (if present) into process.env so
 * `npm run test:*` picks up the agent-suite vars (LOTUS_AGENT_CLAUDE_* /
 * LOTUS_AGENT_CODEX_*, and the inherited ANTHROPIC_* fallbacks) without exporting
 * them by hand. Imported at the top of the Playwright configs, it runs in the
 * runner's main process before workers fork, so workers inherit the values.
 *
 * Node's `loadEnvFile` does NOT override variables that are already set, so an
 * inline `VAR=... npm run` and the Claude Code runtime's injected vars still win;
 * `.env` only fills in what's missing.
 */
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch {
    // A malformed .env shouldn't break the run — fall back to the real environment.
  }
}
