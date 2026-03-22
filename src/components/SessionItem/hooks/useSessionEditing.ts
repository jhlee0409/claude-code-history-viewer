import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useSessionDisplayName,
  useSessionMetadata,
} from "@/hooks/useSessionMetadata";
import { useAppStore } from "@/store/useAppStore";
import type { ClaudeSession } from "@/types";

export function useSessionEditing(session: ClaudeSession) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const [isNativeRenameOpen, setIsNativeRenameOpen] = useState(false);
  const [localSummary, setLocalSummary] = useState(session.summary);
  const inputRef = useRef<HTMLInputElement>(null);
  const ignoreBlurRef = useRef<boolean>(false);

  const providerId = session.provider ?? "claude";
  const supportsNativeRename = providerId === "claude" || providerId === "opencode";
  const isArchivedCodexSession =
    providerId === "codex" &&
    /(?:^|[\\/])archived_sessions(?:[\\/]|$)/.test(session.file_path);

  // Sync localSummary when session.summary prop changes
  useEffect(() => {
    setLocalSummary(session.summary);
  }, [session.summary]);

  const displayName = useSessionDisplayName(session.session_id, localSummary);
  const {
    customName,
    setCustomName,
    hasClaudeCodeName: hasClaudeCodeNameMeta,
    setHasClaudeCodeName,
  } = useSessionMetadata(session.session_id);
  const hasCustomName = !!customName;
  const hasClaudeCodeNamePattern = /^\[.+?\]\s/.test(localSummary ?? "");
  const hasClaudeCodeName =
    providerId === "claude" && (hasClaudeCodeNameMeta || hasClaudeCodeNamePattern);
  const isNamed = hasCustomName || hasClaudeCodeName || !!session.is_renamed;

  const startEditing = useCallback(() => {
    setEditValue(displayName || "");
    setIsEditing(true);
  }, [displayName]);

  const saveCustomName = useCallback(async () => {
    try {
      const trimmedValue = editValue.trim();
      if (!trimmedValue || trimmedValue === localSummary) {
        await setCustomName(undefined);
      } else {
        await setCustomName(trimmedValue);
      }
    } catch (error) {
      console.error("Failed to save custom name:", error);
      toast.error(t("session.saveError", "Failed to save name"));
    } finally {
      setIsEditing(false);
    }
  }, [editValue, localSummary, setCustomName, t]);

  const cancelEditing = useCallback(() => {
    setIsEditing(false);
    setEditValue("");
  }, []);

  const resetCustomName = useCallback(async () => {
    try {
      await setCustomName(undefined);
    } catch (error) {
      console.error("Failed to reset custom name:", error);
      toast.error(t("session.resetError", "Failed to reset name"));
    } finally {
      setIsContextMenuOpen(false);
    }
  }, [setCustomName, t]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveCustomName();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelEditing();
      }
    },
    [saveCustomName, cancelEditing]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      startEditing();
    },
    [startEditing]
  );

  const handleRenameClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsContextMenuOpen(false);
      startEditing();
    },
    [startEditing]
  );

  const handleCopyToClipboard = useCallback(
    async (e: React.MouseEvent, text: string, successMsg: string) => {
      e.stopPropagation();
      setIsContextMenuOpen(false);
      try {
        await navigator.clipboard.writeText(text);
        toast.success(successMsg);
      } catch {
        toast.error(t("copyButton.error", "Copy failed"));
      }
    },
    [t]
  );

  const handleCopySessionId = useCallback(
    (e: React.MouseEvent) =>
      handleCopyToClipboard(
        e,
        session.actual_session_id,
        t("session.copiedSessionId", "Session ID copied")
      ),
    [handleCopyToClipboard, session.actual_session_id, t]
  );

  const handleCopyResumeCommand = useCallback(
    (e: React.MouseEvent) =>
      handleCopyToClipboard(
        e,
        `claude --resume ${session.actual_session_id}`,
        t("session.copiedResumeCommand", "Resume command copied")
      ),
    [handleCopyToClipboard, session.actual_session_id, t]
  );

  const handleCopyFilePath = useCallback(
    (e: React.MouseEvent) =>
      handleCopyToClipboard(
        e,
        session.file_path,
        t("session.copiedFilePath", "File path copied")
      ),
    [handleCopyToClipboard, session.file_path, t]
  );

  const handleNativeRenameClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsContextMenuOpen(false);
      setIsNativeRenameOpen(true);
    },
    []
  );

  const handleNativeRenameSuccess = useCallback(
    async (newTitle: string) => {
      if (newTitle) {
        setLocalSummary(newTitle);
        const hasPrefix = /^\[.+?\]\s/.test(newTitle);
        try {
          if (providerId === "claude") {
            await setHasClaudeCodeName(hasPrefix);
          }
        } catch (error) {
          console.error("Failed to update Claude Code name metadata:", error);
          toast.error(t("session.syncError", "Failed to sync metadata"));
        }

        const { sessions: currentSessions, setSessions } = useAppStore.getState();
        const updatedSessions = currentSessions.map((s) =>
          s.session_id === session.session_id ? { ...s, summary: newTitle } : s
        );
        setSessions(updatedSessions);
      }
    },
    [providerId, setHasClaudeCodeName, t, session.session_id]
  );

  return {
    // State
    isEditing,
    editValue,
    isContextMenuOpen,
    isNativeRenameOpen,
    localSummary,
    displayName,
    hasCustomName,
    hasClaudeCodeName,
    isNamed,
    providerId,
    supportsNativeRename,
    isArchivedCodexSession,
    inputRef,
    ignoreBlurRef,

    // Actions
    setEditValue,
    setIsContextMenuOpen,
    setIsNativeRenameOpen,
    saveCustomName,
    cancelEditing,
    resetCustomName,
    handleKeyDown,
    handleDoubleClick,
    handleRenameClick,
    handleCopySessionId,
    handleCopyResumeCommand,
    handleCopyFilePath,
    handleNativeRenameClick,
    handleNativeRenameSuccess,
  };
}
