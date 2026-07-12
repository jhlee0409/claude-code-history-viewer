import React, { useCallback, useState } from "react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { NativeRenameDialog } from "@/components/NativeRenameDialog";
import { useSessionEditing } from "./hooks/useSessionEditing";
import { SessionHeader } from "./components/SessionHeader";
import { SessionNameEditor } from "./components/SessionNameEditor";
import { SessionContextMenu } from "./components/SessionContextMenu";
import { SessionDeleteDialog } from "./components/SessionDeleteDialog";
import { SessionMeta } from "./components/SessionMeta";
import type { SessionItemProps } from "./types";
import type { Boundary } from "@/utils/contextMenu";

type ContextMenuPosition = { x: number; y: number; boundary?: Boundary | null };

export const SessionItem: React.FC<SessionItemProps> = ({
  session,
  isSelected,
  onSelect,
  onHover,
  formatTimeAgo,
  isSelectionMode = false,
  isChecked = false,
  onToggleSelect,
  onModifierSelect,
}) => {
  const { t } = useTranslation();
  const editing = useSessionEditing(session);
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (editing.isEditing) return;
      if (isSelectionMode) {
        onToggleSelect?.(e);
        return;
      }
      // Finder-style multi-select from normal mode: Cmd/Ctrl+click or
      // Shift+click starts/extends a selection (and enters selection mode).
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        onModifierSelect?.(e);
        return;
      }
      if (!isSelected) {
        onSelect();
      }
    },
    [editing.isEditing, isSelectionMode, onToggleSelect, onModifierSelect, isSelected, onSelect]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Suppress the browser's text selection when Shift/Cmd/Ctrl-clicking to
      // start a multi-selection (selection begins on mousedown, not click).
      if (!isSelectionMode && (e.shiftKey || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
      }
    },
    [isSelectionMode]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      e.preventDefault();
      // In multi-select mode the row is a toggle target, not a menu host.
      if (isSelectionMode) return;
      editing.setIsContextMenuOpen(false);
      const boundary = e.currentTarget
        .closest<HTMLElement>("[data-menu-boundary]")
        ?.getBoundingClientRect() ?? null;
      setContextMenu({ x: e.clientX, y: e.clientY, boundary });
    },
    [isSelectionMode, editing]
  );

  const highlighted = isSelectionMode ? isChecked : isSelected;

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null);
  }, []);

  return (
    <div
      className={cn(
        "group w-full flex flex-col gap-1.5 py-2.5 px-3 rounded-lg",
        "text-left transition-all duration-300",
        "hover:bg-accent/8",
        isSelectionMode && "cursor-pointer select-none",
        highlighted
          ? "bg-accent/15 shadow-sm shadow-accent/10 ring-1 ring-accent/20"
          : "bg-transparent"
      )}
      style={{ width: "calc(100% - 8px)" }}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => {
        if (!editing.isEditing && onHover) {
          onHover();
        }
      }}
    >
      {/* Session Header */}
      <div className="flex items-start gap-2.5">
        {isSelectionMode && (
          <span
            role="checkbox"
            aria-checked={isChecked}
            aria-label={editing.displayName || t("session.summaryNotFound", "No summary")}
            tabIndex={0}
            onKeyDown={(e) => {
              // Keyboard parity with the row click: Space/Enter toggles.
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                onToggleSelect?.(e);
              }
            }}
            className={cn(
              "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              isChecked
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border bg-transparent"
            )}
          >
            {isChecked && <Check className="h-3 w-3" aria-hidden="true" />}
          </span>
        )}
        <SessionHeader
          isArchivedCodexSession={editing.isArchivedCodexSession}
          isSelected={highlighted}
        />

        {/* Session Name / Edit Mode */}
        <div className="flex-1 min-w-0 flex items-start gap-1">
          {isSelectionMode ? (
            <span
              className={cn(
                "text-xs leading-relaxed line-clamp-2 flex-1",
                editing.isNamed ? "font-bold" : "italic opacity-70",
                highlighted ? "text-accent" : "text-sidebar-foreground/70"
              )}
            >
              {editing.displayName || t("session.summaryNotFound", "No summary")}
            </span>
          ) : (
          <SessionNameEditor
            isEditing={editing.isEditing}
            editValue={editing.editValue}
            displayName={editing.displayName}
            hasCustomName={editing.hasCustomName}
            hasClaudeCodeName={editing.hasClaudeCodeName}
            isNamed={editing.isNamed}
            isSelected={isSelected}
            isContextMenuOpen={editing.isContextMenuOpen}
            readOnly={editing.isServerReadOnly}
            providerId={editing.providerId}
            supportsNativeRename={editing.supportsNativeRename}
            supportsResumeCommand={editing.supportsResumeCommand}
            supportsSessionDeletion={editing.supportsSessionDeletion}
            supportsRevealInFinder={editing.supportsRevealInFinder}
            inputRef={editing.inputRef}
            ignoreBlurRef={editing.ignoreBlurRef}
            onEditValueChange={editing.setEditValue}
            onKeyDown={editing.handleKeyDown}
            onSave={editing.saveCustomName}
            onCancel={editing.cancelEditing}
            onDoubleClick={editing.handleDoubleClick}
            onRenameClick={editing.handleRenameClick}
            onResetCustomName={editing.resetCustomName}
            onNativeRenameClick={editing.handleNativeRenameClick}
            onCopySessionId={editing.handleCopySessionId}
            onCopyResumeCommand={editing.handleCopyResumeCommand}
            onCopyFilePath={editing.handleCopyFilePath}
            onRevealInFinder={editing.handleRevealInFinder}
            onDeleteSession={editing.handleDeleteSession}
            onContextMenuOpenChange={editing.setIsContextMenuOpen}
          />
          )}
        </div>
      </div>

      {/* Session Meta */}
      <SessionMeta
        session={session}
        isSelected={highlighted}
        formatTimeAgo={formatTimeAgo}
      />

      {/* Right-click Context Menu */}
      {!isSelectionMode && contextMenu && (
        <SessionContextMenu
          position={contextMenu}
          hasCustomName={editing.hasCustomName}
          readOnly={editing.isServerReadOnly}
          supportsNativeRename={editing.supportsNativeRename}
          supportsResumeCommand={editing.supportsResumeCommand}
          supportsSessionDeletion={editing.supportsSessionDeletion}
          supportsRevealInFinder={editing.supportsRevealInFinder}
          providerId={editing.providerId}
          onClose={handleContextMenuClose}
          onRenameClick={editing.handleRenameClick}
          onResetCustomName={() => void editing.resetCustomName()}
          onNativeRenameClick={editing.handleNativeRenameClick}
          onCopySessionId={editing.handleCopySessionId}
          onCopyResumeCommand={editing.handleCopyResumeCommand}
          onCopyFilePath={editing.handleCopyFilePath}
          onRevealInFinder={editing.handleRevealInFinder}
          onDeleteSession={editing.handleDeleteSession}
        />
      )}

      {/* Native Rename Dialog */}
      <NativeRenameDialog
        open={editing.isNativeRenameOpen}
        onOpenChange={editing.setIsNativeRenameOpen}
        filePath={session.file_path}
        currentName={editing.localSummary || ""}
        isRenamed={!!session.is_renamed}
        provider={editing.providerId}
        onSuccess={editing.handleNativeRenameSuccess}
      />

      <SessionDeleteDialog
        open={editing.isDeleteDialogOpen}
        onOpenChange={editing.setIsDeleteDialogOpen}
        title={editing.deleteDialogTitle}
        description={editing.deleteDialogDescription}
        filePath={session.file_path}
        isDeleting={editing.isDeletingSession}
        onConfirm={editing.handleConfirmDeleteSession}
      />
    </div>
  );
};
