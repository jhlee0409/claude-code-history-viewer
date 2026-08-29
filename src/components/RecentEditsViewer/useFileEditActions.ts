/**
 * Shared row actions for a recent file edit: copy, reveal in the OS file
 * manager, and restore.
 *
 * Extracted so the compact row and the standard card cannot drift apart on
 * behaviour that is genuinely identical between them (what gets copied, when
 * reveal is available, the restore confirm-then-write flow and its transient
 * status). Rendering stays entirely with the callers, which look nothing alike.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "@/services/api";
import { isAbsolutePath } from "@/utils/pathUtils";
import { isTauri, isMacOS, isWindows } from "@/utils/platform";
import type { RecentFileEdit } from "../../types";
import type { RestoreStatus } from "./types";

const TRANSIENT_MS = 2000;
const ERROR_MS = 5000;

export interface FileEditActions {
  copied: boolean;
  copy: () => Promise<void>;

  /**
   * `revealItemInDir` is a Tauri-only plugin API with no WebUI (Axum)
   * fallback, so callers hide the button entirely in `--serve` mode rather
   * than showing it disabled.
   */
  canReveal: boolean;
  revealLabel: string;
  reveal: () => Promise<void>;

  restoreStatus: RestoreStatus;
  restoreError: string | null;
  isConfirmingRestore: boolean;
  requestRestore: () => void;
  confirmRestore: () => Promise<void>;
  cancelRestore: () => void;
}

export function useFileEditActions(
  edit: RecentFileEdit,
  options: {
    onRestored?: (filePath: string) => void;
    /** See `restoreScope` on the row props - required for restore to be offered. */
    restoreScope?: { projectPath: string; sessionFilePath?: string };
  } = {}
): FileEditActions {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [restoreStatus, setRestoreStatus] = useState<RestoreStatus>("idle");
  const [isConfirmingRestore, setIsConfirmingRestore] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // Timers are held so a second click replaces the first rather than inheriting
  // its countdown: copying twice 1.9s apart used to let the first timer clear
  // the second click's success state almost immediately. Cleared on unmount too,
  // so a row scrolled out of the list does not set state on a dead component.
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
      if (restoreTimer.current) clearTimeout(restoreTimer.current);
    },
    []
  );

  const { onRestored } = options;
  const filePath = edit.file_path;
  const content = edit.content_after_change;

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), TRANSIENT_MS);
    } catch (err) {
      console.error("Failed to copy:", err);
      toast.error(t("recentEdits.copyError", "Failed to copy file content"));
    }
  }, [content, t]);

  const canReveal = isTauri() && isAbsolutePath(filePath);

  const revealLabel = isMacOS()
    ? t("recentEdits.revealInFinder")
    : isWindows()
      ? t("recentEdits.revealInExplorer")
      : t("recentEdits.revealInFolder");

  const reveal = useCallback(async () => {
    try {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(filePath);
    } catch (err) {
      console.error("Failed to reveal file:", err);
      toast.error(t("recentEdits.revealError"));
    }
  }, [filePath, t]);

  const requestRestore = useCallback(() => {
    setIsConfirmingRestore(true);
  }, []);

  const cancelRestore = useCallback(() => {
    setIsConfirmingRestore(false);
  }, []);

  const confirmRestore = useCallback(async () => {
    setIsConfirmingRestore(false);
    setRestoreError(null);
    try {
      setRestoreStatus("loading");
      // The project is what authorises the write, so a row without one cannot
      // restore. Guarded here rather than only in the UI so the call is never
      // made without it.
      if (!options.restoreScope) {
        throw new Error("Cannot restore without the originating project");
      }
      await api("restore_file", {
        filePath,
        content,
        projectPath: options.restoreScope.projectPath,
        sessionFilePath: options.restoreScope.sessionFilePath,
      });
      setRestoreStatus("success");
      // The row's `exists_on_disk` was resolved when the page was fetched, so
      // without telling anyone the row keeps reporting itself missing.
      onRestored?.(filePath);
      if (restoreTimer.current) clearTimeout(restoreTimer.current);
      restoreTimer.current = setTimeout(
        () => setRestoreStatus("idle"),
        TRANSIENT_MS
      );
    } catch (err) {
      console.error("Failed to restore file:", err);
      setRestoreError(err instanceof Error ? err.message : String(err));
      setRestoreStatus("error");
      if (restoreTimer.current) clearTimeout(restoreTimer.current);
      restoreTimer.current = setTimeout(() => {
        setRestoreStatus("idle");
        setRestoreError(null);
      }, ERROR_MS);
    }
  }, [filePath, content, onRestored]);

  return {
    copied,
    copy,
    canReveal,
    revealLabel,
    reveal,
    restoreStatus,
    restoreError,
    isConfirmingRestore,
    requestRestore,
    confirmRestore,
    cancelRestore,
  };
}
