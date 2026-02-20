import { memo } from "react";
import { Globe, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { safeStringify } from "../../utils/jsonUtils";
import { getVariantStyles, layout } from "@/components/renderers";
import { cn } from "@/lib/utils";
import { ToolUseCard } from "./toolUseRenderers/ToolUseCard";

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
  const { t } = useTranslation();
  const variant = name === "web_search" ? "web" : "mcp";
  const styles = getVariantStyles(variant);

  const getIcon = () => {
    switch (name) {
      case "web_search":
        return <Globe className={cn(layout.iconSize, styles.icon)} />;
      default:
        return <Wrench className={cn(layout.iconSize, styles.icon)} />;
    }
  };

  const getTitle = () => {
    switch (name) {
      case "web_search":
        return t("serverToolUseRenderer.webSearch");
      default:
        return t("serverToolUseRenderer.serverTool", {name,
        });
    }
  };

  return (
    <ToolUseCard
      title={getTitle()}
      icon={getIcon()}
      variant={variant}
      toolId={id}
    >
      {name === "web_search" && input.query !== undefined && (
        <div className={cn(layout.bodyText, "text-foreground")}>
          <span className="font-medium">
            {t("serverToolUseRenderer.query")}:
          </span>{" "}
          {String(input.query)}
        </div>
      )}
      {Object.keys(input).length > 0 &&
        !(name === "web_search" && Object.keys(input).length === 1) && (
          <details className="mt-2">
            <summary className={cn(layout.monoText, styles.accent, "cursor-pointer hover:opacity-80")}>
              {t("serverToolUseRenderer.showInput")}
            </summary>
            <pre className={cn(layout.monoText, "mt-2 text-foreground bg-muted rounded p-2 overflow-x-auto")}>
              {safeStringify(input)}
            </pre>
          </details>
        )}
    </ToolUseCard>
  );
});
