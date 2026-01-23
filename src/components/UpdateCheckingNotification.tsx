import { Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { layout } from "@/components/renderers";

interface UpdateCheckingNotificationProps {
  onClose: () => void;
  isVisible: boolean;
}

export function UpdateCheckingNotification({
  onClose,
  isVisible,
}: UpdateCheckingNotificationProps) {
  const { t } = useTranslation();

  if (!isVisible) return null;

  return (
    <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-right-full duration-300">
      <div className="bg-card rounded-lg shadow-lg border border-border p-4 min-w-80 max-w-sm">
        <div className="flex items-start space-x-3">
          <div className="p-2 rounded-full bg-blue-500/10">
            <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
          </div>

          <div className="flex-1 min-w-0">
            <h3 className={`${layout.bodyText} font-semibold text-foreground`}>
              {t("updateSettingsModal.checking")}
            </h3>
            <p className={`${layout.smallText} mt-1 text-foreground/80`}>
              {t("common.loading")}
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
