import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

// Unit-test config. Tests run in the Node environment and resolve the same
// "@/*" -> "src/*" path alias used by the app/tsconfig. The hermetic tests mock
// Prisma and Auth.js so they need no database or network; the optional live-DB
// verification lives in scripts/verify-auth.ts instead.
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src")
    }
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: true
  }
});
