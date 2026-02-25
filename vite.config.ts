/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// import { visualizer } from "rollup-plugin-visualizer";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [
    react(),
    tailwindcss(),
    // Bundle analyzer disabled - uncomment to enable
    // visualizer({
    //   open: true,
    //   filename: "dist/bundle-stats.html",
    //   gzipSize: true,
    //   brotliSize: true,
    // }),
  ].filter(Boolean),

  build: {
    // Increase chunk size warning limit (default is 500KB)
    chunkSizeWarningLimit: 1000,

    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // === i18n locale data (split by language to avoid one mega-chunk) ===
          if (id.includes("i18n/locales/en/")) return "i18n-en";
          if (id.includes("i18n/locales/ko/")) return "i18n-ko";
          if (id.includes("i18n/locales/ja/")) return "i18n-ja";
          if (id.includes("i18n/locales/zh-CN/")) return "i18n-zh-cn";
          if (id.includes("i18n/locales/zh-TW/")) return "i18n-zh-tw";

          // i18n runtime libraries
          if (
            id.includes("i18next") ||
            id.includes("react-i18next") ||
            id.includes("i18next-browser-languagedetector")
          ) {
            return "i18n-vendor";
          }

          // Core React bundle
          if (id.includes("react") || id.includes("react-dom")) {
            return "react-vendor";
          }

          // UI libraries bundle
          if (
            id.includes("@headlessui") ||
            id.includes("@radix-ui") ||
            id.includes("tailwind-merge") ||
            id.includes("clsx") ||
            id.includes("class-variance-authority") ||
            id.includes("cmdk") ||
            id.includes("sonner")
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

          // Search library
          if (id.includes("flexsearch")) {
            return "search-vendor";
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

          // Scrollbar + misc vendor
          if (id.includes("overlayscrollbars")) {
            return "scrollbar-vendor";
          }

          // ANSI terminal rendering
          if (id.includes("ansi-to-html")) {
            return "ansi-vendor";
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
