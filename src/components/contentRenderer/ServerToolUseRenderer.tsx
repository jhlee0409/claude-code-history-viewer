import { memo } from "react";
import { Globe, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { safeStringify } from "../../utils/jsonUtils";
import { layout } from "@/components/renderers/styles";
import { cn } from "@/lib/utils";

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
        return <Globe className={cn(layout.iconSize, "text-tool-web")} />;
      default:
        return <Wrench className={cn(layout.iconSize, "text-tool-mcp")} />;
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
    <div className={cn(layout.rounded, "border border-tool-web/30 bg-tool-web/10")}>
      <div className={cn("flex items-center justify-between", layout.headerPadding, layout.headerHeight)}>
        <div className={cn("flex items-center", layout.iconGap)}>
          {getIcon()}
          <span className={cn(layout.titleText, "text-foreground")}>{getTitle()}</span>
        </div>
        <div className={cn("flex items-center shrink-0", layout.iconGap, layout.smallText)}>
          <span className={cn(layout.monoText, "text-tool-web")}>{id}</span>
        </div>
      </div>
      <div className={layout.contentPadding}>
        {name === "web_search" && input.query !== undefined && (
          <div className={cn(layout.bodyText, "text-foreground")}>
            <span className="font-medium">
              {t("serverToolUseRenderer.query", { defaultValue: "Query" })}:
            </span>{" "}
            {String(input.query)}
          </div>
        )}
        {Object.keys(input).length > 0 &&
          !(name === "web_search" && Object.keys(input).length === 1) && (
            <details className="mt-2">
              <summary className={cn(layout.monoText, "text-tool-web cursor-pointer hover:text-tool-web/80")}>
                {t("serverToolUseRenderer.showInput", {
                  defaultValue: "Show input parameters",
                })}
              </summary>
              <pre className={cn(layout.monoText, "mt-2 text-foreground bg-muted rounded p-2 overflow-x-auto")}>
                {safeStringify(input)}
              </pre>
            </details>
          )}
      </div>
    </div>
  );
});
