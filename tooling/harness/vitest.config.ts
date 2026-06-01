import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tooling/harness/src/scenarios/**/*.scenario.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    sequence: {
      concurrent: false
    }
  }
});
