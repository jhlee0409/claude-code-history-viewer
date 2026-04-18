// src/components/ProjectContextMenu.tsx
import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { EyeOff, Eye, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ClaudeProject } from "../types";

interface ProjectContextMenuProps {
  project: ClaudeProject;
  position: { x: number; y: number };
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
  const [adjustedPosition, setAdjustedPosition] = useState(position);

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

  // Adjust position if menu would go off-screen
  useLayoutEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;

      let x = position.x;
      let y = position.y;

      if (x + rect.width > windowWidth) {
        x = windowWidth - rect.width - 8;
      }
      if (y + rect.height > windowHeight) {
        y = windowHeight - rect.height - 8;
      }

      x = Math.max(8, x);
      y = Math.max(8, y);

      setAdjustedPosition({ x, y });
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
