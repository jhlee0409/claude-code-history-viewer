import { memo } from "react";
import { FileText, Link2 } from "lucide-react";
import { useTranslation } from "react-i18next";

type Props = {
  summary?: string;
  leafUuid?: string;
};

export const SummaryMessageRenderer = memo(function SummaryMessageRenderer({
  summary,
  leafUuid,
}: Props) {
  const { t } = useTranslation("components");

  if (!summary) {
    return null;
  }

  return (
    <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 text-sm">
      <div className="flex items-start space-x-2">
        <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-emerald-700 dark:text-emerald-300 mb-1">
            {t("summaryMessageRenderer.title", { defaultValue: "Conversation Summary" })}
          </div>
          <div className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words">
            {summary}
          </div>
          {leafUuid && (
            <div className="mt-2 flex items-center space-x-1 text-xs text-gray-500 dark:text-gray-400">
              <Link2 className="w-3 h-3" />
              <span className="font-mono truncate" title={leafUuid}>
                {leafUuid.slice(0, 8)}...
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
