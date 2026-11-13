import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useSessionDisplayName,
  useSessionMetadata,
} from "@/hooks/useSessionMetadata";
import { useAppStore } from "@/store/useAppStore";
import { api } from "@/services/api";
import {
  getProjectDisplayName,
  isAbsolutePath,
  splitPathParts,
} from "@/utils/pathUtils";
import {
  getResumeCommand,
  supportsNativeRename as providerSupportsNativeRename,
  supportsResumeCommandForSession,
  supportsSessionDeletion as providerSupportsSessionDeletion,
} from "@/utils/providers";
import { parseResumeArgs } from "@/utils/resumeArgs";
import type { ClaudeProject, ClaudeSession } from "@/types";
import { copyTextToClipboard } from "@/utils/clipboard";
import { projectListing } from "@/navigation/library";
import { findSession } from "@/navigation/openSessionRef";
import type { SessionRef } from "@/navigation/place";

/** Parent folder of a path, compared part-wise so `/` and `\` both work. */
function parentKey(path: string): string {
  return splitPathParts(path).slice(0, -1).join("/");
}

/** Maps the backend's move error codes to a user-facing message key. */
function moveErrorKey(message: string) {
  if (message.startsWith("SESSION_ACTIVE")) return "session.move.errorActive" as const;
  if (message.startsWith("SESSION_RECENTLY_MODIFIED")) return "session.move.errorRecent" as const;
  if (message.startsWith("TARGET_EXISTS")) return "session.move.errorExists" as const;
  return null;
}

/** `move_session_to_project`'s answer. */
interface MoveSessionResult {
  new_file_path: string;
  target_project_path: string;
  /** The old companion folder, copied in full but not removed completely. */
  leftover_folder: string | null;
}

/**
 * A session row's editing and context-menu actions. `owner` is the project
 * the row is listed under, when the caller knows it (the sidebar's project
 * preview); it gives the resume command its working directory.
 */
export function useSessionEditing(session: ClaudeSession, owner?: ClaudeProject) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const [isNativeRenameOpen, setIsNativeRenameOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false);
  const [isMovingSession, setIsMovingSession] = useState(false);
  const [localSummary, setLocalSummary] = useState(session.summary);
  const inputRef = useRef<HTMLInputElement>(null);
  const ignoreBlurRef = useRef<boolean>(false);

  const providerId = session.provider ?? "claude";
  const userMetadata = useAppStore((state) => state.userMetadata);
  const isServerReadOnly = useAppStore((state) => state.isServerReadOnly);
  const selectedProject = useAppStore((state) => state.selectedProject);
  const loadedSessions = useAppStore((state) => state.sessions);
  const projects = useAppStore((state) => state.projects);
  const supportsNativeRename =
    !isServerReadOnly && providerSupportsNativeRename(providerId);
  const supportsSessionDeletion =
    !isServerReadOnly && providerSupportsSessionDeletion(providerId);
  const supportsRevealInFinder = isAbsolutePath(session.file_path);
  // Moving relocates `<projects>/<project>/<id>.jsonl`, which only Claude Code
  // sessions have; the backend re-validates the layout.
  const supportsSessionMove =
    !isServerReadOnly &&
    providerId === "claude" &&
    supportsRevealInFinder &&
    session.file_path.endsWith(".jsonl");
  const isArchivedCodexSession =
    providerId === "codex" &&
    /(?:^|[\\/])archived_sessions(?:[\\/]|$)/.test(session.file_path);
  const deleteDialogTitle = t("session.deleteTitle", "Delete Session");
  const deleteDialogDescription =
    providerId === "forgecode"
      ? t(
          "session.deleteConfirmForgeCode",
          "This will permanently delete the ForgeCode conversation from the Forge database."
        )
      : t(
          "session.deleteConfirm",
          "This will move the session file and associated data (subagents, tool results) to your system Trash."
        );

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
    providerId === "claude"
      ? hasClaudeCodeNameMeta || hasClaudeCodeNamePattern
      : supportsNativeRename && !!session.is_renamed;
  const isNamed = hasCustomName || hasClaudeCodeName || !!session.is_renamed;

  const startEditing = useCallback(() => {
    if (isServerReadOnly) return;
    setEditValue(displayName || "");
    setIsEditing(true);
  }, [displayName, isServerReadOnly]);

  const saveCustomName = useCallback(async () => {
    if (isServerReadOnly) {
      setIsEditing(false);
      return;
    }
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
  }, [editValue, isServerReadOnly, localSummary, setCustomName, t]);

  const cancelEditing = useCallback(() => {
    setIsEditing(false);
    setEditValue("");
  }, []);

  const resetCustomName = useCallback(async () => {
    if (isServerReadOnly) {
      setIsContextMenuOpen(false);
      return;
    }
    try {
      await setCustomName(undefined);
    } catch (error) {
      console.error("Failed to reset custom name:", error);
      toast.error(t("session.resetError", "Failed to reset name"));
    } finally {
      setIsContextMenuOpen(false);
    }
  }, [isServerReadOnly, setCustomName, t]);

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
        await copyTextToClipboard(text);
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

  const projectForSession = useMemo(
    // The row's own project, else the open project when its list holds the
    // session, else the one whose storage holds the file - never a project
    // that only shares the name (`projectListing`).
    () => projectListing({ projects, selectedProject, sessions: loadedSessions }, session, owner),
    [loadedSessions, owner, projects, selectedProject, session]
  );

  const projectPathUnavailable = projectForSession?.path_status === "unavailable";
  const projectCwd = projectPathUnavailable ? undefined : projectForSession?.actual_path;
  const supportsResumeCommand =
    supportsResumeCommandForSession(providerId, session.entrypoint) &&
    !projectPathUnavailable;

  const handleCopyResumeCommand = useCallback(
    (e: React.MouseEvent) => {
      const rawArgs = userMetadata?.settings?.resumeCliArgs?.[providerId] ?? "";
      const { tokens } = parseResumeArgs(rawArgs);
      const resumeCommand = projectPathUnavailable
        ? null
        : getResumeCommand(
            providerId,
            session.actual_session_id,
            projectCwd,
            session.entrypoint,
            tokens.length > 0 ? tokens.join(" ") : undefined
          );
      if (!resumeCommand) {
        e.stopPropagation();
        setIsContextMenuOpen(false);
        toast.error(
          projectPathUnavailable
            ? t(
                "session.resumeUnavailableLocation",
                "Resume is unavailable because the last-known working directory is missing"
              )
            : t("session.copyResumeCommandError", "Resume command unavailable")
        );
        return;
      }

      return handleCopyToClipboard(
        e,
        resumeCommand,
        projectCwd
          ? t("session.copiedResumeCommand", "Resume command copied")
          : t(
              "session.copiedResumeCommandNoCwd",
              "Resume command copied (working directory unknown)"
            )
      );
    },
    [
      handleCopyToClipboard,
      projectCwd,
      projectPathUnavailable,
      providerId,
      session.actual_session_id,
      session.entrypoint,
      t,
      userMetadata?.settings?.resumeCliArgs,
    ]
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

  const handleRevealInFinder = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsContextMenuOpen(false);
      if (!session.file_path || !supportsRevealInFinder) {
        toast.error(t("session.revealError", "Could not reveal file"));
        return;
      }
      try {
        const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
        await revealItemInDir(session.file_path);
      } catch {
        toast.error(t("session.revealError", "Could not reveal file"));
      }
    },
    [session.file_path, supportsRevealInFinder, t]
  );

  const handleDeleteSession = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsContextMenuOpen(false);
      if (!session.file_path || !supportsSessionDeletion) {
        toast.error(t("session.deleteError", "Failed to delete session"));
        return;
      }
      setIsDeleteDialogOpen(true);
    },
    [session.file_path, supportsSessionDeletion, t]
  );

  const handleConfirmDeleteSession = useCallback(async () => {
    if (!session.file_path || !supportsSessionDeletion) {
      setIsDeleteDialogOpen(false);
      toast.error(t("session.deleteError", "Failed to delete session"));
      return;
    }

    setIsDeletingSession(true);
    try {
      await api("delete_session", { filePath: session.file_path });
      const { sessions, setSessions, selectedSession, navigate } =
        useAppStore.getState();
      setSessions(sessions.filter((s) => s.session_id !== session.session_id));
      if (selectedSession?.session_id === session.session_id) {
        // The open place lost its session: fall back to the project's empty
        // screen. Not a step the user can go back to.
        await navigate({ session: null }, { record: false, history: "replace" });
      }
      setIsDeleteDialogOpen(false);
      toast.success(t("session.deleteSuccess", "Session deleted"));
    } catch (error) {
      const description =
        error instanceof Error ? error.message : String(error);
      console.error("[session delete] failed", {
        sessionId: session.session_id,
        error,
      });
      toast.error(t("session.deleteError", "Failed to delete session"), {
        description,
      });
    } finally {
      setIsDeletingSession(false);
    }
  }, [session.file_path, session.session_id, supportsSessionDeletion, t]);

  const handleDeleteDialogOpenChange = useCallback(
    (open: boolean) => {
      if (isDeletingSession) {
        return;
      }
      setIsDeleteDialogOpen(open);
    },
    [isDeletingSession]
  );

  // Other Claude Code projects in the same `projects/` folder as this session.
  const moveTargets = useMemo(() => {
    if (!supportsSessionMove) return [];
    const sourceProjectDir = parentKey(session.file_path);
    const projectsDir = parentKey(sourceProjectDir);
    return projects.filter(
      (project) =>
        (project.provider ?? "claude") === "claude" &&
        parentKey(project.path) === projectsDir &&
        splitPathParts(project.path).join("/") !== sourceProjectDir
    );
  }, [projects, session.file_path, supportsSessionMove]);

  const handleMoveSession = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsContextMenuOpen(false);
    setIsMoveDialogOpen(true);
  }, []);

  const handleConfirmMoveSession = useCallback(
    async (target: ClaudeProject) => {
      if (!supportsSessionMove) {
        setIsMoveDialogOpen(false);
        return;
      }

      setIsMovingSession(true);
      let result: MoveSessionResult;
      try {
        result = await api<MoveSessionResult>("move_session_to_project", {
          sessionPath: session.file_path,
          targetProjectPath: target.path,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[session move] failed", {
          sessionId: session.session_id,
          error,
        });
        const key = moveErrorKey(message);
        if (key) {
          toast.error(t(key));
        } else {
          toast.error(t("session.move.error"), { description: message });
        }
        setIsMovingSession(false);
        return;
      }

      setIsMoveDialogOpen(false);
      setIsMovingSession(false);
      const projectName = getProjectDisplayName(target);
      if (result.leftover_folder) {
        toast.warning(t("session.move.leftover", { project: projectName }), {
          description: result.leftover_folder,
        });
      } else {
        toast.success(t("session.move.success", { project: projectName }));
      }

      try {
        // A Claude Code session's id is its file path, so the app's records
        // of it (custom name, notes, star, recent list) follow the file.
        const ref: SessionRef = {
          provider: "claude",
          filePath: result.new_file_path,
          sessionId: result.new_file_path,
          ...(session.actual_session_id
            ? { actualSessionId: session.actual_session_id }
            : {}),
          projectPath: target.path,
        };
        const store = useAppStore.getState();
        try {
          await store.moveSessionMetadata(session.session_id, result.new_file_path, ref);
        } catch (error) {
          toast.error(t("session.move.metadataError"), {
            description: error instanceof Error ? error.message : String(error),
          });
        }
        store.relocateRecentSession(session.file_path, ref);

        const { sessions, setSessions, selectedSession, navigate, beginNavigation } =
          useAppStore.getState();
        setSessions(sessions.filter((s) => s.file_path !== session.file_path));
        if (selectedSession?.file_path === session.file_path) {
          // The open session follows its file into the target project. The
          // old place is gone, so it is replaced rather than recorded.
          const epoch = beginNavigation();
          const owns = () => useAppStore.getState().navigationEpoch === epoch;
          const found = await findSession(ref, owns);
          if (found !== "superseded" && owns()) {
            await navigate(
              found
                ? { project: found.project, session: found.session }
                : { session: null },
              { epoch, record: false, history: "replace" }
            );
          }
        }
      } catch (error) {
        console.error("[session move] follow-up failed", error);
      } finally {
        // Refresh the sidebar's per-project session counts.
        void useAppStore.getState().scanProjects();
      }
    },
    [
      session.actual_session_id,
      session.file_path,
      session.session_id,
      supportsSessionMove,
      t,
    ]
  );

  const handleMoveDialogOpenChange = useCallback(
    (open: boolean) => {
      if (isMovingSession) return;
      setIsMoveDialogOpen(open);
    },
    [isMovingSession]
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
    async (newTitle: string, isNativeRenamed: boolean) => {
      if (newTitle) {
        setLocalSummary(newTitle);
        try {
          if (providerId === "claude") {
            await setHasClaudeCodeName(isNativeRenamed);
          }
        } catch (error) {
          console.error("Failed to update Claude Code name metadata:", error);
          toast.error(t("session.syncError", "Failed to sync metadata"));
        }

        const { sessions: currentSessions, setSessions } = useAppStore.getState();
        const updatedSessions = currentSessions.map((s) =>
          s.session_id === session.session_id
            ? {
                ...s,
                summary: newTitle,
                is_renamed:
                  supportsNativeRename ? isNativeRenamed : s.is_renamed,
              }
            : s
        );
        setSessions(updatedSessions);
      }
    },
    [providerId, setHasClaudeCodeName, supportsNativeRename, t, session.session_id]
  );

  return {
    // State
    isEditing,
    editValue,
    isContextMenuOpen,
    isNativeRenameOpen,
    isDeleteDialogOpen,
    isDeletingSession,
    isMoveDialogOpen,
    isMovingSession,
    moveTargets,
    localSummary,
    displayName,
    hasCustomName,
    hasClaudeCodeName,
    isNamed,
    providerId,
    supportsNativeRename,
    supportsResumeCommand,
    supportsSessionDeletion,
    supportsRevealInFinder,
    supportsSessionMove,
    isArchivedCodexSession,
    isServerReadOnly,
    deleteDialogTitle,
    deleteDialogDescription,
    inputRef,
    ignoreBlurRef,

    // Actions
    setEditValue,
    setIsContextMenuOpen,
    setIsNativeRenameOpen,
    setIsDeleteDialogOpen: handleDeleteDialogOpenChange,
    saveCustomName,
    cancelEditing,
    resetCustomName,
    handleKeyDown,
    handleDoubleClick,
    handleRenameClick,
    handleCopySessionId,
    handleCopyResumeCommand,
    handleCopyFilePath,
    handleRevealInFinder,
    handleDeleteSession,
    handleConfirmDeleteSession,
    setIsMoveDialogOpen: handleMoveDialogOpenChange,
    handleMoveSession,
    handleConfirmMoveSession,
    handleNativeRenameClick,
    handleNativeRenameSuccess,
  };
}
