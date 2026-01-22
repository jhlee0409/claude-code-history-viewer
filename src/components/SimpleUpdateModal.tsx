import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
  Badge,
} from "@/components/ui";
import { ExternalLink, Download, AlertTriangle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { UseGitHubUpdaterReturn } from '@/hooks/useGitHubUpdater';
import { skipVersion, postponeUpdate } from '@/utils/updateSettings';

interface SimpleUpdateModalProps {
  updater: UseGitHubUpdaterReturn;
  isVisible: boolean;
  onClose: () => void;
}

export function SimpleUpdateModal({ updater, isVisible, onClose }: SimpleUpdateModalProps) {
  const { t } = useTranslation('components');
  const [showDetails, setShowDetails] = useState(false);

  if (!updater.state.releaseInfo || !updater.state.hasUpdate) return null;

  const release = updater.state.releaseInfo;
  const currentVersion = updater.state.currentVersion;
  const newVersion = release.tag_name.replace('v', '');

  const isImportant = (release.body ?? '').toLowerCase().includes('security') ||
                     (release.body ?? '').toLowerCase().includes('critical');

  const handleDownload = () => {
    updater.downloadAndInstall();
  };

  const handleSkip = () => {
    skipVersion(newVersion);
    updater.dismissUpdate();
    onClose();
  };

  const handlePostpone = () => {
    postponeUpdate();
    updater.dismissUpdate();
    onClose();
  };

  return (
    <Dialog open={isVisible} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t('simpleUpdateModal.newUpdateAvailable')}
            {isImportant && (
              <Badge variant="destructive" className="text-[10px]">
                <AlertTriangle className="w-3 h-3 mr-0.5" />
                {t('simpleUpdateModal.important')}
              </Badge>
            )}
          </DialogTitle>
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

          {/* Download progress */}
          {updater.state.isDownloading && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs">
                <Download className="w-3.5 h-3.5 animate-bounce text-foreground" />
                <span className="text-muted-foreground">
                  {t('simpleUpdateModal.downloading', { progress: updater.state.downloadProgress })}
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-1.5">
                <div
                  className="bg-primary h-1.5 rounded-full transition-all"
                  style={{ width: `${updater.state.downloadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Installing */}
          {updater.state.isInstalling && (
            <div className="flex items-center gap-2 text-xs p-2.5 bg-warning/10 border border-warning/20 rounded-md">
              <div className="animate-spin w-3.5 h-3.5 border-2 border-warning border-t-transparent rounded-full" />
              <span className="text-muted-foreground">{t('simpleUpdateModal.installing')}</span>
            </div>
          )}

          {/* Error display */}
          {updater.state.error && (
            <div className="p-2.5 bg-destructive/10 border border-destructive/20 rounded-md">
              <div className="flex items-center gap-2 text-xs text-destructive">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>{t('simpleUpdateModal.errorOccurred', { error: updater.state.error })}</span>
              </div>
            </div>
          )}

          {/* Details */}
          <div>
            <Button
              variant="link"
              size="sm"
              onClick={() => setShowDetails(!showDetails)}
              className="h-auto p-0 text-xs"
              aria-expanded={showDetails}
              aria-controls="update-details-panel"
            >
              {showDetails ? t('simpleUpdateModal.hideDetails') : t('simpleUpdateModal.showDetails')}
            </Button>

            {showDetails && (
              <div id="update-details-panel" className="mt-2 p-2.5 bg-muted/50 rounded-md text-xs">
                <div className="mb-1.5">
                  <strong className="text-foreground">{t('simpleUpdateModal.releaseName')}</strong>{' '}
                  <span className="text-muted-foreground">{release.name}</span>
                </div>
                <div className="mb-1.5">
                  <strong className="text-foreground">{t('simpleUpdateModal.changes')}</strong>
                  <pre className="mt-1 text-[11px] bg-background text-muted-foreground p-2 rounded border border-border max-h-24 overflow-auto font-mono">
                    {release.body}
                  </pre>
                </div>
                <a
                  href={release.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-info hover:text-info/80 text-[11px]"
                >
                  <ExternalLink className="w-3 h-3" />
                  {t('simpleUpdateModal.viewOnGitHub')}
                </a>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col gap-2">
          <Button
            onClick={handleDownload}
            disabled={updater.state.isDownloading || updater.state.isInstalling}
            size="sm"
            className="w-full"
          >
            {updater.state.isDownloading ? (
              <>
                <Download className="w-3.5 h-3.5 animate-bounce" />
                {t('simpleUpdateModal.downloadingShort')}
              </>
            ) : updater.state.isInstalling ? (
              t('simpleUpdateModal.installingShort')
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
              onClick={handlePostpone}
              disabled={updater.state.isDownloading || updater.state.isInstalling}
              className="flex-1 text-xs"
            >
              {t('simpleUpdateModal.remindLater')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSkip}
              disabled={updater.state.isDownloading || updater.state.isInstalling}
              className="flex-1 text-xs"
            >
              {t('simpleUpdateModal.skipVersion')}
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={onClose}
              disabled={updater.state.isDownloading || updater.state.isInstalling}
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
