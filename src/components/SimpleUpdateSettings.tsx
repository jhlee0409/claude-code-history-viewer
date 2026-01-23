import { useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
  Label,
  Switch,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Badge,
  Separator,
} from "@/components/ui";
import { RefreshCw, Trash2, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { clearUpdateCache } from '@/utils/updateCache';
import { useAppStore } from '@/store/useAppStore';
import type { UpdateSettings } from '@/types/updateSettings';

interface SimpleUpdateSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  onManualCheck?: () => void;
  isCheckingForUpdates?: boolean;
}

export function SimpleUpdateSettings({
  isOpen,
  onClose,
  onManualCheck,
  isCheckingForUpdates = false
}: SimpleUpdateSettingsProps) {
  const { t } = useTranslation();
  const { updateSettings: settings, setUpdateSetting, loadUpdateSettings } = useAppStore();

  useEffect(() => {
    if (isOpen) {
      loadUpdateSettings();
    }
  }, [isOpen, loadUpdateSettings]);

  const updateSetting = <K extends keyof UpdateSettings>(
    key: K,
    value: UpdateSettings[K]
  ) => {
    // Directly persist changes via Zustand store
    setUpdateSetting(key, value);
  };

  const handleClearCache = () => {
    clearUpdateCache();
    alert(t('updateSettingsModal.cacheCleared'));
  };

  const handleManualCheckClick = () => {
    if (onManualCheck) {
      onManualCheck();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('updateSettingsModal.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Auto Check Setting */}
          <div className="flex items-center justify-between">
            <Label htmlFor="autoCheck" className="cursor-pointer">
              {t('updateSettingsModal.autoCheck')}
            </Label>
            <Switch
              id="autoCheck"
              checked={settings.autoCheck}
              onCheckedChange={(checked) => updateSetting('autoCheck', checked)}
            />
          </div>

          {/* Check Interval Setting */}
          {settings.autoCheck && (
            <div className="space-y-2">
              <Label htmlFor="checkInterval">
                {t('updateSettingsModal.checkInterval')}
              </Label>
              <Select
                value={settings.checkInterval}
                onValueChange={(value) => updateSetting('checkInterval', value as 'startup' | 'daily' | 'weekly' | 'never')}
              >
                <SelectTrigger id="checkInterval">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="startup">{t('updateSettingsModal.intervalStartup')}</SelectItem>
                  <SelectItem value="daily">{t('updateSettingsModal.intervalDaily')}</SelectItem>
                  <SelectItem value="weekly">{t('updateSettingsModal.intervalWeekly')}</SelectItem>
                  <SelectItem value="never">{t('updateSettingsModal.intervalNever', { defaultValue: 'Never' })}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Offline Status Setting */}
          <div className="flex items-center justify-between">
            <Label htmlFor="respectOfflineStatus" className="cursor-pointer">
              {t('updateSettingsModal.respectOfflineStatus')}
            </Label>
            <Switch
              id="respectOfflineStatus"
              checked={settings.respectOfflineStatus}
              onCheckedChange={(checked) => updateSetting('respectOfflineStatus', checked)}
            />
          </div>

          {/* Critical Updates Setting */}
          <div className="flex items-center justify-between">
            <Label htmlFor="allowCriticalUpdates" className="cursor-pointer">
              {t('updateSettingsModal.allowCriticalUpdates')}
            </Label>
            <Switch
              id="allowCriticalUpdates"
              checked={settings.allowCriticalUpdates}
              onCheckedChange={(checked) => updateSetting('allowCriticalUpdates', checked)}
            />
          </div>

          {/* Skipped Versions Management */}
          {settings.skippedVersions.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t('updateSettingsModal.skippedVersions')}</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => updateSetting('skippedVersions', [])}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="w-3 h-3 mr-1" />
                  {t('updateSettingsModal.clearAll')}
                </Button>
              </div>
              <div className="flex flex-wrap gap-1">
                {settings.skippedVersions.map((version) => (
                  <Badge key={version} variant="secondary">
                    v{version}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Manual Actions */}
          <Separator />

          <div className="space-y-2">
            <Button
              variant="outline"
              onClick={handleManualCheckClick}
              disabled={isCheckingForUpdates}
              className="w-full"
            >
              {isCheckingForUpdates ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('updateSettingsModal.checking')}
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  {t('updateSettingsModal.checkNow')}
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={handleClearCache}
              className="w-full"
            >
              <Trash2 className="w-4 h-4" />
              {t('updateSettingsModal.clearCache')}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('updateSettingsModal.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
