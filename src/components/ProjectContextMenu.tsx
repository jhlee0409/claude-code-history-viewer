// src/components/ProjectContextMenu.tsx
import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { EyeOff, Eye, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ClaudeProject } from "../types";
import { computeMenuPosition, type Boundary } from "@/utils/contextMenu";

interface ProjectContextMenuProps {
  project: ClaudeProject;
  position: { x: number; y: number; boundary?: Boundary | null };
  onClose: () => void;
  onHide: (projectPath: string) => void;
  onUnhide: (projectPath: string) => void;
  isHidden: boolean;
}

export const ProjectContextMenu: React.FC<ProjectContextMenuProps> = ({
  project,
  position,
  onClose,
  onHide,
  onUnhide,
  isHidden,
}) => {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState({ x: position.x, y: position.y });

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  // Close on scroll or resize. Arm one animation frame after mount so a
  // synchronous scroll burst during the click-to-open sequence can't close
  // the menu immediately. Capture phase on scroll catches scroll on any
  // descendant (scroll events don't bubble, but capture flows root → target).
  // removeEventListener must match the capture flag or the listener leaks.
  useEffect(() => {
    let armed = false;
    const raf = requestAnimationFrame(() => {
      armed = true;
    });
    const handleScroll = () => {
      if (armed) onClose();
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
  }, [onClose]);

  // Adjust position if the menu would overflow the boundary (or viewport if absent).
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

  const handleCopyPath = async () => {
    const path = project.actual_path?.trim();
    if (!path) {
      toast.error(t("error.clipboardFailed"));
      onClose();
      return;
    }
    try {
      await navigator.clipboard.writeText(path);
      toast.success(t("project.pathCopied"));
    } catch (err) {
      console.error("Failed to copy path:", err);
      toast.error(t("error.clipboardFailed"));
    }
    onClose();
  };

  const handleHideClick = () => {
    if (isHidden) {
      onUnhide(project.actual_path);
    } else {
      onHide(project.actual_path);
    }
    onClose();
  };

  const menuItemClass = cn(
    "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm",
    "hover:bg-accent hover:text-accent-foreground",
    "transition-colors cursor-pointer"
  );

  return createPortal(
    <div
      ref={menuRef}
      className={cn(
        "fixed z-50 min-w-[180px] rounded-lg border shadow-lg",
        "bg-popover border-border",
        "animate-in fade-in-0 zoom-in-95 duration-100"
      )}
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
      }}
    >
      <div className="p-1">
        {/* Project name header */}
        <div className="px-2 py-1.5 text-xs text-muted-foreground truncate border-b border-border mb-1">
          {project.name}
        </div>

        {/* Copy path option */}
        <button
          onClick={handleCopyPath}
          className={menuItemClass}
        >
          <Copy className="w-4 h-4" />
          <span>{t("project.copyPath")}</span>
        </button>

        {/* Hide/Unhide option */}
        <button
          onClick={handleHideClick}
          className={menuItemClass}
        >
          {isHidden ? (
            <>
              <Eye className="w-4 h-4" />
              <span>{t("project.unhide", "Show project")}</span>
            </>
          ) : (
            <>
              <EyeOff className="w-4 h-4" />
              <span>{t("project.hide", "Hide project")}</span>
            </>
          )}
        </button>
      </div>
    </div>,
    document.body
  );
};
