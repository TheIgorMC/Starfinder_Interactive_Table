import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// galaxy-core/ (sibling of frontend/) is the shared galaxy library — the
// same generators/layout code the backend and the MCP tools run.
const galaxyCore = fileURLToPath(new URL("../galaxy-core", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@galaxy-core": galaxyCore } },
  server: {
    fs: { allow: [".", galaxyCore] },
    proxy: {
      "/api": "http://localhost:3000",
      "/ws": { target: "ws://localhost:3000", ws: true },
    },
  },
});
