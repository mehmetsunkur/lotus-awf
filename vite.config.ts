import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // Under e2e we run without file watching to stay within the host's
    // fs.inotify.max_user_instances budget (watch mode is not needed for tests).
    watch: process.env.E2E ? null : undefined,
    proxy: {
      "/api": "http://localhost:3001"
    }
  }
});
