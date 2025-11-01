/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    // Add bundle analyzer when ANALYZE env var is set
    mode === "production" &&
      visualizer({
        open: true,
        filename: "dist/bundle-stats.html",
        gzipSize: true,
        brotliSize: true,
      }),
  ].filter(Boolean),

  build: {
    // Increase chunk size warning limit (default is 500KB)
    chunkSizeWarningLimit: 1000,

    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Core React bundle
          if (id.includes("react") || id.includes("react-dom")) {
            return "react-vendor";
          }

          // UI libraries bundle
          if (
            id.includes("@headlessui") ||
            id.includes("@radix-ui") ||
            id.includes("tailwind-merge") ||
            id.includes("clsx")
          ) {
            return "ui-vendor";
          }

          // Icons bundle (separate lucide and heroicons)
          if (id.includes("lucide-react")) {
            return "lucide-icons";
          }
          if (id.includes("@heroicons")) {
            return "hero-icons";
          }

          // Syntax highlighting bundle (heavy)
          if (
            id.includes("react-syntax-highlighter") ||
            id.includes("prismjs") ||
            id.includes("refractor") ||
            id.includes("prism-react-renderer")
          ) {
            return "syntax-highlighting";
          }

          // Diff viewer bundle
          if (id.includes("react-diff-viewer") || id.includes("diff")) {
            return "diff-viewer";
          }

          // Markdown bundle
          if (
            id.includes("react-markdown") ||
            id.includes("remark") ||
            id.includes("mdast") ||
            id.includes("micromark") ||
            id.includes("unist")
          ) {
            return "markdown";
          }

          // Data/state management bundle
          if (
            id.includes("zustand") ||
            id.includes("@tanstack/react-query") ||
            id.includes("dexie") ||
            id.includes("minisearch")
          ) {
            return "data-vendor";
          }

          // Tauri specific bundle
          if (id.includes("@tauri-apps")) {
            return "tauri";
          }

          // Virtual scrolling bundle
          if (
            id.includes("react-window") ||
            id.includes("@tanstack/react-virtual")
          ) {
            return "virtual-scroll";
          }
        },
      },
    },
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Optimize dependencies pre-bundling
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-markdown",
      "react-syntax-highlighter",
      "lucide-react",
    ],
    exclude: [
      "@tauri-apps/api",
      "@tauri-apps/plugin-dialog",
      "@tauri-apps/plugin-store",
    ],
  },

  // Test configuration
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "src-tauri/tests/**/*.test.ts",
    ],
    environmentMatchGlobs: [
      // Node environment for file system tests
      ["src-tauri/tests/**", "node"],
    ],
  },
}));
