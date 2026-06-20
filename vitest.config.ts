import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    // Point a .env.test at a THROWAWAY Supabase project with the schema + Novara
    // seed loaded. Never run against production.
    env: {},
  },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
