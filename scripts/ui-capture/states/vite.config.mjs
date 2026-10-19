// Build config of the primitive states gallery (`pnpm ui:states`). It renders
// the real src/components/ui primitives with the app's own index.css, so the
// gallery shows exactly what the app ships (no copies of the components).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..", "..");

export default defineConfig({
  root: here,
  base: "./",
  logLevel: "error",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.join(repo, "src") } },
  build: { outDir: process.env.UI_STATES_OUT ?? path.join(repo, ".ui-capture", "states", "dist"), emptyOutDir: true, chunkSizeWarningLimit: 99999 },
});
