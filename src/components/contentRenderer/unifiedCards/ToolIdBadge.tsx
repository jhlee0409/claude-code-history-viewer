import { useCallback, useState } from "react";
import { Check, Hash } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { layout } from "../../renderers";
import { HighlightedText } from "../../common/HighlightedText";
import { copyTextToClipboard } from "@/utils/clipboard";

interface ToolIdBadgeProps {
  toolId: string;
  /** When set (Tool ID search mode) the full id is shown and highlighted. */
  searchQuery?: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
  badgeClassName?: string;
  badgeTextClassName?: string;
}

/**
 * Tool-call id affordance for card headers. The raw `toolu_…` string is noise
 * for reading a transcript, so by default it collapses to a copy button whose
 * tooltip carries the id; the full text only appears while searching by id.
 */
export function ToolIdBadge({
  toolId,
  searchQuery,
  isCurrentMatch = false,
  currentMatchIndex = 0,
  badgeClassName,
  badgeTextClassName,
}: ToolIdBadgeProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await copyTextToClipboard(toolId);
    } catch {
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [toolId]);

  if (!toolId) return null;

  if (searchQuery) {
    return (
      <code
        className={cn(
          layout.monoText,
          "hidden md:inline px-2 py-0.5",
          layout.rounded,
          badgeClassName,
          badgeTextClassName,
        )}
      >
        <HighlightedText
          text={`${t("common.id")}: ${toolId}`}
          searchQuery={searchQuery}
          isCurrentMatch={isCurrentMatch}
          currentMatchIndex={currentMatchIndex}
        />
      </code>
    );
  }

  const label = `${t("common.copy")} ${t("common.id")}: ${toolId}`;
  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? t("common.copied") : label}
      aria-label={label}
      className={cn(
        "w-6 h-6 flex items-center justify-center rounded transition-colors",
        copied ? "text-success" : "text-muted-foreground/60 hover:text-foreground hover:bg-muted",
      )}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Hash className="w-3.5 h-3.5" />}
    </button>
  );
}
