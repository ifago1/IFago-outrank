import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration tests do schema migration + truncate — give them headroom.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
