import { defineConfig } from "vitest/config";

// The web test suite covers the PURE view-model / sanitization logic of the A8 UI
// (no DOM): honest state derivation, sequence ordering and safe-rendering. React
// components are validated by `tsc` (typecheck) and `vite build`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
});
