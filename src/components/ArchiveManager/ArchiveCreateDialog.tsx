/**
 * ArchiveCreateDialog
 *
 * 2-step dialog for creating archives independently from sidebar selection.
 * Step 1: Select a project from the already-loaded project list.
 * Step 2: Select sessions + fill in archive name/description.
 */

import React, { useState, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ChevronRight,
  FolderOpen,
  Loader2,
  Search,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/store/useAppStore';
import { useProjectSessions } from '@/hooks/useProjectSessions';
import { toast } from 'sonner';
import type { ClaudeProject } from '@/types';

interface ArchiveCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ArchiveCreateDialog: React.FC<ArchiveCreateDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { t } = useTranslation();
  const { projects, archive, createArchive, loadDiskUsage } = useAppStore();
  const {
    mainSessions,
    isLoading: isLoadingSessions,
    loadSessions,
    clearSessions,
  } = useProjectSessions();

  const formId = React.useId();

  // Step state
  const [step, setStep] = useState<'project' | 'sessions'>('project');
  const [projectSearch, setProjectSearch] = useState('');
  const [selectedProject, setSelectedProject] = useState<ClaudeProject | null>(null);

  // Form state
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [selectedSessionPaths, setSelectedSessionPaths] = useState<string[]>([]);
  const [includeSubagents, setIncludeSubagents] = useState(true);

  // FB4: track whether auto-selection has already happened
  const hasAutoSelectedRef = useRef(false);

  const filteredProjects = useMemo(() => {
    if (!projectSearch.trim()) return projects;
    const query = projectSearch.toLowerCase();
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        p.actual_path.toLowerCase().includes(query)
    );
  }, [projects, projectSearch]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        // Reset all state on close
        setStep('project');
        setProjectSearch('');
        setSelectedProject(null);
        setCreateName('');
        setCreateDescription('');
        setSelectedSessionPaths([]);
        setIncludeSubagents(true);
        hasAutoSelectedRef.current = false;
        clearSessions();
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, clearSessions]
  );

  const handleSelectProject = useCallback(
    async (project: ClaudeProject) => {
      setSelectedProject(project);
      setStep('sessions');
      setCreateName(
        t('archive.create.autoName', {
          name: project.name,
          date: new Date().toLocaleDateString(),
        })
      );
      setSelectedSessionPaths([]);
      await loadSessions(project);
    },
    [loadSessions, t]
  );

  const handleBack = useCallback(() => {
    setStep('project');
    setSelectedProject(null);
    setSelectedSessionPaths([]);
    hasAutoSelectedRef.current = false;
    clearSessions();
  }, [clearSessions]);

  const toggleSessionSelection = useCallback((path: string) => {
    setSelectedSessionPaths((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    );
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedSessionPaths.length === mainSessions.length) {
      setSelectedSessionPaths([]);
    } else {
      setSelectedSessionPaths(mainSessions.map((s) => s.file_path));
    }
  }, [selectedSessionPaths.length, mainSessions]);

  // Auto-select main sessions when they finish loading (only once per step)
  React.useEffect(() => {
    if (mainSessions.length > 0 && !hasAutoSelectedRef.current) {
      setSelectedSessionPaths(mainSessions.map((s) => s.file_path));
      hasAutoSelectedRef.current = true;
    }
  }, [mainSessions]);

  const handleCreate = useCallback(async () => {
    if (!createName.trim()) {
      toast.error(t('archive.create.nameRequired'));
      return;
    }
    if (selectedSessionPaths.length === 0) {
      toast.error(t('archive.create.sessionsRequired'));
      return;
    }
    if (!selectedProject) return;

    try {
      await createArchive({
        name: createName.trim(),
        description: createDescription.trim() || null,
        sessionFilePaths: selectedSessionPaths,
        sourceProvider: selectedProject.provider ?? 'claude',
        sourceProjectPath: selectedProject.actual_path,
        sourceProjectName: selectedProject.name,
        includeSubagents,
      });
      toast.success(t('archive.create.success', { name: createName.trim() }));
      handleOpenChange(false);
      loadDiskUsage();
    } catch {
      toast.error(t('archive.error.createFailed'));
    }
  }, [
    createName,
    createDescription,
    selectedSessionPaths,
    selectedProject,
    includeSubagents,
    createArchive,
    loadDiskUsage,
    handleOpenChange,
    t,
  ]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] grid-rows-[auto_1fr_auto]">
        <DialogHeader>
          <DialogTitle>
            {step === 'sessions' && selectedProject ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={handleBack}
                  aria-label={t('archive.create.back')}
                >
                  <ArrowLeft className="w-4 h-4" />
                </Button>
                <span className="truncate">{selectedProject.name}</span>
              </div>
            ) : (
              t('archive.create.step.selectProject')
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {step === 'project'
              ? t('archive.create.step.selectProject')
              : t('archive.create.step.selectSessions')}
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto min-h-0 pr-1">
          {step === 'project' ? (
            /* Step 1: Project selection */
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  value={projectSearch}
                  onChange={(e) => setProjectSearch(e.target.value)}
                  placeholder={t('archive.create.projectSearch')}
                  className="pl-8 h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                {filteredProjects.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-6 text-center">
                    {t('archive.create.noProjectsFound')}
                  </p>
                ) : (
                  filteredProjects.map((project) => {
                    const isClaude = !project.provider || project.provider === 'claude';
                    return (
                    <button
                      key={project.path}
                      type="button"
                      className={`w-full flex items-center gap-2.5 p-2.5 rounded-lg transition-colors text-left ${
                        isClaude
                          ? 'hover:bg-muted/50 cursor-pointer'
                          : 'opacity-50 cursor-not-allowed'
                      }`}
                      onClick={() => isClaude && handleSelectProject(project)}
                      disabled={!isClaude}
                    >
                      <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{project.name}</p>
                        <p className="text-2xs text-muted-foreground truncate">
                          {isClaude ? project.actual_path : `${project.provider} — ${t('archive.create.unsupportedProvider')}`}
                        </p>
                      </div>
                      {isClaude && (
                        <>
                          <Badge variant="secondary" className="text-2xs shrink-0">
                            {t('archive.create.sessionCount', { count: project.session_count })}
                          </Badge>
                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        </>
                      )}
                    </button>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            /* Step 2: Session selection + form */
            <div className="space-y-4">
              {/* Archive name */}
              <div className="space-y-2">
                <Label htmlFor={`${formId}-name`}>{t('archive.create.name')}</Label>
                <Input
                  id={`${formId}-name`}
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder={t('archive.create.namePlaceholder')}
                />
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor={`${formId}-desc`}>{t('archive.create.description')}</Label>
                <Textarea
                  id={`${formId}-desc`}
                  value={createDescription}
                  onChange={(e) => setCreateDescription(e.target.value)}
                  placeholder={t('archive.create.descriptionPlaceholder')}
                  rows={2}
                />
              </div>

              {/* Session selection */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>{t('archive.create.sessions')}</Label>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-2xs">
                      {t('archive.create.sessionsSelected', {
                        count: selectedSessionPaths.length,
                      })}
                    </Badge>
                    {mainSessions.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={toggleSelectAll}
                      >
                        {selectedSessionPaths.length === mainSessions.length
                          ? t('archive.create.deselectAll')
                          : t('archive.create.selectAll')}
                      </Button>
                    )}
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto border rounded-md p-1 space-y-0.5">
                  {isLoadingSessions ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : mainSessions.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-3 text-center">
                      {t('archive.create.noSessions')}
                    </p>
                  ) : (
                    mainSessions.map((session) => (
                      <label
                        key={session.session_id}
                        className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/30 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedSessionPaths.includes(session.file_path)}
                          onChange={() => toggleSessionSelection(session.file_path)}
                          className="rounded border-border"
                        />
                        <span className="text-xs truncate flex-1">
                          {session.summary || `Session ${session.session_id.slice(-8)}`}
                        </span>
                        <span className="text-2xs text-muted-foreground shrink-0">
                          {t('archive.browse.sessions.messages', {
                            count: session.message_count,
                          })}
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              {/* Subagent toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor={`${formId}-subagents`} className="text-sm">
                    {t('archive.create.includeSubagents')}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t('archive.create.includeSubagentsDescription')}
                  </p>
                </div>
                <Switch
                  id={`${formId}-subagents`}
                  checked={includeSubagents}
                  onCheckedChange={setIncludeSubagents}
                />
              </div>
            </div>
          )}
        </div>

        {step === 'sessions' && (
          <DialogFooter>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={
                archive.isCreatingArchive ||
                !createName.trim() ||
                selectedSessionPaths.length === 0
              }
            >
              {archive.isCreatingArchive ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  {t('archive.create.creating')}
                </>
              ) : (
                t('archive.create.submit')
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};
