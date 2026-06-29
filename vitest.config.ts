import { defineConfig } from "vitest/config";

// Unit tests for the portable `src/shared` layer (handlers, validation,
// definition validation). Run-once (no watch) so it never trips the host
// `fs.inotify` limit the way `tsx watch` / Vite watch do — see CLAUDE.md.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.spec.ts"],
    environment: "node",
    coverage: {
      // `npm run test:unit -- --coverage` (or `test:coverage`). Reports the
      // logic layers the unit suite can reach in-process; the e2e/MCP layers
      // run the server in a child process and are measured separately.
      provider: "v8",
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      // `all` surfaces untested files as 0% instead of omitting them, so the
      // number reflects the whole source surface, not just files a spec touched.
      all: true,
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        // Process entrypoints / CLI servers — exercised by the e2e + MCP
        // Playwright suites (separate child process), not the unit suite.
        "src/client/main.tsx",
        "src/server/index.ts",
        "src/mcp/*-server.ts",
        // Type-only module: no executable lines to cover.
        "src/shared/types.ts"
      ]
    }
  }
});
