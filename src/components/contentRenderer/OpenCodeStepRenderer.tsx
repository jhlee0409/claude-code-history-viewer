import { memo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "../renderers";
import { Activity, Hash, Coins, ArrowDownToLine, ArrowUpFromLine, Brain, Database } from "lucide-react";

interface OpenCodeStepProps {
  reason: string;
  snapshot: string;
  cost: number;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cache_read: number;
    cache_write: number;
  };
}

export const OpenCodeStepRenderer = memo<OpenCodeStepProps>(
  ({ reason, snapshot, cost, tokens }) => {
    const { t } = useTranslation();
    const styles = getVariantStyles("system");
    const hasTokens = tokens.input + tokens.output + tokens.reasoning + tokens.cache_read + tokens.cache_write > 0;

    return (
      <div className={cn("border", layout.rounded, styles.container)}>
        <div className={cn("flex items-center justify-between", layout.containerPadding, "pb-0")}>
          <div className="flex items-center gap-1.5">
            <Activity size={14} className={styles.title} />
            <span className={cn(layout.smallText, "font-semibold", styles.title)}>
              {t("renderers.opencodeStep.title")}
            </span>
            {snapshot && (
              <code className="text-[10px] px-1.5 py-0.5 bg-background rounded border border-border font-mono text-muted-foreground">
                <Hash size={10} className="inline mr-0.5" />
                {snapshot}
              </code>
            )}
          </div>
          {hasTokens && (
            <span className={cn(layout.smallText, "font-mono text-muted-foreground")}>
              <Coins size={10} className="inline mr-0.5" />
              ${cost.toFixed(4)}
            </span>
          )}
        </div>

        <span className={cn(layout.bodyText, layout.containerPadding, "pt-1 pb-1.5 block text-muted-foreground")}>
          {t(`renderers.opencodeStep.reason.${reason}`, { defaultValue: reason })}
        </span>

        {hasTokens && (
          <div className={cn(
            "flex flex-wrap gap-x-3 gap-y-0.5 border-t border-border/50",
            layout.containerPadding, "py-1.5 bg-muted/20"
          )}>
            <TokenBadge icon={ArrowDownToLine} label={t("renderers.opencodeStep.tokens.input")} value={tokens.input} />
            <TokenBadge icon={ArrowUpFromLine} label={t("renderers.opencodeStep.tokens.output")} value={tokens.output} />
            {tokens.reasoning > 0 && (
              <TokenBadge icon={Brain} label={t("renderers.opencodeStep.tokens.reasoning")} value={tokens.reasoning} />
            )}
            {(tokens.cache_read > 0 || tokens.cache_write > 0) && (
              <TokenBadge icon={Database} label={t("renderers.opencodeStep.tokens.cache")} value={tokens.cache_read + tokens.cache_write} />
            )}
          </div>
        )}
      </div>
    );
  }
);

OpenCodeStepRenderer.displayName = "OpenCodeStepRenderer";

function TokenBadge({ icon: Icon, label, value }: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; value: number }) {
  if (value === 0) return null;
  return (
    <span className="text-[10px] text-muted-foreground font-mono flex items-center gap-0.5">
      <Icon size={10} />
      {label}: {value.toLocaleString()}
    </span>
  );
}
