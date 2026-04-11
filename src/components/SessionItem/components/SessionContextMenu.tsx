import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Pencil,
  RotateCcw,
  Terminal,
  Copy,
  FileText,
  FolderOpen,
  Play,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface SessionContextMenuProps {
  position: { x: number; y: number };
  hasCustomName: boolean;
  supportsNativeRename: boolean;
  providerId: string;
  onClose: () => void;
  onRenameClick: (e: React.MouseEvent) => void;
  onResetCustomName: () => void;
  onNativeRenameClick: (e: React.MouseEvent) => void;
  onCopySessionId: (e: React.MouseEvent) => void;
  onCopyResumeCommand: (e: React.MouseEvent) => void;
  onCopyFilePath: (e: React.MouseEvent) => void;
  onRevealInFinder: (e: React.MouseEvent) => void;
  onDeleteSession: (e: React.MouseEvent) => void;
}

export const SessionContextMenu: React.FC<SessionContextMenuProps> = ({
  position,
  hasCustomName,
  supportsNativeRename,
  providerId,
  onClose,
  onRenameClick,
  onResetCustomName,
  onNativeRenameClick,
  onCopySessionId,
  onCopyResumeCommand,
  onCopyFilePath,
  onRevealInFinder,
  onDeleteSession,
}) => {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState(position);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      let x = position.x;
      let y = position.y;
      if (x + rect.width > window.innerWidth) {
        x = window.innerWidth - rect.width - 8;
      }
      if (y + rect.height > window.innerHeight) {
        y = window.innerHeight - rect.height - 8;
      }
      x = Math.max(8, x);
      y = Math.max(8, y);
      setAdjustedPosition({ x, y });
    }
  }, [position]);

  const menuItemClass = cn(
    "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm",
    "hover:bg-accent hover:text-accent-foreground",
    "transition-colors cursor-pointer"
  );

  const handleAction = (handler: ((e: React.MouseEvent) => void) | (() => void)) => {
    return (e: React.MouseEvent) => {
      e.stopPropagation();
      handler(e);
      onClose();
    };
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className={cn(
        "fixed z-50 min-w-[200px] rounded-lg border shadow-lg",
        "bg-popover border-border",
        "animate-in fade-in-0 zoom-in-95 duration-100"
      )}
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
    >
      <div className="p-1">
        <button type="button" role="menuitem" onClick={handleAction(onRenameClick)} className={menuItemClass}>
          <Pencil className="w-3.5 h-3.5" />
          <span>{t("session.renameMenuItem", "Rename")}</span>
        </button>

        {hasCustomName && (
          <button type="button" role="menuitem" onClick={handleAction(onResetCustomName)} className={menuItemClass}>
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{t("session.resetName", "Reset name")}</span>
          </button>
        )}

        {supportsNativeRename && (
          <>
            <div className="my-1 border-t border-border/50" />
            <button type="button" role="menuitem" onClick={handleAction(onNativeRenameClick)} className={menuItemClass}>
              <Terminal className="w-3.5 h-3.5" />
              <span>
                {providerId === "opencode"
                  ? t("session.nativeRename.menuItemOpenCode", "Rename in OpenCode")
                  : t("session.nativeRename.menuItem", "Rename in Claude Code")}
              </span>
            </button>
          </>
        )}

        <div className="my-1 border-t border-border/50" />

        <button type="button" role="menuitem" onClick={handleAction(onCopySessionId)} className={menuItemClass}>
          <Copy className="w-3.5 h-3.5" />
          <span>{t("session.copySessionId", "Copy Session ID")}</span>
        </button>

        {providerId === "claude" && (
          <button type="button" role="menuitem" onClick={handleAction(onCopyResumeCommand)} className={menuItemClass}>
            <Play className="w-3.5 h-3.5" />
            <span>{t("session.copyResumeCommand", "Copy Resume Command")}</span>
          </button>
        )}

        <button type="button" role="menuitem" onClick={handleAction(onCopyFilePath)} className={menuItemClass}>
          <FileText className="w-3.5 h-3.5" />
          <span>{t("session.copyFilePath", "Copy File Path")}</span>
        </button>

        <button type="button" role="menuitem" onClick={handleAction(onRevealInFinder)} className={menuItemClass}>
          <FolderOpen className="w-3.5 h-3.5" />
          <span>{t("session.showJsonlFile", "Show JSONL File")}</span>
        </button>

        <div className="my-1 border-t border-border/50" />

        <button
          type="button"
          role="menuitem"
          onClick={handleAction(onDeleteSession)}
          className={cn(menuItemClass, "text-destructive hover:text-destructive")}
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>{t("session.deleteSession", "Delete Session")}</span>
        </button>
      </div>
    </div>
  );
};
