import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAppStore } from '@/store/useAppStore';
import { useProjectSessions } from '@/hooks/useProjectSessions';
import { api } from '@/services/api';
import { toast } from 'sonner';
import { isTauri } from '@/utils/platform';

export const ArchiveExport: React.FC = () => {
  const { t } = useTranslation();
  const {
    archive,
    projects,
    selectedProject: sidebarProject,
    exportSession,
  } = useAppStore();
  const {
    mainSessions,
    isLoading: isLoadingSessions,
    loadSessions,
  } = useProjectSessions();

  const projectSelectId = React.useId();
  const sessionSelectId = React.useId();

  // Local project selection
  const [selectedProjectPath, setSelectedProjectPath] = useState<string>('');
  const [selectedSessionPath, setSelectedSessionPath] = useState<string>('');
  const [preview, setPreview] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  // Auto-select sidebar project if available (Claude only)
  useEffect(() => {
    const isClaude = !sidebarProject?.provider || sidebarProject.provider === 'claude';
    if (sidebarProject && !selectedProjectPath && isClaude) {
      setSelectedProjectPath(sidebarProject.path);
    }
  }, [sidebarProject]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load sessions when selected project path changes
  useEffect(() => {
    if (!selectedProjectPath) return;
    const project = projects.find((p) => p.path === selectedProjectPath);
    if (project) {
      setSelectedSessionPath('');
      setPreview(null);
      loadSessions(project);
    }
  }, [selectedProjectPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleProjectChange = (path: string) => {
    setSelectedProjectPath(path);
    setSelectedSessionPath('');
    setPreview(null);
  };

  const handleExport = async () => {
    if (!selectedSessionPath) {
      toast.error(t('archive.export.noSession'));
      return;
    }

    try {
      const content = await exportSession(selectedSessionPath, 'json');

      if (isTauri()) {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const filePath = await save({
          defaultPath: 'session-export.json',
          filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (filePath) {
          await api('write_text_file', { path: filePath, content });
          toast.success(t('archive.export.success'));
        }
      } else {
        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        try {
          const a = document.createElement('a');
          a.href = url;
          a.download = 'session-export.json';
          a.click();
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        toast.success(t('archive.export.success'));
      }
    } catch {
      toast.error(t('archive.error.exportFailed'));
    }
  };

  const handlePreview = async () => {
    if (!selectedSessionPath) return;
    setIsPreviewLoading(true);
    try {
      const content = await exportSession(selectedSessionPath, 'json');
      const lines = content.split('\n').slice(0, 100).join('\n');
      setPreview(lines);
    } catch {
      toast.error(t('archive.error.exportFailed'));
    } finally {
      setIsPreviewLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Download className="w-4 h-4" />
            {t('archive.export.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Project selection */}
          <div className="space-y-2">
            <Label htmlFor={projectSelectId}>{t('archive.export.selectProject')}</Label>
            <Select
              value={selectedProjectPath || undefined}
              onValueChange={handleProjectChange}
            >
              <SelectTrigger id={projectSelectId} className="w-full">
                <SelectValue placeholder={t('archive.export.selectProject')} />
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

          {/* Session selection */}
          <div className="space-y-2">
            <Label htmlFor={sessionSelectId}>{t('archive.export.selectSession')}</Label>
            <Select
              value={selectedSessionPath || undefined}
              onValueChange={(v) => {
                setSelectedSessionPath(v);
                setPreview(null);
              }}
              disabled={isLoadingSessions || !selectedProjectPath}
            >
              <SelectTrigger id={sessionSelectId} className="w-full">
                <SelectValue placeholder={t('archive.export.selectSession')} />
              </SelectTrigger>
              <SelectContent>
                {mainSessions.map((session) => (
                  <SelectItem key={session.session_id} value={session.file_path}>
                    {session.summary || `Session ${session.session_id.slice(-8)}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedProjectPath && !isLoadingSessions && mainSessions.length === 0 && (
              <p className="text-2xs text-muted-foreground">
                {t('archive.export.noSessions')}
              </p>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePreview}
              disabled={!selectedSessionPath || isPreviewLoading}
            >
              {isPreviewLoading && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              {t('archive.export.preview')}
            </Button>
            <Button
              size="sm"
              onClick={handleExport}
              disabled={!selectedSessionPath || archive.isExporting}
            >
              {archive.isExporting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  {t('archive.export.exporting')}
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                  {t('archive.export.exportButton')}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Preview */}
      {preview && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center justify-between">
              {t('archive.export.preview')}
              <Badge variant="secondary" className="text-2xs">
                {t('archive.export.previewFirst')}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs font-mono bg-muted/50 p-3 rounded-md overflow-auto max-h-96 whitespace-pre-wrap">
              {preview}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
