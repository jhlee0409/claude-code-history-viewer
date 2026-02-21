import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
} from "@/components/ui";
import { LoadingSpinner, LoadingProgress } from "@/components/ui/loading";
import { Download, AlertTriangle, X, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from "sonner";
import type { UseUpdaterReturn } from '@/hooks/useUpdater';
import { resolveUpdateErrorMessage } from '@/utils/updateError';

interface SimpleUpdateModalProps {
  updater: UseUpdaterReturn;
  isVisible: boolean;
  onClose: () => void;
  onRemindLater: () => Promise<void> | void;
  onSkipVersion: () => Promise<void> | void;
}

export function SimpleUpdateModal({
  updater,
  isVisible,
  onClose,
  onRemindLater,
  onSkipVersion,
}: SimpleUpdateModalProps) {
  const { t } = useTranslation();

  if (!updater.state.hasUpdate) return null;

  const currentVersion = updater.state.currentVersion;
  const newVersion = updater.state.newVersion || 'unknown';

  const handleDownload = () => {
    void updater.downloadAndInstall();
  };

  const handleRemindLater = async () => {
    try {
      await onRemindLater();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("common.error.updateCheckFailed")
      );
    }
  };

  const handleSkipVersion = async () => {
    try {
      await onSkipVersion();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("common.error.updateCheckFailed")
      );
    }
  };

  const localizedError = updater.state.error
    ? resolveUpdateErrorMessage(updater.state.error, t)
    : null;

  return (
    <Dialog open={isVisible} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t('simpleUpdateModal.newUpdateAvailable')}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t('simpleUpdateModal.newUpdateAvailable')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Version info */}
          <div className="flex items-center justify-between p-2.5 bg-info/10 border border-info/20 rounded-md">
            <div className="text-center">
              <div className="text-[11px] text-muted-foreground">{t('simpleUpdateModal.currentVersion')}</div>
              <div className="text-xs font-medium text-foreground">{currentVersion}</div>
            </div>
            <div className="text-lg text-muted-foreground">→</div>
            <div className="text-center">
              <div className="text-[11px] text-muted-foreground">{t('simpleUpdateModal.newVersion')}</div>
              <div className="text-xs font-medium text-info">{newVersion}</div>
            </div>
          </div>

          {/* Restarting overlay */}
          {updater.state.isRestarting && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs">
                <RotateCw className="w-3.5 h-3.5 animate-spin text-info" />
                <span className="text-foreground font-medium">
                  {t('simpleUpdateModal.restarting')}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {t('simpleUpdateModal.restartingDescription')}
              </p>
            </div>
          )}

          {/* Download progress */}
          {updater.state.isDownloading && !updater.state.isRestarting && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs">
                <Download className="w-3.5 h-3.5 animate-bounce text-foreground" />
                <span className="text-muted-foreground">
                  {t('simpleUpdateModal.downloading', { progress: updater.state.downloadProgress })}
                </span>
              </div>
              <LoadingProgress
                progress={updater.state.downloadProgress}
                size="md"
                variant="default"
              />
            </div>
          )}

          {/* Error display */}
          {localizedError && !updater.state.isRestarting && (
            <div className="p-2.5 bg-destructive/10 border border-destructive/20 rounded-md">
              <div className="flex items-center gap-2 text-xs text-destructive">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>{t('simpleUpdateModal.errorOccurred', { error: localizedError })}</span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2">
          <Button
            onClick={handleDownload}
            disabled={updater.state.isDownloading || updater.state.isRestarting}
            size="sm"
            className="w-full"
          >
            {updater.state.isRestarting ? (
              <>
                <RotateCw className="w-3.5 h-3.5 animate-spin" />
                {t('simpleUpdateModal.restartingShort')}
              </>
            ) : updater.state.isDownloading ? (
              <>
                <LoadingSpinner size="xs" variant="default" />
                {t('simpleUpdateModal.downloadingShort')}
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                {t('simpleUpdateModal.downloadAndInstall')}
              </>
            )}
          </Button>

          <div className="flex gap-2 w-full">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleRemindLater()}
              disabled={updater.state.isDownloading || updater.state.isRestarting}
              className="flex-1 text-xs"
            >
              {t('simpleUpdateModal.remindLater')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleSkipVersion()}
              disabled={updater.state.isDownloading || updater.state.isRestarting}
              className="flex-1 text-xs"
            >
              {t('simpleUpdateModal.skipVersion')}
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={onClose}
              disabled={updater.state.isDownloading || updater.state.isRestarting}
              aria-label={t('simpleUpdateModal.close')}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
