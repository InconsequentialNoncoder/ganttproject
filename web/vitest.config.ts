import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so the client build settings (root: "client")
// don't affect test discovery. All tests run in the default Node environment.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
