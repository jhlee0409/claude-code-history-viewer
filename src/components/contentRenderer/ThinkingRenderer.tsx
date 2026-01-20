import { useState } from "react";
import { Bot, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../utils/cn";

type Props = {
  thinking: string;
};

export const ThinkingRenderer = ({ thinking }: Props) => {
  const { t } = useTranslation("components");
  const [isExpanded, setIsExpanded] = useState(false);

  if (!thinking) return null;

  const firstLine = thinking.split("\n")[0]?.slice(0, 100) || "";
  const hasMore = thinking.length > firstLine.length || thinking.includes("\n");

  return (
    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg mt-2 overflow-hidden">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-left",
          "hover:bg-amber-100/50 dark:hover:bg-amber-900/30 transition-colors"
        )}
      >
        <ChevronRight
          className={cn(
            "w-4 h-4 shrink-0 transition-transform duration-200 text-amber-500 dark:text-amber-400",
            isExpanded && "rotate-90"
          )}
        />
        <Bot className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
        <span className="text-xs font-medium text-amber-800 dark:text-amber-200">
          {t("thinkingRenderer.title")}
        </span>
        {!isExpanded && (
          <span className="text-xs text-amber-600 dark:text-amber-400 truncate italic">
            {firstLine}
            {hasMore && "..."}
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="px-3 pb-3">
          <div className="text-sm text-amber-700 dark:text-amber-300 whitespace-pre-wrap">
            {thinking}
          </div>
        </div>
      )}
    </div>
  );
};
