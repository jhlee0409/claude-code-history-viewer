import { memo } from "react";
import { Server, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { safeStringify } from "../../utils/jsonUtils";

type Props = {
  id: string;
  serverName: string;
  toolName: string;
  input: Record<string, unknown>;
};

export const MCPToolUseRenderer = memo(function MCPToolUseRenderer({
  id,
  serverName,
  toolName,
  input,
}: Props) {
  const { t } = useTranslation("components");

  return (
    <div className="bg-violet-50 border border-violet-200 rounded-lg p-3">
      <div className="flex items-center space-x-2 mb-2">
        <Server className="w-4 h-4 text-violet-600" />
        <span className="text-xs font-medium text-violet-800">
          {t("mcpToolUseRenderer.title", { defaultValue: "MCP Tool" })}
        </span>
        <span className="text-xs text-violet-500 font-mono">{id}</span>
      </div>

      <div className="flex items-center space-x-2 mb-2">
        <Wrench className="w-3 h-3 text-violet-500" />
        <span className="text-sm text-violet-700">
          <span className="font-medium">{serverName}</span>
          <span className="mx-1 text-violet-400">/</span>
          <span>{toolName}</span>
        </span>
      </div>

      {Object.keys(input).length > 0 && (
        <details className="mt-2">
          <summary className="text-xs text-violet-600 cursor-pointer hover:text-violet-800">
            {t("mcpToolUseRenderer.showInput", {
              defaultValue: "Show input parameters",
            })}
          </summary>
          <pre className="mt-2 text-xs text-violet-700 bg-violet-100 rounded p-2 overflow-x-auto">
            {safeStringify(input)}
          </pre>
        </details>
      )}
    </div>
  );
});
