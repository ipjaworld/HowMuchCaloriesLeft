import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Runner for the offline MFDS dataset sync. Separate from both `pnpm test`
 * and the golden-set eval, because it writes a file and calls the network.
 * See `scripts/syncMfdsDataset.sync.ts`.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["scripts/**/*.sync.ts"],
    testTimeout: 600_000,
    disableConsoleIntercept: true,
    pool: "threads",
    maxWorkers: 1,
  },
});
