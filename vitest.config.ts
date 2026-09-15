import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@teams-audio-join/shared": `${root}packages/shared/src/index.ts`,
      "@teams-audio-join/store": `${root}packages/store/src/index.ts`,
      "@teams-audio-join/orchestrator": `${root}packages/orchestrator/src/index.ts`,
      "@teams-audio-join/graph": `${root}packages/graph/src/index.ts`,
      "@teams-audio-join/summarizer": `${root}packages/summarizer/src/index.ts`,
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    environment: "node",
  },
});
