import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Unit-only gate: no production build plugins, browser scripts or shared caches.
export default defineConfig({
  root: process.cwd(),
  cacheDir: path.resolve("scratch/wheel-unit-cache"),
  plugins: [react()],
  resolve: { alias: { "@": path.resolve("src") } },
  test: {
    environment: "jsdom", globals: true, setupFiles: "./src/test/setup.ts",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "src-tauri/tests/**/*.test.ts"],
    environmentMatchGlobs: [["src-tauri/tests/**", "node"]],
  },
});
