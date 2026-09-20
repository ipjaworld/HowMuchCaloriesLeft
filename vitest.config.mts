import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Node, not jsdom: the repositories take a storage object, so the one
    // browser API this project uses is injected rather than emulated.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
