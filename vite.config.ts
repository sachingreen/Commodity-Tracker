import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Pages serves the repo at /Commodity-Tracker/, so the built asset URLs need
// that prefix. Override with BASE_PATH=/ when serving from a custom domain.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/Commodity-Tracker/",
  plugins: [react()],
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 700 },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
