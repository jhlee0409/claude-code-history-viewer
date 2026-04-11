import React, { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { NativeRenameDialog } from "@/components/NativeRenameDialog";
import { useSessionEditing } from "./hooks/useSessionEditing";
import { SessionHeader } from "./components/SessionHeader";
import { SessionNameEditor } from "./components/SessionNameEditor";
import { SessionContextMenu } from "./components/SessionContextMenu";
import { SessionMeta } from "./components/SessionMeta";
import type { SessionItemProps } from "./types";

export const SessionItem: React.FC<SessionItemProps> = ({
  session,
  isSelected,
  onSelect,
  onHover,
  formatTimeAgo,
}) => {
  const editing = useSessionEditing(session);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleClick = useCallback(() => {
    if (!editing.isEditing && !isSelected) {
      onSelect();
    }
  }, [editing.isEditing, isSelected, onSelect]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      editing.setIsContextMenuOpen(false);
      setContextMenu({ x: e.clientX, y: e.clientY });
    },
    [editing]
  );

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null);
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
      onContextMenu={handleContextMenu}
      onMouseEnter={() => {
        if (!editing.isEditing && onHover) {
          onHover();
        }
      }}
    >
      {/* Session Header */}
      <div className="flex items-start gap-2.5">
        <SessionHeader
          isArchivedCodexSession={editing.isArchivedCodexSession}
          isSelected={isSelected}
        />

        {/* Session Name / Edit Mode */}
        <div className="flex-1 min-w-0 flex items-start gap-1">
          <SessionNameEditor
            isEditing={editing.isEditing}
            editValue={editing.editValue}
            displayName={editing.displayName}
            hasCustomName={editing.hasCustomName}
            hasClaudeCodeName={editing.hasClaudeCodeName}
            isNamed={editing.isNamed}
            isSelected={isSelected}
            isContextMenuOpen={editing.isContextMenuOpen}
            providerId={editing.providerId}
            supportsNativeRename={editing.supportsNativeRename}
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
        </div>
      </div>

      {/* Session Meta */}
      <SessionMeta
        session={session}
        isSelected={isSelected}
        formatTimeAgo={formatTimeAgo}
      />

      {/* Right-click Context Menu */}
      {contextMenu && (
        <SessionContextMenu
          position={contextMenu}
          hasCustomName={editing.hasCustomName}
          supportsNativeRename={editing.supportsNativeRename}
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
        provider={editing.providerId}
        onSuccess={editing.handleNativeRenameSuccess}
      />
    </div>
  );
};
