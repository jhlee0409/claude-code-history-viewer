import { useEffect } from "react";
import { AlertCircle, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { layout } from "@/components/renderers";

interface UpdateErrorNotificationProps {
  error: string;
  onClose: () => void;
  isVisible: boolean;
}

export function UpdateErrorNotification({
  error,
  onClose,
  isVisible,
}: UpdateErrorNotificationProps) {
  const { t } = useTranslation();

  // 5초 후 자동으로 사라지기
  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(() => {
        onClose();
      }, 5000);

      return () => clearTimeout(timer);
    }
  }, [isVisible, onClose]);

  if (!isVisible) return null;

  return (
    <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-right-full duration-300">
      <div className="bg-card rounded-lg shadow-lg border border-destructive/50 p-4 min-w-80 max-w-sm">
        <div className="flex items-start space-x-3">
          <div className="p-2 rounded-full bg-destructive/10">
            <AlertCircle className="w-5 h-5 text-destructive" />
          </div>

          <div className="flex-1 min-w-0">
            <h3 className={`${layout.bodyText} font-semibold text-foreground`}>
              {t("common.error.updateCheckFailed")}
            </h3>
            <p className={`${layout.smallText} mt-1 text-foreground/80 truncate`}>
              {error}
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
