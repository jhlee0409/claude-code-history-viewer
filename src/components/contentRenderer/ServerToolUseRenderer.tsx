import { memo } from "react";
import { Globe, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { safeStringify } from "../../utils/jsonUtils";

type Props = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export const ServerToolUseRenderer = memo(function ServerToolUseRenderer({
  id,
  name,
  input,
}: Props) {
  const { t } = useTranslation("components");

  const getIcon = () => {
    switch (name) {
      case "web_search":
        return <Globe className="w-4 h-4 text-blue-600" />;
      default:
        return <Wrench className="w-4 h-4 text-purple-600" />;
    }
  };

  const getTitle = () => {
    switch (name) {
      case "web_search":
        return t("serverToolUseRenderer.webSearch", {
          defaultValue: "Web Search",
        });
      default:
        return t("serverToolUseRenderer.serverTool", {
          defaultValue: "Server Tool: {name}",
          name,
        });
    }
  };

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
      <div className="flex items-center space-x-2 mb-2">
        {getIcon()}
        <span className="text-xs font-medium text-blue-800">{getTitle()}</span>
        <span className="text-xs text-blue-500 font-mono">{id}</span>
      </div>
      {name === "web_search" && input.query !== undefined && (
        <div className="text-sm text-blue-700">
          <span className="font-medium">
            {t("serverToolUseRenderer.query", { defaultValue: "Query" })}:
          </span>{" "}
          {String(input.query)}
        </div>
      )}
      {Object.keys(input).length > 0 &&
        !(name === "web_search" && Object.keys(input).length === 1) && (
          <details className="mt-2">
            <summary className="text-xs text-blue-600 cursor-pointer hover:text-blue-800">
              {t("serverToolUseRenderer.showInput", {
                defaultValue: "Show input parameters",
              })}
            </summary>
            <pre className="mt-2 text-xs text-blue-700 bg-blue-100 rounded p-2 overflow-x-auto">
              {safeStringify(input)}
            </pre>
          </details>
        )}
    </div>
  );
});
