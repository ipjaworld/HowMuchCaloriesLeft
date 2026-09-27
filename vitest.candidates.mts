import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Runner for the MFDS candidate listing. Separate from `pnpm test`
 * and from the sync, because it calls the network and writes nothing.
 * See `scripts/mfdsCandidates.candidates.ts`.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["scripts/**/*.candidates.ts"],
    testTimeout: 600_000,
    disableConsoleIntercept: true,
    pool: "threads",
    maxWorkers: 1,
  },
});
