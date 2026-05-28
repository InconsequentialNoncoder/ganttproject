import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Client SPA build. Output goes to dist/client, which the Worker serves as
// static assets (see wrangler.jsonc). Tests use vitest.config.ts instead.
export default defineConfig({
  root: "client",
  plugins: [react()],
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
  },
});
