import { ChevronDown, Copy, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ClaudeProject, ClaudeSession } from "@/types";
import { copyTextToClipboard } from "@/utils/clipboard";
import { getResumeCommand } from "@/utils/providers";

interface SessionCopyMenuProps {
  project: ClaudeProject | null;
  session: ClaudeSession;
  compact?: boolean;
}

export const SessionCopyMenu = ({
  project,
  session,
  compact = false,
}: SessionCopyMenuProps) => {
  const { t } = useTranslation();
  const providerId = session.provider ?? project?.provider ?? "claude";
  const resumeCommand = getResumeCommand(
    providerId,
    session.actual_session_id,
    project?.actual_path,
    session.entrypoint,
  );
  const copySessionIdLabel = t("session.copySessionId", "Copy Session ID");
  const triggerLabel = `${resumeCommand
    ? `${copySessionIdLabel} / ${t("session.copyResumeCommand", "Copy Resume Command")}`
    : copySessionIdLabel}…`;

  const copyToClipboard = async (text: string, successMessage: string) => {
    try {
      await copyTextToClipboard(text);
      toast.success(successMessage);
    } catch {
      toast.error(t("copyButton.error", "Copy failed"));
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={triggerLabel}
          title={triggerLabel}
          className={cn(
            "inline-flex items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            compact ? "p-2" : "gap-1.5 px-2 py-1 text-2xs font-mono",
          )}
        >
          <Terminal className={compact ? "h-4 w-4" : "h-3.5 w-3.5"} />
          {!compact && (
            <>
              <span>{session.actual_session_id.slice(0, 8)}</span>
              <ChevronDown className="h-3 w-3 opacity-60" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => {
            void copyToClipboard(
              session.actual_session_id,
              t("session.copiedSessionId", "Session ID copied"),
            );
          }}
        >
          <Copy className="mr-2 h-4 w-4" />
          {copySessionIdLabel}
        </DropdownMenuItem>
        {resumeCommand && (
          <DropdownMenuItem
            onSelect={() => {
              void copyToClipboard(
                resumeCommand,
                project?.actual_path
                  ? t("session.copiedResumeCommand", "Resume command copied")
                  : t(
                      "session.copiedResumeCommandNoCwd",
                      "Resume command copied (working directory unknown)",
                    ),
              );
            }}
          >
            <Terminal className="mr-2 h-4 w-4" />
            {t("session.copyResumeCommand", "Copy Resume Command")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
