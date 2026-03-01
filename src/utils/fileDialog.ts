/**
 * Cross-platform file dialog utilities.
 *
 * In Tauri mode, delegates to `@tauri-apps/plugin-dialog`.
 * In web mode, uses browser-native Blob download and <input type="file">.
 */

import { isTauri } from "@/utils/platform";

interface SaveDialogOptions {
  filters?: { name: string; extensions: string[] }[];
  defaultPath?: string;
}

interface OpenDialogOptions {
  filters?: { name: string; extensions: string[] }[];
  multiple?: boolean;
  directory?: boolean;
  title?: string;
}

/**
 * Show a "Save file" dialog and write content.
 *
 * - Tauri: shows native save dialog and writes the file via IPC.
 * - Web: triggers a browser download with the given content.
 *
 * Returns `true` if the save completed (web always returns true).
 */
export async function saveFileDialog(
  content: string,
  options?: SaveDialogOptions,
): Promise<boolean> {
  if (isTauri()) {
    const dialogModule = await import("@tauri-apps/plugin-dialog");
    const filePath = await dialogModule.save(options);
    if (!filePath) return false;

    const { api } = await import("@/services/api");
    await api("write_text_file", { path: filePath, content });
    return true;
  }

  // Web fallback: Blob download
  const filename = options?.defaultPath ?? "download.json";
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}

/**
 * Show an "Open file" dialog and read a single text file.
 *
 * - Tauri: shows native open dialog, reads via IPC.
 * - Web: shows browser file picker, reads via FileReader.
 *
 * Returns the file content string, or `null` if cancelled.
 */
export async function openFileDialog(
  options?: OpenDialogOptions,
): Promise<string | null> {
  if (isTauri()) {
    const dialogModule = await import("@tauri-apps/plugin-dialog");
    const filePath = await dialogModule.open({
      filters: options?.filters,
      multiple: false,
    });
    if (!filePath || typeof filePath !== "string") return null;

    const { api } = await import("@/services/api");
    return api<string>("read_text_file", { path: filePath });
  }

  // Web fallback: <input type="file">
  return new Promise<string | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    const exts = options?.filters?.flatMap((f) => f.extensions.map((e) => `.${e}`));
    if (exts?.length) {
      input.accept = exts.join(",");
    }
    let resolved = false;
    const safeResolve = (val: string | null) => {
      if (!resolved) {
        resolved = true;
        window.removeEventListener("focus", focusHandler);
        resolve(val);
      }
    };

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        safeResolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => safeResolve(reader.result as string);
      reader.onerror = () => safeResolve(null);
      reader.readAsText(file);
    };
    // User cancelled — oncancel (Chrome 113+, Firefox 124+, Safari 16.4+)
    input.oncancel = () => safeResolve(null);
    // Fallback for older browsers: detect cancel via window focus
    const focusHandler = () => {
      setTimeout(() => {
        if (!input.files?.length) safeResolve(null);
      }, 500);
    };
    window.addEventListener("focus", focusHandler, { once: true });
    input.click();
  });
}
