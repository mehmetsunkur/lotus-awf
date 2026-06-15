import { defineConfig } from "vitest/config";

// Unit tests for the portable `src/shared` layer (handlers, validation,
// definition validation). Run-once (no watch) so it never trips the host
// `fs.inotify` limit the way `tsx watch` / Vite watch do — see CLAUDE.md.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.spec.ts"],
    environment: "node"
  }
});
