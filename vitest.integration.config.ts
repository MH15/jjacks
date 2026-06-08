import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/integration/**/*.integration.test.ts"],
    exclude: ["repos/**"],
    testTimeout: 30_000
  }
});
