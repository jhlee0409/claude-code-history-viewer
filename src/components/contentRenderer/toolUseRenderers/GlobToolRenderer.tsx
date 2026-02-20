import { memo } from "react";
import { FolderSearch } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "@/components/renderers";
import { ToolUseCard, ToolUsePropertyRow } from "./ToolUseCard";

interface GlobToolInput {
  pattern?: string;
  path?: string;
}

interface Props {
  toolId: string;
  input: GlobToolInput;
}

export const GlobToolRenderer = memo(function GlobToolRenderer({ toolId, input }: Props) {
  const { t } = useTranslation();
  const styles = getVariantStyles("file");

  return (
    <ToolUseCard
      title={t("tools.glob")}
      icon={<FolderSearch className={cn(layout.iconSize, styles.icon)} />}
      variant="file"
      toolId={toolId}
    >
        <div className={cn("p-2 border bg-card border-border", layout.rounded, "space-y-1.5")}>
          <ToolUsePropertyRow label={t("renderers.globToolRenderer.pattern")} className="items-center">
            <code className={cn(layout.bodyText, "font-mono text-foreground")}>{input.pattern ?? ""}</code>
          </ToolUsePropertyRow>
          {input.path && (
            <ToolUsePropertyRow label={t("renderers.globToolRenderer.path")} className="items-center">
              <code className={cn(layout.bodyText, "font-mono text-info break-all")}>{input.path}</code>
            </ToolUsePropertyRow>
          )}
        </div>
    </ToolUseCard>
  );
});
