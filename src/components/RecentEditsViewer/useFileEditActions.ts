/**
 * Shared row actions for a recent file edit: copy, reveal in the OS file
 * manager, and restore.
 *
 * Extracted so the compact row and the standard card cannot drift apart on
 * behaviour that is genuinely identical between them (what gets copied, when
 * reveal is available, the restore confirm-then-write flow and its transient
 * status). Rendering stays entirely with the callers, which look nothing alike.
 */

import { useCallback, useState } from "react";
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

export function useFileEditActions(edit: RecentFileEdit): FileEditActions {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [restoreStatus, setRestoreStatus] = useState<RestoreStatus>("idle");
  const [isConfirmingRestore, setIsConfirmingRestore] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const filePath = edit.file_path;
  const content = edit.content_after_change;

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), TRANSIENT_MS);
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
      await api("restore_file", { filePath, content });
      setRestoreStatus("success");
      setTimeout(() => setRestoreStatus("idle"), TRANSIENT_MS);
    } catch (err) {
      console.error("Failed to restore file:", err);
      setRestoreError(err instanceof Error ? err.message : String(err));
      setRestoreStatus("error");
      setTimeout(() => {
        setRestoreStatus("idle");
        setRestoreError(null);
      }, ERROR_MS);
    }
  }, [filePath, content]);

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
