import { CheckCircle2, Clock3, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { layout } from "../../renderers";
import type { ToolResultLike } from "./shared";
import { isError } from "./shared";

export function StatusBadge({ results }: { results: ToolResultLike[] }) {
  const { t } = useTranslation();
  const hasResult = results.length > 0;
  const hasError = hasResult && results.some(isError);
  if (hasError) return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded", layout.smallText, "bg-destructive/20 text-destructive")}>
      <AlertTriangle className={layout.iconSizeSmall} />{t("common.error")}
    </span>
  );
  if (!hasResult) return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded", layout.smallText, "bg-warning/20 text-warning")}>
      <Clock3 className={layout.iconSizeSmall} />{t("common.pending")}
    </span>
  );
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded", layout.smallText, "bg-success/20 text-success")}>
      <CheckCircle2 className={layout.iconSizeSmall} />{t("common.completed")}
    </span>
  );
}
