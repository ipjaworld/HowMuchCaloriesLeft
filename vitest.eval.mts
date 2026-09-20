import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Separate config for the golden-set accuracy run, so `pnpm test` stays fast
 * and never reaches the network. See `scripts/evalJev.eval.ts`.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["scripts/**/*.eval.ts"],
    testTimeout: 600_000,
    // The report is the point of this run; let it through unbuffered.
    disableConsoleIntercept: true,
    // One file, one case list — no need to fan out across workers.
    pool: "threads",
    maxWorkers: 1,
  },
});
