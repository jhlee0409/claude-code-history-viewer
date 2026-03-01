import { useEffect } from "react";
import { CheckCircle, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { layout } from "@/components/renderers";
import { SUCCESS_NOTIFICATION_DURATION_MS } from "@/config/update.config";

interface UpToDateNotificationProps {
  currentVersion: string;
  onClose: () => void;
  isVisible: boolean;
}

export function UpToDateNotification({
  currentVersion,
  onClose,
  isVisible,
}: UpToDateNotificationProps) {
  const { t } = useTranslation();

  // Auto-dismiss after configured duration
  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(() => {
        onClose();
      }, SUCCESS_NOTIFICATION_DURATION_MS);

      return () => clearTimeout(timer);
    }
  }, [isVisible, onClose]);

  if (!isVisible) return null;

  return (
    <div
      className="fixed top-4 right-4 z-50 animate-in slide-in-from-right-full duration-300"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="bg-card rounded-lg shadow-lg border border-border p-4 min-w-80 max-w-sm">
        <div className="flex items-start space-x-3">
          <div className="p-2 rounded-full bg-success/10">
            <CheckCircle className="w-5 h-5 text-success" />
          </div>

          <div className="flex-1 min-w-0">
            <h3 className={`${layout.bodyText} font-semibold text-foreground`}>
              {t("upToDateNotification.upToDate")}
            </h3>
            <p className={`${layout.smallText} mt-1 text-foreground/80`}>
              {t("upToDateNotification.currentVersionLatest", {
                version: currentVersion,
              })}
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground"
            aria-label={t("common.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
