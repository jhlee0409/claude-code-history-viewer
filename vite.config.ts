/// <reference types="vitest" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// import { visualizer } from "rollup-plugin-visualizer";
import tailwindcss from "@tailwindcss/vite";
import fs from "fs";
import path from "path";

/**
 * Ship the SIL OFL 1.1 notices of the bundled fonts with the build. Vite only
 * emits the woff2 files fonts.css references, so each
 * src/assets/fonts/<family>/OFL.txt is emitted to fonts/<family>/OFL.txt in
 * the dist that Tauri packages and the WebUI serves.
 */
function fontLicenses(): Plugin {
  const fontsDir = path.resolve(__dirname, "src/assets/fonts");
  return {
    name: "cchv:font-licenses",
    apply: "build",
    generateBundle() {
      for (const family of fs.readdirSync(fontsDir)) {
        const license = path.join(fontsDir, family, "OFL.txt");
        if (!fs.existsSync(license)) continue;
        this.emitFile({
          type: "asset",
          fileName: `fonts/${family}/OFL.txt`,
          source: fs.readFileSync(license),
        });
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => {
  const useMock = process.env.VITE_MOCK === "1";
  const mockPlugin = useMock
    ? (await import("./dev-mock-server")).mockApiPlugin()
    : null;

  return {
    base: "./",
    // The search worker is created with `{ type: "module" }`, and its
    // dependency graph (flexsearch) contains dynamic imports that rollup on
    // macOS treats as code-splitting — which the default `iife` worker format
    // rejects. ES output matches the instantiation and works everywhere.
    worker: {
      format: "es" as const,
    },
    plugins: [
      react(),
      tailwindcss(),
      fontLicenses(),
      // Mock API plugin for browser testing (VITE_MOCK=1 pnpm dev)
      mockPlugin,
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
          manualChunks: (id: string) => {
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
            if (id.includes("node_modules/diff/")) {
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
        "scripts/**/*.test.mjs",
      ],
      environmentMatchGlobs: [
        // Node environment for file system tests
        ["src-tauri/tests/**", "node"],
        ["scripts/**", "node"],
      ],
    },

    // Prevent Vite from watching Tauri src directory
    // Ref: https://tauri.app/start/create-project/
    server: {
      watch: {
        ignored: ["**/src-tauri/target/**"],
      },
    },
  };
});
