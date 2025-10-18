import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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

        <div className="space-y-4 py-4 dark:text-gray-300">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('updateIntroModal.description')}
          </p>

          <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg">
            <h4 className="font-medium text-sm mb-2 dark:text-gray-200">{t('updateIntroModal.howItWorksTitle')}</h4>
            <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
              <li>• {t('updateIntroModal.howItWorks1')}</li>
              <li>• {t('updateIntroModal.howItWorks2')}</li>
              <li>• {t('updateIntroModal.howItWorks3')}</li>
              <li>• {t('updateIntroModal.howItWorks4')}</li>
            </ul>
          </div>

          <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg">
            <h4 className="font-medium text-sm mb-2 dark:text-gray-200">{t('updateIntroModal.benefitsTitle')}</h4>
            <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
              <li>• {t('updateIntroModal.benefits1')}</li>
              <li>• {t('updateIntroModal.benefits2')}</li>
              <li>• {t('updateIntroModal.benefits3')}</li>
              <li>• {t('updateIntroModal.benefits4')}</li>
            </ul>
          </div>

          <div className="text-xs text-gray-500 dark:text-gray-400 p-2 bg-gray-50 dark:bg-gray-800 rounded">
            {t('updateIntroModal.tip')}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <button
            onClick={handleDisableAutoCheck}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            {t('updateIntroModal.disableAutoCheck')}
          </button>
          <button
            onClick={handleUnderstood}
            className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded hover:bg-blue-700 dark:hover:bg-blue-600"
          >
            {t('updateIntroModal.understood')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}