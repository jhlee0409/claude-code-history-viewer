import React from "react";
import {
  Pencil,
  X,
  Check,
  RotateCcw,
  Link2,
  Terminal,
  Copy,
  FileText,
  Play,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
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
import type { SessionNameEditorProps } from "../types";

export const SessionNameEditor: React.FC<SessionNameEditorProps> = ({
  isEditing,
  editValue,
  displayName,
  hasCustomName,
  hasClaudeCodeName,
  isNamed,
  isSelected,
  isContextMenuOpen,
  providerId,
  supportsNativeRename,
  inputRef,
  ignoreBlurRef,
  onEditValueChange,
  onKeyDown,
  onSave,
  onCancel,
  onDoubleClick,
  onRenameClick,
  onResetCustomName,
  onNativeRenameClick,
  onCopySessionId,
  onCopyResumeCommand,
  onCopyFilePath,
  onContextMenuOpenChange,
}) => {
  const { t } = useTranslation();

  if (isEditing) {
    return (
      <div className="flex-1 flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => onEditValueChange(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (ignoreBlurRef.current) {
              ignoreBlurRef.current = false;
              return;
            }
            onSave();
          }}
          placeholder={t("session.renamePlaceholder", "Enter session name...")}
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
            onSave();
          }}
          className="p-1 rounded hover:bg-accent/20 text-accent"
          title={t("common.save")}
          aria-label={t("common.save")}
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
            onCancel();
          }}
          className="p-1 rounded hover:bg-destructive/20 text-destructive"
          title={t("common.cancel")}
          aria-label={t("common.cancel")}
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <>
      <span
        className={cn(
          "text-xs leading-relaxed line-clamp-2 transition-colors duration-300 flex-1 cursor-pointer flex items-start gap-1",
          isSelected ? "text-accent font-medium" : "text-sidebar-foreground/70"
        )}
        onDoubleClick={onDoubleClick}
        title={t("session.renameHint", "Double-click to rename")}
      >
        {hasClaudeCodeName && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20 transition-colors cursor-help shrink-0"
                aria-label={t(
                  "session.cliSync.title",
                  "Synced with Claude Code CLI"
                )}
              >
                <Link2
                  className="w-2.5 h-2.5 text-blue-400"
                  aria-hidden="true"
                />
                <span className="text-[9px] font-medium text-blue-400 uppercase tracking-wide">
                  {t("session.cliSync.badge", "CLI")}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <p className="font-medium">
                {t("session.cliSync.title", "Synced with Claude Code CLI")}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t(
                  "session.cliSync.description",
                  "This session is synchronized with your terminal"
                )}
              </p>
            </TooltipContent>
          </Tooltip>
        )}
        <span className={cn("flex-1", isNamed ? "font-bold" : "italic opacity-70")}>
          {displayName || t("session.summaryNotFound", "No summary")}
        </span>
      </span>

      {/* Context Menu for Rename */}
      <DropdownMenu
        open={isContextMenuOpen}
        onOpenChange={onContextMenuOpenChange}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "p-1 rounded opacity-40 md:opacity-0 md:group-hover:opacity-100 transition-opacity",
              "hover:bg-accent/20 text-muted-foreground hover:text-accent",
              isContextMenuOpen && "opacity-100"
            )}
            title={t("session.renameAction", "Rename session")}
            aria-label={t("session.renameAction", "Rename session")}
          >
            <Pencil className="w-3 h-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={onRenameClick}>
            <Pencil className="w-3 h-3 mr-2" />
            {t("session.renameMenuItem", "Rename")}
          </DropdownMenuItem>
          {hasCustomName && (
            <DropdownMenuItem onClick={onResetCustomName}>
              <RotateCcw className="w-3 h-3 mr-2" />
              {t("session.resetName", "Reset name")}
            </DropdownMenuItem>
          )}
          {supportsNativeRename && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onNativeRenameClick}>
                <Terminal className="w-3 h-3 mr-2" />
                {providerId === "opencode"
                  ? t(
                      "session.nativeRename.menuItemOpenCode",
                      "Rename in OpenCode"
                    )
                  : t(
                      "session.nativeRename.menuItem",
                      "Rename in Claude Code"
                    )}
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onCopySessionId}>
            <Copy className="w-3 h-3 mr-2" />
            {t("session.copySessionId", "Copy Session ID")}
          </DropdownMenuItem>
          {providerId === "claude" && (
            <DropdownMenuItem onClick={onCopyResumeCommand}>
              <Play className="w-3 h-3 mr-2" />
              {t("session.copyResumeCommand", "Copy Resume Command")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={onCopyFilePath}>
            <FileText className="w-3 h-3 mr-2" />
            {t("session.copyFilePath", "Copy File Path")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};
