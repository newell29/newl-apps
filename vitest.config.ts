import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

// Unit-test config. Tests run in the Node environment and resolve the same
// "@/*" -> "src/*" path alias used by the app/tsconfig. The hermetic tests mock
// Prisma and Auth.js so they need no database or network; the optional live-DB
// verification lives in scripts/verify-auth.ts instead.
export default defineConfig({
  // Next.js supplies the automatic React JSX runtime during application
  // compilation. Mirror that transform when Vitest imports server-rendered
  // `.tsx` pages directly so those modules do not depend on a global `React`.
  esbuild: {
    jsx: "automatic"
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src")
    }
  },
  test: {
    environment: "node",
    // `.test.tsx` files are supported so UI-oriented suites can import the
    // module/component sources; the environment is still Node (the Customer
    // Profile UI suite renders server pages with react-dom/server static
    // markup, not a browser DOM library).
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    globals: true
  }
});
