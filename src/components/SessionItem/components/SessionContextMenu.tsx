import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Pencil,
  RotateCcw,
  SquareTerminal,
  Copy,
  FileText,
  FolderOpen,
  Play,
  Star,
  StarOff,
  Trash,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { computeMenuPosition, type Boundary } from "@/utils/contextMenu";

interface SessionContextMenuProps {
  /**
   * `anchor` is the row the menu was opened on. With it, the menu stays in
   * the modal dialog holding the row, and only a scroll that
   * can move that row closes the menu; without it, any scroll does.
   */
  position: { x: number; y: number; boundary?: Boundary | null; anchor?: HTMLElement | null };
  hasCustomName: boolean;
  readOnly: boolean;
  supportsNativeRename: boolean;
  supportsResumeCommand: boolean;
  supportsSessionDeletion: boolean;
  supportsRevealInFinder: boolean;
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
  /** Starred (the sidebar's favourites). Omitted: no favourite item. */
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
}

export const SessionContextMenu: React.FC<SessionContextMenuProps> = ({
  position,
  hasCustomName,
  readOnly,
  supportsNativeRename,
  supportsResumeCommand,
  supportsSessionDeletion,
  supportsRevealInFinder,
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
  isFavorite = false,
  onToggleFavorite,
}) => {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);

  // Opened from the keyboard (ContextMenu / Shift+F10) or the pointer, the
  // menu takes focus so its items are reachable without a mouse.
  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);
  const [adjustedPosition, setAdjustedPosition] = useState({ x: position.x, y: position.y });

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  // Close on scroll or resize. Arm one animation frame after mount so a
  // synchronous scroll burst during the click-to-open sequence can't close
  // the menu immediately. Capture phase on scroll catches scroll on any
  // descendant (scroll events don't bubble, but capture flows root → target).
  // Only a scroll of the page or of a container holding the anchor row moves
  // the row away from the menu: the transcript scrolling beside the sidebar
  // (loading more, keeping its scroll anchor) must not close it.
  // removeEventListener must match the capture flag or the listener leaks.
  const anchor = position.anchor ?? null;
  // A row inside a modal dialog (the phone's sidebar drawer) keeps its menu
  // inside that dialog: portalled to <body> the menu sits under the drawer,
  // outside its focus trap, and the drawer takes every tap meant for it.
  const portalTarget = anchor?.closest<HTMLElement>('[role="dialog"]') ?? document.body;

  // Escape closes this menu only, and focus goes back to the row it was
  // opened on. Caught on the window in the capture phase, before anything
  // else sees it: a dialog holding the row (the phone's drawer) dismisses
  // on a document-level Escape, which would close it together with the
  // menu. With the menu gone, the next Escape reaches the drawer.
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
      if (anchor?.isConnected) anchor.focus();
    };
    window.addEventListener("keydown", handleEscape, { capture: true });
    return () => window.removeEventListener("keydown", handleEscape, { capture: true });
  }, [onClose, anchor]);
  useEffect(() => {
    let armed = false;
    const raf = requestAnimationFrame(() => {
      armed = true;
    });
    const handleScroll = (e: Event) => {
      if (!armed) return;
      if (anchor && e.target instanceof Node && !e.target.contains(anchor)) return;
      onClose();
    };
    const handleResize = () => {
      if (armed) onClose();
    };
    document.addEventListener("scroll", handleScroll, { capture: true, passive: true });
    window.addEventListener("resize", handleResize);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("scroll", handleScroll, { capture: true });
      window.removeEventListener("resize", handleResize);
    };
  }, [onClose, anchor]);

  useLayoutEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      setAdjustedPosition(
        computeMenuPosition(
          { x: position.x, y: position.y },
          { width: rect.width, height: rect.height },
          position.boundary,
        ),
      );
    }
  }, [position]);

  const menuItemClass = cn(
    "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-body",
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

  return createPortal(
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
      <div
        className="p-1"
        onKeyDown={(e) => {
          // Arrow keys move between the items (menu pattern).
          if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
          e.preventDefault();
          const items = Array.from(
            menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
          );
          const at = items.indexOf(document.activeElement as HTMLElement);
          const next = e.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
          items[next]?.focus();
        }}
      >
        {!readOnly && onToggleFavorite && (
          <>
            <button type="button" role="menuitem" onClick={handleAction(onToggleFavorite)} className={menuItemClass}>
              {isFavorite ? <StarOff className="w-3.5 h-3.5" /> : <Star className="w-3.5 h-3.5" />}
              <span>{isFavorite ? t("session.favorite.remove") : t("session.favorite.add")}</span>
            </button>
            <div className="my-1 border-t border-border/50" />
          </>
        )}
        {!readOnly && (
          <button type="button" role="menuitem" onClick={handleAction(onRenameClick)} className={menuItemClass}>
            <Pencil className="w-3.5 h-3.5" />
            <span>{t("session.renameMenuItem", "Rename")}</span>
          </button>
        )}

        {!readOnly && hasCustomName && (
          <button type="button" role="menuitem" onClick={handleAction(onResetCustomName)} className={menuItemClass}>
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{t("session.resetName", "Reset name")}</span>
          </button>
        )}

        {!readOnly && supportsNativeRename && (
          <>
            <div className="my-1 border-t border-border/50" />
            <button type="button" role="menuitem" onClick={handleAction(onNativeRenameClick)} className={menuItemClass}>
              <SquareTerminal className="w-3.5 h-3.5" />
              <span>
                {providerId === "opencode"
                  ? t("session.nativeRename.menuItemOpenCode", "Rename in OpenCode")
                  : providerId === "codex"
                    ? t("session.nativeRename.menuItemCodex", "Rename in Codex CLI")
                  : providerId === "forgecode"
                    ? t("session.nativeRename.menuItemForgeCode", "Rename in ForgeCode")
                    : t("session.nativeRename.menuItem", "Rename in Claude Code")}
              </span>
            </button>
          </>
        )}

        {!readOnly && <div className="my-1 border-t border-border/50" />}

        <button type="button" role="menuitem" onClick={handleAction(onCopySessionId)} className={menuItemClass}>
          <Copy className="w-3.5 h-3.5" />
          <span>{t("session.copySessionId", "Copy Session ID")}</span>
        </button>

        {supportsResumeCommand && (
          <button type="button" role="menuitem" onClick={handleAction(onCopyResumeCommand)} className={menuItemClass}>
            <Play className="w-3.5 h-3.5" />
            <span>{t("session.copyResumeCommand", "Copy Resume Command")}</span>
          </button>
        )}

        <button type="button" role="menuitem" onClick={handleAction(onCopyFilePath)} className={menuItemClass}>
          <FileText className="w-3.5 h-3.5" />
          <span>{t("session.copyFilePath", "Copy File Path")}</span>
        </button>

        {supportsRevealInFinder && (
          <button type="button" role="menuitem" onClick={handleAction(onRevealInFinder)} className={menuItemClass}>
            <FolderOpen className="w-3.5 h-3.5" />
            <span>{t("session.showJsonlFile", "Show JSONL File")}</span>
          </button>
        )}

        {supportsSessionDeletion && (
          <>
            <div className="my-1 border-t border-border/50" />

            <button
              type="button"
              role="menuitem"
              onClick={handleAction(onDeleteSession)}
              className={cn(menuItemClass, "text-destructive hover:text-destructive")}
            >
              <Trash className="w-3.5 h-3.5" />
              <span>{t("session.deleteSession", "Delete Session")}</span>
            </button>
          </>
        )}
      </div>
    </div>,
    portalTarget
  );
};
