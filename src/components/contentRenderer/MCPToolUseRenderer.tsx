import { memo } from "react";
import { Server, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { layout } from "@/components/renderers";
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
    <div className={cn(layout.rounded, "bg-tool-mcp/10 border border-tool-mcp/30", layout.containerPadding)}>
      <div className={cn("flex items-center mb-2", layout.iconSpacing)}>
        <Server className={cn(layout.iconSize, "text-tool-mcp")} />
        <span className={cn(layout.titleText, "text-foreground")}>
          {t("mcpToolUseRenderer.title", { defaultValue: "MCP Tool" })}
        </span>
        <span className={cn(layout.monoText, "text-tool-mcp")}>{id}</span>
      </div>

      <div className={cn("flex items-center mb-2", layout.iconSpacing)}>
        <Wrench className={cn(layout.iconSizeSmall, "text-tool-mcp")} />
        <span className={cn(layout.bodyText, "text-foreground")}>
          <span className="font-medium">{serverName}</span>
          <span className="mx-1 text-muted-foreground">/</span>
          <span>{toolName}</span>
        </span>
      </div>

      {Object.keys(input).length > 0 && (
        <details className="mt-2">
          <summary className={cn(layout.smallText, "text-tool-mcp cursor-pointer hover:text-tool-mcp/80")}>
            {t("mcpToolUseRenderer.showInput", {
              defaultValue: "Show input parameters",
            })}
          </summary>
          <pre className={cn("mt-2 text-foreground bg-muted p-2 overflow-x-auto", layout.monoText, layout.rounded)}>
            {safeStringify(input)}
          </pre>
        </details>
      )}
    </div>
  );
});
