/// <reference types="vitest/config" />
import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // Two entry documents: the editor itself, and the headless caption render surface the
      // export job drives (INVARIANTS P9). render.html has to be a real build input or it would
      // work under `vite dev` and 404 in a built deployment.
      input: {
        main: resolve(__dirname, "index.html"),
        render: resolve(__dirname, "render.html"),
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
  },
});
