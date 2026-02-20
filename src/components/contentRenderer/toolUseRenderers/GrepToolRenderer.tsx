import { memo } from "react";
import { FileSearch } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "@/components/renderers";
import { ToolUseCard, ToolUsePropertyRow } from "./ToolUseCard";

interface GrepToolInput {
  pattern?: string;
  path?: string;
  output_mode?: string;
  glob?: string;
  type?: string;
  "-i"?: boolean;
  "-n"?: boolean;
  "-A"?: number;
  "-B"?: number;
  "-C"?: number;
  head_limit?: number;
  multiline?: boolean;
}

interface Props {
  toolId: string;
  input: GrepToolInput;
}

export const GrepToolRenderer = memo(function GrepToolRenderer({ toolId, input }: Props) {
  const { t } = useTranslation();
  const styles = getVariantStyles("search");

  const flags: string[] = [];
  if (input["-i"]) flags.push("-i");
  if (input["-n"] !== false && input["-n"] != null) flags.push("-n");
  if (input.multiline) flags.push("--multiline");
  if (input["-A"] != null) flags.push(`-A ${input["-A"]}`);
  if (input["-B"] != null) flags.push(`-B ${input["-B"]}`);
  if (input["-C"] != null) flags.push(`-C ${input["-C"]}`);

  return (
    <ToolUseCard
      title={t("tools.grep")}
      icon={<FileSearch className={cn(layout.iconSize, styles.icon)} />}
      variant="search"
      toolId={toolId}
      rightContent={
        input.output_mode ? (
          <span className={cn("px-1.5 py-0.5", layout.rounded, styles.badge, styles.badgeText)}>
            {input.output_mode}
          </span>
        ) : null
      }
    >
      <div className={cn("p-2 border bg-card border-border", layout.rounded, "space-y-1.5")}>
        <ToolUsePropertyRow label={t("rendererLabels.pattern")}>
          <code className={cn(layout.bodyText, "font-mono text-foreground break-all")}>{input.pattern ?? ""}</code>
        </ToolUsePropertyRow>
        {input.path && (
          <ToolUsePropertyRow label={t("rendererLabels.path")} className="items-center">
            <code className={cn(layout.bodyText, "font-mono text-info break-all")}>{input.path}</code>
          </ToolUsePropertyRow>
        )}
        {input.glob && (
          <ToolUsePropertyRow label={t("rendererLabels.glob")} className="items-center">
            <code className={cn(layout.bodyText, "font-mono text-foreground")}>{input.glob}</code>
          </ToolUsePropertyRow>
        )}
        {input.type && (
          <ToolUsePropertyRow label={t("rendererLabels.type")} className="items-center">
            <code className={cn(layout.bodyText, "font-mono text-foreground")}>{input.type}</code>
          </ToolUsePropertyRow>
        )}
        {flags.length > 0 && (
          <ToolUsePropertyRow label={t("rendererLabels.flags")} className="items-center">
            <div className="flex gap-1 flex-wrap">
              {flags.map((flag) => (
                <span key={flag} className={cn("px-1.5 py-0.5 font-mono", layout.smallText, layout.rounded, "bg-muted text-muted-foreground")}>
                  {flag}
                </span>
              ))}
            </div>
          </ToolUsePropertyRow>
        )}
        {input.head_limit != null && (
          <ToolUsePropertyRow label={t("rendererLabels.limit")} className="items-center">
            <code className={cn(layout.bodyText, "font-mono text-foreground")}>{input.head_limit}</code>
          </ToolUsePropertyRow>
        )}
      </div>
    </ToolUseCard>
  );
});
