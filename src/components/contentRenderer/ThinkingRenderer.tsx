import { useState } from "react";
import { Bot, ChevronRight, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";

type Props = {
  thinking: string;
};

export const ThinkingRenderer = ({ thinking }: Props) => {
  const { t } = useTranslation("components");
  const [isExpanded, setIsExpanded] = useState(false);

  if (!thinking) return null;

  const firstLine = thinking.split("\n")[0]?.slice(0, 100);
  const hasMore = firstLine && thinking.length > (firstLine.length || 0);

  return (
    <div className="bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-lg">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 p-3 text-left"
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
        )}
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
        <div className="px-3 pb-3 pt-0">
          <div className="text-sm text-amber-700 dark:text-amber-300 whitespace-pre-wrap">
            {thinking}
          </div>
        </div>
      )}
    </div>
  );
};
