import { memo } from "react";
import { ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { layout } from "@/components/renderers";
import { cn } from "@/lib/utils";

type Props = {
  data: string;
};

export const RedactedThinkingRenderer = memo(function RedactedThinkingRenderer({
  data,
}: Props) {
  const { t } = useTranslation("components");

  return (
    <div className={cn(layout.rounded, "border border-border bg-muted")}>
      <div className={cn("flex items-center justify-between", layout.headerPadding, layout.headerHeight)}>
        <div className={cn("flex items-center", layout.iconGap)}>
          <ShieldAlert className={cn(layout.iconSize, "text-muted-foreground")} />
          <span className={cn(layout.titleText, "text-muted-foreground")}>
            {t("redactedThinkingRenderer.title", {
              defaultValue: "Redacted Thinking",
            })}
          </span>
        </div>
      </div>
      <div className={layout.contentPadding}>
        <div className={cn(layout.bodyText, "text-muted-foreground italic")}>
          {t("redactedThinkingRenderer.description", {
            defaultValue:
              "This thinking content has been encrypted by safety systems.",
          })}
        </div>
        <div className={cn("mt-2 text-muted-foreground/60 bg-secondary rounded p-2 overflow-x-auto", layout.monoText)}>
          <span className="opacity-50">
            {data.length > 100 ? `${data.substring(0, 100)}...` : data}
          </span>
        </div>
      </div>
    </div>
  );
});
