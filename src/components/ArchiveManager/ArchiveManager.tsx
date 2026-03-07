import React from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAppStore } from '@/store/useAppStore';
import { ArchiveOverview } from './ArchiveOverview';
import { ArchiveBrowser } from './ArchiveBrowser';
import { cn } from '@/lib/utils';

interface ArchiveManagerProps {
  className?: string;
}

export const ArchiveManager: React.FC<ArchiveManagerProps> = ({ className }) => {
  const { t } = useTranslation();
  const { archive, setArchiveActiveTab } = useAppStore();

  return (
    <div className={cn('flex flex-col', className)}>
      <Tabs
        value={archive.activeTab}
        onValueChange={(v) => {
          if (v === 'overview' || v === 'browse') {
            setArchiveActiveTab(v);
          }
        }}
        className="flex-1 flex flex-col min-h-0"
      >
        <TabsList className="grid w-full grid-cols-2 mb-4">
          <TabsTrigger value="overview">{t('archive.tab.overview')}</TabsTrigger>
          <TabsTrigger value="browse">{t('archive.tab.browse')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex-1 min-h-0 overflow-auto">
          <ArchiveOverview />
        </TabsContent>

        <TabsContent value="browse" className="flex-1 min-h-0 overflow-auto">
          <ArchiveBrowser />
        </TabsContent>
      </Tabs>
    </div>
  );
};
