import { useEffect } from "react";
import { AlertCircle, X, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { layout } from "@/components/renderers";
import { ERROR_NOTIFICATION_DURATION_MS } from "@/config/update.config";

interface UpdateErrorNotificationProps {
  error: string;
  onClose: () => void;
  onRetry?: () => void;
  isVisible: boolean;
}

export function UpdateErrorNotification({
  error,
  onClose,
  onRetry,
  isVisible,
}: UpdateErrorNotificationProps) {
  const { t } = useTranslation();

  // Auto-dismiss after configured duration
  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(() => {
        onClose();
      }, ERROR_NOTIFICATION_DURATION_MS);

      return () => clearTimeout(timer);
    }
  }, [isVisible, onClose]);

  if (!isVisible) return null;

  return (
    <div
      className="fixed top-4 right-4 z-50 animate-in slide-in-from-right-full duration-300"
      role="status"
      aria-live="assertive"
      aria-atomic="true"
    >
      <div className="bg-card rounded-lg shadow-lg border border-destructive/50 p-4 min-w-80 max-w-sm">
        <div className="flex items-start space-x-3">
          <div className="p-2 rounded-full bg-destructive/10">
            <AlertCircle className="w-5 h-5 text-destructive" />
          </div>

          <div className="flex-1 min-w-0">
            <h3 className={`${layout.bodyText} font-semibold text-foreground`}>
              {t("common.error.updateCheckFailed")}
            </h3>
            <p className={`${layout.smallText} mt-1 text-foreground/80 line-clamp-2`}>
              {error}
            </p>
            {onRetry && (
              <button
                onClick={() => {
                  onClose();
                  onRetry();
                }}
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {t("common.retry")}
              </button>
            )}
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
