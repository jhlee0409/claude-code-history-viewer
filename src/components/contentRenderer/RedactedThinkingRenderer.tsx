import { memo } from "react";
import { ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

type Props = {
  data: string;
};

export const RedactedThinkingRenderer = memo(function RedactedThinkingRenderer({
  data,
}: Props) {
  const { t } = useTranslation("components");

  return (
    <div className="bg-gray-100 border border-gray-300 rounded-lg p-3">
      <div className="flex items-center space-x-2 mb-2">
        <ShieldAlert className="w-4 h-4 text-gray-500" />
        <span className="text-xs font-medium text-gray-600">
          {t("redactedThinkingRenderer.title", {
            defaultValue: "Redacted Thinking",
          })}
        </span>
      </div>
      <div className="text-sm text-gray-500 italic">
        {t("redactedThinkingRenderer.description", {
          defaultValue:
            "This thinking content has been encrypted by safety systems.",
        })}
      </div>
      <div className="mt-2 text-xs text-gray-400 font-mono bg-gray-200 rounded p-2 overflow-x-auto">
        <span className="opacity-50">
          {data.length > 100 ? `${data.substring(0, 100)}...` : data}
        </span>
      </div>
    </div>
  );
});
