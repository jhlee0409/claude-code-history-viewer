import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
} from "@/components/ui";
import { useTranslation } from 'react-i18next';
import { setUpdateSettings } from '@/utils/updateSettings';

interface UpdateIntroModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function UpdateIntroModal({ isOpen, onClose }: UpdateIntroModalProps) {
  const { t } = useTranslation('components');

  const handleUnderstood = () => {
    setUpdateSettings({
      hasSeenIntroduction: true,
    });
    onClose();
  };

  const handleDisableAutoCheck = () => {
    setUpdateSettings({
      hasSeenIntroduction: true,
      autoCheck: false,
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('updateIntroModal.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <p className="text-xs text-muted-foreground">
            {t('updateIntroModal.description')}
          </p>

          <div className="rounded-md bg-info/10 border border-info/20 p-2.5">
            <h4 className="font-medium text-xs mb-1.5 text-foreground">
              {t('updateIntroModal.howItWorksTitle')}
            </h4>
            <ul className="text-[11px] text-muted-foreground space-y-0.5">
              <li>• {t('updateIntroModal.howItWorks1')}</li>
              <li>• {t('updateIntroModal.howItWorks2')}</li>
              <li>• {t('updateIntroModal.howItWorks3')}</li>
              <li>• {t('updateIntroModal.howItWorks4')}</li>
            </ul>
          </div>

          <div className="rounded-md bg-success/10 border border-success/20 p-2.5">
            <h4 className="font-medium text-xs mb-1.5 text-foreground">
              {t('updateIntroModal.benefitsTitle')}
            </h4>
            <ul className="text-[11px] text-muted-foreground space-y-0.5">
              <li>• {t('updateIntroModal.benefits1')}</li>
              <li>• {t('updateIntroModal.benefits2')}</li>
              <li>• {t('updateIntroModal.benefits3')}</li>
              <li>• {t('updateIntroModal.benefits4')}</li>
            </ul>
          </div>

          <div className="text-[11px] text-muted-foreground p-2 bg-muted/50 rounded-md">
            {t('updateIntroModal.tip')}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={handleDisableAutoCheck}>
            {t('updateIntroModal.disableAutoCheck')}
          </Button>
          <Button size="sm" onClick={handleUnderstood}>
            {t('updateIntroModal.understood')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
