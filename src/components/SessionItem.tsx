// src/components/SessionItem.tsx
import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  MessageCircle,
  Wrench,
  AlertTriangle,
  Clock,
  Hash,
  Pencil,
  X,
  Check,
  RotateCcw,
  Terminal,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ClaudeSession } from "../types";
import { cn } from "@/lib/utils";
import {
  useSessionDisplayName,
  useSessionMetadata,
} from "@/hooks/useSessionMetadata";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NativeRenameDialog } from "@/components/NativeRenameDialog";

interface SessionItemProps {
  session: ClaudeSession;
  isSelected: boolean;
  onSelect: () => void;
  onHover?: () => void;
  formatTimeAgo: (date: string) => string;
}

export const SessionItem: React.FC<SessionItemProps> = ({
  session,
  isSelected,
  onSelect,
  onHover,
  formatTimeAgo,
}) => {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const [isNativeRenameOpen, setIsNativeRenameOpen] = useState(false);
  // Local state for summary that can be updated after native rename
  const [localSummary, setLocalSummary] = useState(session.summary);
  const inputRef = useRef<HTMLInputElement>(null);
  const ignoreBlurRef = useRef<boolean>(false);

  // Sync localSummary when session.summary prop changes (e.g., session list refresh)
  useEffect(() => {
    setLocalSummary(session.summary);
  }, [session.summary]);

  // Use the hooks for display name and metadata actions
  const displayName = useSessionDisplayName(session.session_id, localSummary);
  const { customName, setCustomName } = useSessionMetadata(session.session_id);
  const hasCustomName = !!customName;
  // Detect if session has Claude Code native rename (starts with [Title])
  const hasClaudeCodeName = localSummary?.startsWith("[") ?? false;

  // Start editing mode
  const startEditing = useCallback(() => {
    setEditValue(displayName || "");
    setIsEditing(true);
  }, [displayName]);

  // Save the custom name
  const saveCustomName = useCallback(async () => {
    const trimmedValue = editValue.trim();
    // If empty or same as original summary, clear custom name
    if (!trimmedValue || trimmedValue === localSummary) {
      await setCustomName(undefined);
    } else {
      await setCustomName(trimmedValue);
    }
    setIsEditing(false);
  }, [editValue, localSummary, setCustomName]);

  // Cancel editing
  const cancelEditing = useCallback(() => {
    setIsEditing(false);
    setEditValue("");
  }, []);

  // Reset custom name to original summary
  const resetCustomName = useCallback(async () => {
    await setCustomName(undefined);
    setIsContextMenuOpen(false);
  }, [setCustomName]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Handle keyboard events
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

  // Handle double-click to edit
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      startEditing();
    },
    [startEditing]
  );

  // Handle click (select session)
  const handleClick = useCallback(() => {
    if (!isEditing && !isSelected) {
      onSelect();
    }
  }, [isEditing, isSelected, onSelect]);

  // Handle context menu rename action
  const handleRenameClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsContextMenuOpen(false);
      startEditing();
    },
    [startEditing]
  );

  // Handle native rename action
  const handleNativeRenameClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsContextMenuOpen(false);
      setIsNativeRenameOpen(true);
    },
    []
  );

  // Handle native rename success
  const handleNativeRenameSuccess = useCallback((newTitle: string) => {
    // Update local summary to reflect the new name
    // newTitle contains the full first line content after rename
    // The backend returns the updated message content
    if (newTitle) {
      setLocalSummary(newTitle);
    }
  }, []);

  return (
    <div
      className={cn(
        "group w-full flex flex-col gap-1.5 py-2.5 px-3 rounded-lg",
        "text-left transition-all duration-300",
        "hover:bg-accent/8",
        isSelected
          ? "bg-accent/15 shadow-sm shadow-accent/10 ring-1 ring-accent/20"
          : "bg-transparent"
      )}
      style={{ width: "calc(100% - 8px)" }}
      onClick={handleClick}
      onMouseEnter={() => {
        // Only trigger hover action if we are NOT in editing mode and a hover handler is provided
        if (!isEditing && onHover) {
          onHover();
        }
      }}
    >
      {/* Session Header */}
      <div className="flex items-start gap-2.5">
        <div
          className={cn(
            "w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-all duration-300",
            isSelected
              ? "bg-accent text-accent-foreground"
              : "bg-muted/50 text-muted-foreground"
          )}
        >
          <span title={t("session.item.session")}><MessageCircle className="w-3 h-3" /></span>
        </div>

        {/* Session Name / Edit Mode */}
        <div className="flex-1 min-w-0 flex items-start gap-1">
          {isEditing ? (
            <div className="flex-1 flex items-center gap-1">
              <input
                ref={inputRef}
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={() => {
                  if (ignoreBlurRef.current) {
                    ignoreBlurRef.current = false;
                    return;
                  }
                  saveCustomName();
                }}
                placeholder={t(
                  "session.renamePlaceholder",
                  "Enter session name..."
                )}
                className={cn(
                  "flex-1 text-xs bg-background border border-accent/40 rounded px-2 py-1",
                  "focus:outline-none focus:ring-1 focus:ring-accent/60",
                  "text-foreground placeholder:text-muted-foreground"
                )}
                onClick={(e) => e.stopPropagation()}
              />
              <button
                type="button"
                onMouseDown={() => {
                  ignoreBlurRef.current = true;
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  saveCustomName();
                }}
                className="p-1 rounded hover:bg-accent/20 text-accent"
                title={t("common.save")}
              >
                <Check className="w-3 h-3" />
              </button>
              <button
                type="button"
                onMouseDown={() => {
                  ignoreBlurRef.current = true;
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  cancelEditing();
                }}
                className="p-1 rounded hover:bg-destructive/20 text-destructive"
                title={t("common.cancel")}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <>
              <span
                className={cn(
                  "text-xs leading-relaxed line-clamp-2 transition-colors duration-300 flex-1 cursor-pointer flex items-start gap-1",
                  isSelected
                    ? "text-accent font-medium"
                    : "text-sidebar-foreground/70"
                )}
                onDoubleClick={handleDoubleClick}
                title={t("session.rename", "Double-click to rename")}
              >
                {hasClaudeCodeName && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Terminal className="w-3 h-3 shrink-0 mt-0.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <p>{t("session.claudeCodeSynced", "Synced with Claude Code CLI")}</p>
                    </TooltipContent>
                  </Tooltip>
                )}
                <span className="flex-1">
                  {displayName || t("session.summaryNotFound", "No summary")}
                </span>
              </span>

              {/* Context Menu for Rename */}
              <DropdownMenu
                open={isContextMenuOpen}
                onOpenChange={setIsContextMenuOpen}
              >
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                      "p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity",
                      "hover:bg-accent/20 text-muted-foreground hover:text-accent",
                      isContextMenuOpen && "opacity-100"
                    )}
                    title={t("session.rename", "Rename session")}
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={handleRenameClick}>
                    <Pencil className="w-3 h-3 mr-2" />
                    {t("session.rename", "Rename")}
                  </DropdownMenuItem>
                  {hasCustomName && (
                    <DropdownMenuItem onClick={resetCustomName}>
                      <RotateCcw className="w-3 h-3 mr-2" />
                      {t("session.resetName", "Reset name")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleNativeRenameClick}>
                    <Terminal className="w-3 h-3 mr-2" />
                    {t("session.nativeRename.menuItem", "Rename in Claude Code")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      {/* Session Meta */}
      <div className="flex items-center gap-3 ml-7 text-2xs">
        <span
          className={cn(
            "flex items-center gap-1 font-mono",
            isSelected ? "text-accent/80" : "text-muted-foreground"
          )}
        >
          <span title={t("session.item.lastModified")}><Clock className="w-3 h-3" /></span>
          {formatTimeAgo(session.last_modified)}
        </span>
        <span
          className={cn(
            "flex items-center gap-1 font-mono",
            isSelected ? "text-accent/80" : "text-muted-foreground"
          )}
        >
          <span title={t("session.item.messageCount")}><Hash className="w-3 h-3" /></span>
          {session.message_count}
        </span>
        {session.has_tool_use && (
          <span title={t("session.item.containsToolUse")}>
            <Wrench
              className={cn(
                "w-3 h-3",
                isSelected ? "text-accent" : "text-accent/50"
              )}
            />
          </span>
        )}
        {session.has_errors && (
          <span title={t("session.item.containsErrors")}><AlertTriangle className="w-3 h-3 text-destructive" /></span>
        )}
      </div>

      {/* Native Rename Dialog */}
      <NativeRenameDialog
        open={isNativeRenameOpen}
        onOpenChange={setIsNativeRenameOpen}
        filePath={session.file_path}
        currentName={localSummary || ""}
        onSuccess={handleNativeRenameSuccess}
      />
    </div>
  );
};
