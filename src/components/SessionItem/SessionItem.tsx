import React, { useCallback, useState } from "react";
import { Check, Ellipsis, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { NativeRenameDialog } from "@/components/NativeRenameDialog";
import { useAppStore } from "@/store/useAppStore";
import { useSessionEditing } from "./hooks/useSessionEditing";
import { SessionHeader } from "./components/SessionHeader";
import { SessionNameEditor } from "./components/SessionNameEditor";
import { SessionContextMenu } from "./components/SessionContextMenu";
import { SessionDeleteDialog } from "./components/SessionDeleteDialog";
import { SessionMeta } from "./components/SessionMeta";
import type { SessionItemProps } from "./types";
import { useOpenSessionInNewTab } from "@/contexts/openInNewTab";
import { isActionModifier } from "@/utils/platform";
import type { Boundary } from "@/utils/contextMenu";

type ContextMenuPosition = { x: number; y: number; boundary?: Boundary | null; anchor?: HTMLElement | null };

/**
 * One session row.
 *
 * Clicks (plan T7, decision (나)):
 * - plain click or ⌘/Ctrl+click opens the session (⌘+click will open a new
 *   tab once tabs exist, T8; until then it opens in place);
 * - Shift+click starts or extends a multi-selection;
 * - in selection mode every click toggles the row (Shift = range).
 *
 * `variant="compact"` is the sidebar's one-line row: a focusable tree item
 * (Enter opens, Space toggles in selection mode, ContextMenu / Shift+F10
 * opens the row menu), name, favourite star and time. On a coarse pointer
 * (touch) it also shows an actions button, the tap route to the row menu.
 */
export const SessionItem: React.FC<SessionItemProps> = ({
  session,
  project,
  isSelected,
  onSelect,
  onHover,
  formatTimeAgo,
  isSelectionMode = false,
  isChecked = false,
  onToggleSelect,
  onModifierSelect,
  variant = "default",
  ariaLevel = 2,
}) => {
  const { t } = useTranslation();
  const editing = useSessionEditing(session, project);
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null);
  const isFavorite = useAppStore((s) => s.userMetadata.sessions[session.session_id]?.starred === true);
  const toggleSessionFavorite = useAppStore((s) => s.toggleSessionFavorite);

  const openInNewTab = useOpenSessionInNewTab();

  const activate = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      if (editing.isEditing) return;
      if (isSelectionMode) {
        onToggleSelect?.(e);
        return;
      }
      if (e.shiftKey) {
        onModifierSelect?.(e);
        return;
      }
      // ⌘+click / ⌘+Enter: this session in a new tab (T8), even the open one.
      if (openInNewTab && isActionModifier(e)) {
        openInNewTab(session, project);
        return;
      }
      if (!isSelected) {
        onSelect();
      }
    },
    [editing.isEditing, isSelectionMode, onToggleSelect, onModifierSelect, isSelected, onSelect, openInNewTab, session, project]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Suppress the browser's text selection when Shift-clicking to start a
      // multi-selection (selection begins on mousedown, not click).
      if (!isSelectionMode && e.shiftKey) {
        e.preventDefault();
      }
    },
    [isSelectionMode]
  );

  const openContextMenuAt = useCallback(
    (target: HTMLElement, x: number, y: number) => {
      // In multi-select mode the row is a toggle target, not a menu host.
      if (isSelectionMode) return;
      editing.setIsContextMenuOpen(false);
      const boundary = target.closest<HTMLElement>("[data-menu-boundary]")?.getBoundingClientRect() ?? null;
      setContextMenu({ x, y, boundary, anchor: target });
    },
    [isSelectionMode, editing]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      e.preventDefault();
      openContextMenuAt(e.currentTarget, e.clientX, e.clientY);
    },
    [openContextMenuAt]
  );

  const highlighted = isSelectionMode ? isChecked : isSelected;
  const name = editing.displayName || t("session.summaryNotFound", "No summary");

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null);
  }, []);

  const overlays = (
    <>
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
          isFavorite={isFavorite}
          onToggleFavorite={() => void toggleSessionFavorite(session, project)}
        />
      )}

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
    </>
  );

  const favoriteMark = isFavorite && (
    <span title={t("session.favorite.starred")} className="shrink-0 text-warning">
      <Star className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
      <span className="sr-only">{t("session.favorite.starred")}</span>
    </span>
  );

  if (variant === "compact") {
    return (
      <div
        role="treeitem"
        aria-level={ariaLevel}
        aria-selected={highlighted}
        aria-checked={isSelectionMode ? isChecked : undefined}
        data-tree-node="session"
        data-row="session"
        data-session-path={session.file_path}
        tabIndex={-1}
        title={name}
        className={cn(
          "group w-full h-7 flex items-center gap-1.5 pl-7 pr-2 rounded-md text-list",
          "text-left outline-none cursor-pointer transition-colors",
          "focus-visible:ring-2 focus-visible:ring-accent",
          isSelectionMode && "select-none",
          highlighted
            ? "bg-accent/15 text-foreground"
            : "text-sidebar-foreground/75 hover:bg-muted/60 hover:text-foreground"
        )}
        onClick={activate}
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
        onKeyDown={(e) => {
          if (editing.isEditing) return;
          if (e.key === "Enter" || (e.key === " " && isSelectionMode)) {
            e.preventDefault();
            activate(e);
          } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
            e.preventDefault();
            const box = e.currentTarget.getBoundingClientRect();
            openContextMenuAt(e.currentTarget, box.left + 24, box.bottom);
          }
        }}
        onMouseEnter={() => {
          if (!editing.isEditing && onHover) onHover();
        }}
      >
        {isSelectionMode && (
          <span
            aria-hidden="true"
            className={cn(
              "-ml-5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
              isChecked ? "border-accent bg-accent text-accent-foreground" : "border-border"
            )}
          >
            {isChecked && <Check className="h-3.5 w-3.5" />}
          </span>
        )}
        {editing.isEditing ? (
          <SessionNameEditor
            isEditing
            editValue={editing.editValue}
            displayName={editing.displayName}
            hasCustomName={editing.hasCustomName}
            hasClaudeCodeName={editing.hasClaudeCodeName}
            isNamed={editing.isNamed}
            isSelected={isSelected}
            isContextMenuOpen={false}
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
        ) : (
          <span
            className={cn("min-w-0 flex-1 truncate", editing.isNamed && "font-semibold", isSelected && "font-medium")}
            onDoubleClick={editing.isServerReadOnly || isSelectionMode ? undefined : editing.handleDoubleClick}
          >
            {name}
          </span>
        )}
        {favoriteMark}
        <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
          {formatTimeAgo(session.last_modified)}
        </span>
        {!isSelectionMode && !editing.isEditing && (
          // The tap route to the row menu (a pointer right-clicks, the
          // keyboard presses ContextMenu / Shift+F10, so it stays out of the
          // tab order). 24px target. Its mousedown stops here, so a second
          // tap closes the menu instead of closing and reopening it.
          <button
            type="button"
            tabIndex={-1}
            aria-label={t("session.rowActions")}
            title={t("session.rowActions")}
            aria-haspopup="menu"
            aria-expanded={contextMenu !== null}
            className={cn(
              "hidden pointer-coarse:inline-flex size-6 shrink-0 items-center justify-center rounded",
              "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (contextMenu) {
                handleContextMenuClose();
                return;
              }
              const row = e.currentTarget.closest<HTMLElement>('[role="treeitem"]') ?? e.currentTarget;
              const box = e.currentTarget.getBoundingClientRect();
              openContextMenuAt(row, box.left, box.bottom);
            }}
          >
            <Ellipsis className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
        {overlays}
      </div>
    );
  }

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
      onClick={activate}
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
            aria-label={name}
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
            {isChecked && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
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
                "text-list leading-relaxed line-clamp-2 flex-1",
                editing.isNamed ? "font-bold" : "font-normal",
                highlighted ? "text-accent" : "text-sidebar-foreground/70"
              )}
            >
              {name}
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
          {favoriteMark}
        </div>
      </div>

      {/* Session Meta */}
      <SessionMeta
        session={session}
        isSelected={highlighted}
        formatTimeAgo={formatTimeAgo}
      />

      {overlays}
    </div>
  );
};
