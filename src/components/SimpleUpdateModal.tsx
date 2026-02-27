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
import { useModal } from "@/contexts/modal";
import { resolveUpdateErrorMessage } from '@/utils/updateError';
import { buildUpdateDiagnostics } from '@/utils/updateDiagnostics';

interface SimpleUpdateModalProps {
  updater: UseUpdaterReturn;
  isVisible: boolean;
  onClose: () => void;
  onRemindLater: () => Promise<void> | void;
  onSkipVersion: () => Promise<void> | void;
}

function getTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveReleaseName(updateInfo: UseUpdaterReturn['state']['updateInfo']): string | null {
  if (!updateInfo) return null;

  return (
    getTrimmedString(updateInfo.rawJson?.releaseName) ??
    getTrimmedString(updateInfo.rawJson?.name) ??
    getTrimmedString(updateInfo.rawJson?.title) ??
    null
  );
}

function resolveReleaseNotes(updateInfo: UseUpdaterReturn['state']['updateInfo']): string | null {
  if (!updateInfo) return null;

  return (
    getTrimmedString(updateInfo.body) ??
    getTrimmedString(updateInfo.rawJson?.notes) ??
    getTrimmedString(updateInfo.rawJson?.releaseNotes) ??
    getTrimmedString(updateInfo.rawJson?.changelog) ??
    null
  );
}

export function SimpleUpdateModal({
  updater,
  isVisible,
  onClose,
  onRemindLater,
  onSkipVersion,
}: SimpleUpdateModalProps) {
  const { t } = useTranslation();
  const { openModal } = useModal();

  if (!updater.state.hasUpdate) return null;

  const currentVersion = updater.state.currentVersion;
  const newVersion = updater.state.newVersion || 'unknown';
  const releaseName = resolveReleaseName(updater.state.updateInfo);
  const releaseNotes = resolveReleaseNotes(updater.state.updateInfo);

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
  const shouldShowManualRestartNotice =
    updater.state.requiresManualRestart && !updater.state.isRestarting;

  const handleReportIssue = () => {
    if (!updater.state.error) return;

    const diagnostics = buildUpdateDiagnostics({
      error: updater.state.error,
      state: updater.state,
    });

    const subject = t('simpleUpdateModal.reportIssueSubject', {
      currentVersion,
      newVersion,
    });
    const body = [t('simpleUpdateModal.reportIssuePrompt'), '', diagnostics].join('\n');

    openModal("feedback", {
      feedbackPrefill: {
        feedbackType: "bug",
        subject,
        body,
        includeSystemInfo: true,
      },
    });

    onClose();
  };

  const handlePrimaryAction = () => {
    if (updater.state.requiresManualRestart) {
      onClose();
      return;
    }

    handleDownload();
  };

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

          {(releaseName || releaseNotes) && (
            <div className="space-y-1.5 p-2.5 bg-muted/40 border border-border/60 rounded-md">
              {releaseName && (
                <p className="text-[11px] text-muted-foreground" data-testid="update-release-name">
                  <span className="font-medium">{t('simpleUpdateModal.releaseName')}</span>{' '}
                  {releaseName}
                </p>
              )}
              {releaseNotes && (
                <div className="space-y-1">
                  <p className="text-[11px] font-medium text-muted-foreground">
                    {t('simpleUpdateModal.changes')}
                  </p>
                  <p
                    className="text-xs text-foreground whitespace-pre-wrap max-h-28 overflow-y-auto pr-1 leading-relaxed"
                    data-testid="update-release-notes"
                  >
                    {releaseNotes}
                  </p>
                </div>
              )}
            </div>
          )}

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
          {updater.state.isDownloading &&
            !updater.state.isInstalling &&
            !updater.state.isRestarting && (
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

          {/* Installing state */}
          {updater.state.isInstalling && !updater.state.isRestarting && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs">
                <LoadingSpinner size="xs" variant="default" />
                <span className="text-muted-foreground">
                  {t('simpleUpdateModal.installing')}
                </span>
              </div>
            </div>
          )}

          {/* Manual restart guidance after successful payload download */}
          {shouldShowManualRestartNotice && (
            <div className="p-2.5 bg-info/10 border border-info/20 rounded-md">
              <div className="flex items-center gap-2 text-xs text-info">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>{t('common.error.updateManualRestartRequired')}</span>
              </div>
            </div>
          )}

          {/* Error display */}
          {localizedError && !updater.state.isRestarting && !shouldShowManualRestartNotice && (
            <div className="p-2.5 bg-destructive/10 border border-destructive/20 rounded-md">
              <div className="flex items-center gap-2 text-xs text-destructive">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>{t('simpleUpdateModal.errorOccurred', { error: localizedError })}</span>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {t('simpleUpdateModal.failureGuide')}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 w-full"
                onClick={handleReportIssue}
              >
                {t('simpleUpdateModal.reportIssue')}
              </Button>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2">
          <Button
            onClick={handlePrimaryAction}
            disabled={
              updater.state.isDownloading ||
              updater.state.isInstalling ||
              updater.state.isRestarting
            }
            size="sm"
            className="w-full"
          >
            {updater.state.requiresManualRestart ? (
              t('simpleUpdateModal.close')
            ) : updater.state.isRestarting ? (
              <>
                <RotateCw className="w-3.5 h-3.5 animate-spin" />
                {t('simpleUpdateModal.restartingShort')}
              </>
            ) : updater.state.isInstalling ? (
              <>
                <LoadingSpinner size="xs" variant="default" />
                {t('simpleUpdateModal.installingShort')}
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
              disabled={
                updater.state.isDownloading ||
                updater.state.isInstalling ||
                updater.state.isRestarting ||
                updater.state.requiresManualRestart
              }
              className="flex-1 text-xs"
            >
              {t('simpleUpdateModal.remindLater')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleSkipVersion()}
              disabled={
                updater.state.isDownloading ||
                updater.state.isInstalling ||
                updater.state.isRestarting ||
                updater.state.requiresManualRestart
              }
              className="flex-1 text-xs"
            >
              {t('simpleUpdateModal.skipVersion')}
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={onClose}
              disabled={
                updater.state.isDownloading ||
                updater.state.isInstalling ||
                updater.state.isRestarting
              }
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
