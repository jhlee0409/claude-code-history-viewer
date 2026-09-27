import { ChevronDown, Copy, Terminal, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ClaudeProject, ClaudeSession, ProviderId } from "@/types";
import { copyTextToClipboard } from "@/utils/clipboard";
import { getResumeCommand } from "@/utils/providers";
import { parseResumeArgs } from "@/utils/resumeArgs";
import { isProjectPathUnavailable } from "@/utils/pathUtils";
import { useAppStore } from "@/store/useAppStore";
import { useAnalyticsNavigation } from "@/hooks/analytics/useAnalyticsNavigation";

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
  const { userMetadata } = useAppStore();
  const { switchToSettings } = useAnalyticsNavigation();
  const providerId = (session.provider ?? project?.provider ?? "claude") as ProviderId;

  const rawArgs = userMetadata?.settings?.resumeCliArgs?.[providerId] ?? "";
  const { tokens } = parseResumeArgs(rawArgs);
  const hasCustomArgs = tokens.length > 0;

  const resumeCommand = isProjectPathUnavailable(project)
    ? null
    : getResumeCommand(
        providerId,
        session.actual_session_id,
        project?.actual_path,
        session.entrypoint,
        hasCustomArgs ? tokens.join(" ") : undefined,
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
          <>
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
              <Terminal className="mr-2 h-4 w-4 shrink-0" />
              <div className="flex flex-col text-left">
                <span>{t("session.copyResumeCommand", "Copy Resume Command")}</span>
                {hasCustomArgs && (
                  <span className="text-3xs text-muted-foreground">
                    {t("session.withCustomArguments", "with custom arguments")}
                  </span>
                )}
              </div>
            </DropdownMenuItem>
            {hasCustomArgs && (
              <DropdownMenuItem
                onSelect={() => {
                  switchToSettings();
                  setTimeout(() => {
                    window.dispatchEvent(
                      new CustomEvent("open-settings-section", {
                        detail: "session-resume",
                      })
                    );
                  }, 50);
                }}
                className="text-2xs text-muted-foreground hover:text-foreground"
              >
                <SlidersHorizontal className="mr-2 h-3.5 w-3.5" />
                <span>{t("session.editCustomArguments", "Edit custom arguments…")}</span>
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
