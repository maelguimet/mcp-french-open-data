import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"], env: { LOG_LEVEL: process.env.LOG_LEVEL ?? "error" } },
});
