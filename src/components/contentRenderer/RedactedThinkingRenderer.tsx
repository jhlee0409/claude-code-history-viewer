import { memo } from "react";
import { ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { layout } from "@/components/renderers";
import { cn } from "@/lib/utils";
import { ToolResultCard } from "./ToolResultCard";

type Props = {
  data: string;
};

export const RedactedThinkingRenderer = memo(function RedactedThinkingRenderer({
  data,
}: Props) {
  const { t } = useTranslation();

  return (
    <ToolResultCard
      title={t("redactedThinkingRenderer.title")}
      icon={<ShieldAlert className={cn(layout.iconSize, "text-muted-foreground")} />}
      variant="neutral"
    >
      <div className={cn(layout.bodyText, "text-muted-foreground italic")}>
        {t("redactedThinkingRenderer.description")}
      </div>
      <div className={cn("mt-2 text-muted-foreground/60 bg-secondary rounded p-2 overflow-x-auto", layout.monoText)}>
        <span className="opacity-50">
          {data.length > 100 ? `${data.substring(0, 100)}...` : data}
        </span>
      </div>
    </ToolResultCard>
  );
});
