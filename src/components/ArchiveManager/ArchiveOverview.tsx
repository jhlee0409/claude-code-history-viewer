import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, HardDrive, Clock, Archive, Info, Settings2, Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAppStore } from '@/store/useAppStore';
import { formatBytes } from '@/utils/formatters';
import { api } from '@/services/api';
import { toast } from 'sonner';

export const ArchiveOverview: React.FC = () => {
  const { t } = useTranslation();
  const {
    archive,
    projects,
    selectedProject: sidebarProject,
    loadDiskUsage,
    loadExpiringSessions,
    createArchive,
    setArchiveActiveTab,
    loadArchives,
  } = useAppStore();

  const selectId = React.useId();
  const settingsId = React.useId();

  // Local project selection for expiring sessions
  const [selectedProjectPath, setSelectedProjectPath] = useState<string>('');

  // thresholdDays: app-only setting, persisted in localStorage
  const [thresholdDays, setThresholdDays] = useState(() => {
    try {
      const v = parseInt(localStorage.getItem('archive.thresholdDays') ?? '', 10);
      return !isNaN(v) && v >= 1 && v <= 365 ? v : 7;
    } catch { return 7; }
  });
  // cleanupDays: read from ~/.claude/settings.json (cleanupPeriodDays)
  const [cleanupDays, setCleanupDays] = useState(30);

  // Draft settings as strings to allow intermediate input states (empty, partial)
  const [draftThreshold, setDraftThreshold] = useState(String(7));
  const [draftCleanup, setDraftCleanup] = useState(String(30));
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const parsedCleanup = parseInt(draftCleanup, 10);
  const parsedThreshold = parseInt(draftThreshold, 10);
  const isCleanupValid = !isNaN(parsedCleanup) && parsedCleanup >= 1 && parsedCleanup <= 365;
  const isThresholdValid = !isNaN(parsedThreshold) && parsedThreshold >= 1 && parsedThreshold <= (isCleanupValid ? parsedCleanup : 365);
  const thresholdExceedsCleanup = isCleanupValid && !isNaN(parsedThreshold) && parsedThreshold > parsedCleanup;
  const canSave = isCleanupValid && isThresholdValid && (parsedThreshold !== thresholdDays || parsedCleanup !== cleanupDays);

  // Auto-select sidebar project if available
  useEffect(() => {
    const isClaude = !sidebarProject?.provider || sidebarProject.provider === 'claude';
    if (sidebarProject && !selectedProjectPath && isClaude) {
      setSelectedProjectPath(sidebarProject.path);
    }
  }, [sidebarProject]); // eslint-disable-line react-hooks/exhaustive-deps

  // Find the selected project object from projects array
  const selectedProject = useMemo(
    () => projects.find((p) => p.path === selectedProjectPath) ?? null,
    [projects, selectedProjectPath]
  );

  // Split expiring sessions into main and subagent groups
  const { expiringSessions } = archive;
  const { mainExpiring, subagentExpiring } = useMemo(() => {
    const main: typeof expiringSessions = [];
    const sub: typeof expiringSessions = [];
    for (const s of expiringSessions) {
      if (s.subagentCount > 0) {
        sub.push(s);
      } else {
        main.push(s);
      }
    }
    return { mainExpiring: main, subagentExpiring: sub };
  }, [expiringSessions]);

  // Load cleanupPeriodDays from ~/.claude/settings.json on mount
  useEffect(() => {
    (async () => {
      try {
        const raw = await api<string>('get_settings_by_scope', { scope: 'user' });
        const parsed = JSON.parse(raw);
        const v = parsed?.cleanupPeriodDays;
        if (typeof v === 'number' && v >= 1 && v <= 365) {
          setCleanupDays(v);
        }
      } catch { /* use default 30 */ }
    })();
  }, []);

  // Load data on mount
  useEffect(() => {
    loadDiskUsage();
    loadArchives();
  }, [loadDiskUsage, loadArchives]);

  const isClaudeProvider = !selectedProject?.provider || selectedProject.provider === 'claude';

  const reloadExpiring = useCallback(() => {
    if (selectedProjectPath && isClaudeProvider) {
      loadExpiringSessions(selectedProjectPath, thresholdDays);
    }
  }, [selectedProjectPath, isClaudeProvider, thresholdDays, loadExpiringSessions]);

  useEffect(() => {
    reloadExpiring();
  }, [reloadExpiring]);

  const handleOpenSettings = useCallback(async () => {
    // UX4+EC3: Re-fetch latest cleanupDays when opening settings
    try {
      const raw = await api<string>('get_settings_by_scope', { scope: 'user' });
      const parsed = JSON.parse(raw);
      const v = parsed?.cleanupPeriodDays;
      if (typeof v === 'number' && v >= 1 && v <= 365) {
        setCleanupDays(v);
        setDraftCleanup(String(v));
      } else {
        setDraftCleanup(String(cleanupDays));
      }
    } catch {
      setDraftCleanup(String(cleanupDays));
    }
    setDraftThreshold(String(thresholdDays));
    setIsSettingsOpen(true);
  }, [thresholdDays, cleanupDays]);

  const handleSettingsOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        // Closing without save → discard draft
        setDraftThreshold(String(thresholdDays));
        setDraftCleanup(String(cleanupDays));
      }
      setIsSettingsOpen(open);
    },
    [thresholdDays, cleanupDays]
  );

  const handleSaveSettings = useCallback(async () => {
    if (!canSave) return;
    try {
      // Save cleanupPeriodDays to ~/.claude/settings.json if changed
      if (parsedCleanup !== cleanupDays) {
        const raw = await api<string>('get_settings_by_scope', { scope: 'user' });
        const settings = JSON.parse(raw);
        settings.cleanupPeriodDays = parsedCleanup;
        await api('save_settings', {
          scope: 'user',
          content: JSON.stringify(settings, null, 2),
        });
      }
      // Save thresholdDays to localStorage
      if (parsedThreshold !== thresholdDays) {
        try { localStorage.setItem('archive.thresholdDays', String(parsedThreshold)); }
        catch { /* storage full or unavailable */ }
      }
      setThresholdDays(parsedThreshold);
      setCleanupDays(parsedCleanup);
      setIsSettingsOpen(false);
      toast.success(t('archive.overview.settings.saved'));
    } catch {
      toast.error(t('archive.overview.settings.saveFailed'));
    }
  }, [canSave, parsedThreshold, parsedCleanup, thresholdDays, cleanupDays, t]);

  const handleArchiveSession = async (
    session: typeof archive.expiringSessions[0],
    includeSubagents: boolean,
  ) => {
    if (!selectedProject) return;
    try {
      await createArchive({
        name: session.session.summary || `Session ${session.session.session_id.slice(-8)}`,
        sessionFilePaths: [session.session.file_path],
        sourceProvider: selectedProject.provider ?? 'claude',
        sourceProjectPath: selectedProject.actual_path,
        sourceProjectName: selectedProject.name,
        includeSubagents,
      });
      toast.success(t('archive.create.success', { name: session.session.summary || 'Session' }));
      reloadExpiring();
      loadDiskUsage();
    } catch {
      toast.error(t('archive.error.createFailed'));
    }
  };

  const handleArchiveAll = async (includeSubagents: boolean) => {
    if (!selectedProject || archive.expiringSessions.length === 0) return;
    const batchName = t('archive.create.expiringBatchName', {
      date: new Date().toLocaleDateString(),
    });
    try {
      await createArchive({
        name: batchName,
        sessionFilePaths: archive.expiringSessions.map((s) => s.session.file_path),
        sourceProvider: selectedProject.provider ?? 'claude',
        sourceProjectPath: selectedProject.actual_path,
        sourceProjectName: selectedProject.name,
        includeSubagents,
      });
      toast.success(t('archive.create.success', { name: batchName }));
      reloadExpiring();
      loadDiskUsage();
    } catch {
      toast.error(t('archive.error.createFailed'));
    }
  };

  return (
    <div className="space-y-4">
      {/* Error display */}
      {archive.error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t('archive.error.loadFailed')}</AlertTitle>
          <AlertDescription>{archive.error}</AlertDescription>
        </Alert>
      )}

      {/* Cleanup Warning + Settings button */}
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle className="flex items-center justify-between">
          {t('archive.overview.cleanupWarning.title')}
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenSettings}
          >
            <Settings2 className="w-3.5 h-3.5 mr-1.5" />
            {t('archive.overview.settings.toggle')}
          </Button>
        </AlertTitle>
        <AlertDescription>
          {t('archive.overview.cleanupWarning.description', { days: cleanupDays })}
          <p className="mt-1 text-xs">
            {t('archive.overview.cleanupWarning.configured', { days: cleanupDays })}
            {' · '}
            {t('archive.overview.expiring.thresholdLabel', { days: thresholdDays })}
          </p>
        </AlertDescription>
      </Alert>

      {/* Disk Usage */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <HardDrive className="w-4 h-4" />
            {t('archive.overview.diskUsage.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {archive.diskUsage ? (
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-1.5">
                <Badge variant="secondary">
                  {archive.diskUsage.archiveCount}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {t('archive.overview.diskUsage.totalArchives')}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Badge variant="secondary">
                  {archive.diskUsage.sessionCount}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {t('archive.overview.diskUsage.totalSessions')}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Badge variant="secondary">
                  {formatBytes(archive.diskUsage.totalBytes)}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {t('archive.overview.diskUsage.totalSize')}
                </span>
              </div>
            </div>
          ) : archive.isLoadingDiskUsage ? (
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
              <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t('archive.overview.diskUsage.loadFailed')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Expiring Sessions */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="w-4 h-4" />
              {t('archive.overview.expiring.title')}
              <Badge variant="outline" className="text-2xs font-normal">
                {t('archive.overview.expiring.thresholdLabel', { days: thresholdDays })}
              </Badge>
            </CardTitle>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleArchiveAll(false)}
                disabled={archive.isCreatingArchive || !selectedProject || archive.expiringSessions.length === 0}
              >
                {archive.isCreatingArchive ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Archive className="w-3.5 h-3.5 mr-1.5" />
                )}
                {t('archive.overview.expiring.archiveAllMain')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleArchiveAll(true)}
                disabled={archive.isCreatingArchive || !selectedProject || archive.expiringSessions.length === 0 || subagentExpiring.length === 0}
              >
                {archive.isCreatingArchive ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Archive className="w-3.5 h-3.5 mr-1.5" />
                )}
                {t('archive.overview.expiring.archiveAllWithSubagents')}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Project selector dropdown */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={selectId} className="text-xs">
                {t('archive.overview.expiring.projectSelect')}
              </Label>
              <Select
                value={selectedProjectPath || undefined}
                onValueChange={setSelectedProjectPath}
              >
                <SelectTrigger id={selectId} className="w-full">
                  <SelectValue placeholder={t('archive.overview.expiring.projectSelect')} />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => {
                    const isClaude = !project.provider || project.provider === 'claude';
                    return (
                      <SelectItem
                        key={project.path}
                        value={project.path}
                        disabled={!isClaude}
                      >
                        <span className="flex items-center gap-1.5">
                          {project.name}
                          {!isClaude && (
                            <span className="text-2xs text-muted-foreground">
                              ({project.provider})
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            {!selectedProjectPath ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
                <Info className="w-4 h-4" />
                {t('archive.overview.expiring.selectProject')}
              </div>
            ) : archive.isLoadingExpiring ? (
              <div className="flex items-center justify-center gap-2 py-6">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
              </div>
            ) : archive.expiringSessions.length === 0 ? (
              <div className="text-center py-6">
                <Clock className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">
                  {t('archive.overview.expiring.noExpiring')}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('archive.overview.expiring.noExpiringDescription')}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {/* Main sessions column */}
                <div className="space-y-2.5">
                  <p className="text-xs font-medium text-muted-foreground pb-0.5 border-b border-border/40">
                    {t('archive.overview.expiring.mainSessions', { count: mainExpiring.length })}
                  </p>
                  {mainExpiring.length === 0 ? (
                    <p className="text-2xs text-muted-foreground/60 py-3 text-center">
                      {t('archive.overview.expiring.noMainExpiring')}
                    </p>
                  ) : (
                    mainExpiring.map((expiring) => (
                      <div
                        key={expiring.session.session_id}
                        className="flex items-center justify-between p-2.5 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm truncate">
                            {expiring.session.summary || `Session ${expiring.session.session_id.slice(-8)}`}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="destructive" className="text-2xs">
                              {t('archive.overview.expiring.daysRemaining', { days: expiring.daysRemaining })}
                            </Badge>
                            <span className="text-2xs text-muted-foreground">
                              {formatBytes(expiring.fileSizeBytes)}
                            </span>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleArchiveSession(expiring, false)}
                          disabled={archive.isCreatingArchive || !selectedProject}
                        >
                          <Archive className="w-3.5 h-3.5 mr-1" />
                          {t('archive.overview.expiring.archiveButton')}
                        </Button>
                      </div>
                    ))
                  )}
                </div>

                {/* Subagent sessions column */}
                <div className="space-y-2.5">
                  <p className="text-xs font-medium text-muted-foreground pb-0.5 border-b border-border/40">
                    {t('archive.overview.expiring.subagentSessions', { count: subagentExpiring.length })}
                  </p>
                  {subagentExpiring.length === 0 ? (
                    <p className="text-2xs text-muted-foreground/60 py-3 text-center">
                      {t('archive.overview.expiring.noSubagentExpiring')}
                    </p>
                  ) : (
                    subagentExpiring.map((expiring) => (
                      <div
                        key={expiring.session.session_id}
                        className="p-2.5 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-sm truncate">
                            {expiring.session.summary || `Session ${expiring.session.session_id.slice(-8)}`}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="destructive" className="text-2xs">
                              {t('archive.overview.expiring.daysRemaining', { days: expiring.daysRemaining })}
                            </Badge>
                            <span className="text-2xs text-muted-foreground">
                              {formatBytes(expiring.fileSizeBytes)}
                            </span>
                            <span className="text-2xs text-muted-foreground">
                              {t('archive.browse.sessions.subagents', { count: expiring.subagentCount })}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 mt-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => handleArchiveSession(expiring, false)}
                            disabled={archive.isCreatingArchive || !selectedProject}
                          >
                            <Archive className="w-3 h-3 mr-1" />
                            {t('archive.overview.expiring.archiveMainOnly')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => handleArchiveSession(expiring, true)}
                            disabled={archive.isCreatingArchive || !selectedProject}
                          >
                            <Archive className="w-3 h-3 mr-1" />
                            {t('archive.overview.expiring.archiveWithSubagents')}
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Quick link to browse archives */}
      {archive.manifest && archive.manifest.archives.length > 0 && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setArchiveActiveTab('browse')}
        >
          {t('archive.browse.title')} ({archive.manifest.archives.length})
        </Button>
      )}

      {/* Settings Dialog */}
      <Dialog open={isSettingsOpen} onOpenChange={handleSettingsOpenChange}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="w-4 h-4" />
              {t('archive.overview.settings.title')}
            </DialogTitle>
            <DialogDescription>
              {t('archive.overview.settings.description')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor={`${settingsId}-cleanup`} className="text-sm">
                {t('archive.overview.settings.cleanupDays')}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`${settingsId}-cleanup`}
                  type="number"
                  min={1}
                  max={365}
                  value={draftCleanup}
                  onChange={(e) => setDraftCleanup(e.target.value)}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">
                  {t('archive.overview.settings.days')}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${settingsId}-threshold`} className="text-sm">
                {t('archive.overview.settings.thresholdDays')}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`${settingsId}-threshold`}
                  type="number"
                  min={1}
                  max={365}
                  value={draftThreshold}
                  onChange={(e) => setDraftThreshold(e.target.value)}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">
                  {t('archive.overview.settings.days')}
                </span>
              </div>
            </div>

            {thresholdExceedsCleanup && (
              <Alert variant="destructive" className="py-2 flex items-center gap-2 [&>svg]:static [&>svg]:translate-y-0 [&>svg~*]:pl-0">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <AlertDescription className="text-xs">
                  {t('archive.overview.settings.thresholdExceedsCleanup')}
                </AlertDescription>
              </Alert>
            )}

            {canSave && (
              <Alert className="py-2 flex items-center gap-2 [&>svg]:static [&>svg]:translate-y-0 [&>svg~*]:pl-0">
                <Info className="h-3.5 w-3.5 shrink-0" />
                <AlertDescription className="text-xs">
                  {t('archive.overview.settings.unsavedChanges')}
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => handleSettingsOpenChange(false)}>
              {t('archive.overview.settings.cancel')}
            </Button>
            <Button onClick={handleSaveSettings} disabled={!canSave}>
              {t('archive.overview.settings.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
