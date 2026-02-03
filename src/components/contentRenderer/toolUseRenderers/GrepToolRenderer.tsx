import { memo } from "react";
import { FileSearch } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Renderer } from "@/shared/RendererHeader";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "@/components/renderers";

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
    <Renderer className={styles.container}>
      <Renderer.Header
        title={t("tools.grep", { defaultValue: "Grep" })}
        icon={<FileSearch className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={
          <div className={cn("flex items-center gap-2", layout.smallText)}>
            {input.output_mode && (
              <span className={cn("px-1.5 py-0.5", layout.rounded, styles.badge, styles.badgeText)}>
                {input.output_mode}
              </span>
            )}
            {toolId && (
              <code className={cn(layout.monoText, "px-2 py-0.5", layout.rounded, styles.badge, styles.badgeText)}>
                ID: {toolId}
              </code>
            )}
          </div>
        }
      />
      <Renderer.Content>
        <div className={cn("p-2 border bg-card border-border", layout.rounded, "space-y-1.5")}>
          <div className="flex items-start gap-2">
            <span className={cn(layout.smallText, "text-muted-foreground shrink-0 pt-0.5")}>pattern:</span>
            <code className={cn(layout.bodyText, "font-mono text-foreground break-all")}>{input.pattern ?? ""}</code>
          </div>
          {input.path && (
            <div className="flex items-center gap-2">
              <span className={cn(layout.smallText, "text-muted-foreground shrink-0")}>path:</span>
              <code className={cn(layout.bodyText, "font-mono text-info break-all")}>{input.path}</code>
            </div>
          )}
          {input.glob && (
            <div className="flex items-center gap-2">
              <span className={cn(layout.smallText, "text-muted-foreground shrink-0")}>glob:</span>
              <code className={cn(layout.bodyText, "font-mono text-foreground")}>{input.glob}</code>
            </div>
          )}
          {input.type && (
            <div className="flex items-center gap-2">
              <span className={cn(layout.smallText, "text-muted-foreground shrink-0")}>type:</span>
              <code className={cn(layout.bodyText, "font-mono text-foreground")}>{input.type}</code>
            </div>
          )}
          {flags.length > 0 && (
            <div className="flex items-center gap-2">
              <span className={cn(layout.smallText, "text-muted-foreground shrink-0")}>flags:</span>
              <div className="flex gap-1 flex-wrap">
                {flags.map((flag) => (
                  <span key={flag} className={cn("px-1.5 py-0.5 font-mono", layout.smallText, layout.rounded, "bg-muted text-muted-foreground")}>
                    {flag}
                  </span>
                ))}
              </div>
            </div>
          )}
          {input.head_limit != null && (
            <div className="flex items-center gap-2">
              <span className={cn(layout.smallText, "text-muted-foreground shrink-0")}>limit:</span>
              <code className={cn(layout.bodyText, "font-mono text-foreground")}>{input.head_limit}</code>
            </div>
          )}
        </div>
      </Renderer.Content>
    </Renderer>
  );
});
