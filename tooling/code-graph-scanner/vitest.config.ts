import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tooling/code-graph-scanner/src/**/*.test.ts"]
  }
});
