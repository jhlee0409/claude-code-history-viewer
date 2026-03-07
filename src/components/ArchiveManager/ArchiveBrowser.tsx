import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Archive,
  Bot,
  ChevronDown,
  ChevronRight,
  Download,
  FolderOpen,
  Plus,
  Trash2,
  Pencil,
  Package,
  MessageSquare,
  Loader2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import { useAppStore } from '@/store/useAppStore';
import { archiveApi } from '@/services/archiveApi';
import { api } from '@/services/api';
import { formatBytes } from '@/utils/formatters';
import { toast } from 'sonner';
import { isTauri } from '@/utils/platform';
import { ArchiveCreateDialog } from './ArchiveCreateDialog';
import type { ArchiveEntry, ArchiveSessionInfo } from '@/types';

const joinArchivePath = (...parts: string[]) =>
  parts
    .map((part, index) => {
      const normalized = part.replace(/\\/g, '/');
      if (index === 0) {
        return normalized.replace(/\/+$/g, '');
      }
      return normalized.replace(/^\/+|\/+$/g, '');
    })
    .filter(Boolean)
    .join('/');

export const ArchiveBrowser: React.FC = () => {
  const { t } = useTranslation();
  const {
    archive,
    loadArchives,
    deleteArchive,
    renameArchive,
    loadArchiveSessions,
    loadDiskUsage,
    clearArchiveError,
    exportSession,
  } = useAppStore();

  // Local state
  const [expandedArchiveId, setExpandedArchiveId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [targetArchive, setTargetArchive] = useState<ArchiveEntry | null>(null);
  const [archiveBasePath, setArchiveBasePath] = useState<string | null>(null);

  // Rename form state
  const [renameName, setRenameName] = useState('');
  const [exportingSessionId, setExportingSessionId] = useState<string | null>(null);

  const formId = React.useId();
  const expandedArchiveIdRef = useRef(expandedArchiveId);
  expandedArchiveIdRef.current = expandedArchiveId;

  useEffect(() => {
    loadArchives();
    archiveApi.getBasePath().then(setArchiveBasePath).catch(() => {});
  }, [loadArchives]);

  const handleOpenInFileManager = useCallback(async () => {
    if (!archiveBasePath) return;
    try {
      if (isTauri()) {
        const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
        await revealItemInDir(archiveBasePath);
      }
    } catch {
      toast.error(t('archive.browse.openFolderFailed'));
    }
  }, [archiveBasePath, t]);

  const handleExpandArchive = useCallback(
    async (archiveId: string) => {
      if (expandedArchiveIdRef.current === archiveId) {
        setExpandedArchiveId(null);
        return;
      }
      setExpandedArchiveId(archiveId);
      clearArchiveError();
      await loadArchiveSessions(archiveId);
    },
    [loadArchiveSessions, clearArchiveError]
  );

  const handleDelete = async () => {
    if (!targetArchive) return;
    try {
      await deleteArchive(targetArchive.id);
      // FB3: clear expanded state if the deleted archive was expanded
      if (expandedArchiveId === targetArchive.id) {
        setExpandedArchiveId(null);
      }
      toast.success(t('archive.browse.delete.success', { name: targetArchive.name }));
      setIsDeleteOpen(false);
      setTargetArchive(null);
      loadDiskUsage();
    } catch {
      toast.error(t('archive.error.deleteFailed'));
    }
  };

  const handleRename = async () => {
    if (!targetArchive || !renameName.trim()) return;
    try {
      await renameArchive(targetArchive.id, renameName.trim());
      // Archive ID changes after rename (name-based format).
      // Collapse the expanded archive to avoid stale ID reference.
      if (expandedArchiveId === targetArchive.id) {
        setExpandedArchiveId(null);
      }
      toast.success(t('archive.browse.rename.success', { name: renameName.trim() }));
      setIsRenameOpen(false);
      setTargetArchive(null);
    } catch {
      toast.error(t('archive.error.renameFailed'));
    }
  };

  const handleExportFile = useCallback(
    async (filePath: string, downloadName: string, trackingId: string) => {
      setExportingSessionId(trackingId);
      try {
        const content = await exportSession(filePath, 'json');

        if (isTauri()) {
          const { save } = await import('@tauri-apps/plugin-dialog');
          const savePath = await save({
            defaultPath: downloadName,
            filters: [{ name: 'JSON', extensions: ['json'] }],
          });
          if (savePath) {
            await api('write_text_file', { path: savePath, content });
            toast.success(t('archive.export.success'));
          }
        } else {
          const blob = new Blob([content], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          try {
            const a = document.createElement('a');
            a.href = url;
            a.download = downloadName;
            a.click();
          } finally {
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }
          toast.success(t('archive.export.success'));
        }
      } catch {
        toast.error(t('archive.error.exportFailed'));
      } finally {
        setExportingSessionId(null);
      }
    },
    [exportSession, t]
  );

  const handleExportSession = useCallback(
    (archiveId: string, session: ArchiveSessionInfo) => {
      if (!archiveBasePath) return;
      const filePath = joinArchivePath(archiveBasePath, archiveId, 'sessions', session.fileName);
      const downloadName = `${session.summary || session.sessionId}.json`;
      handleExportFile(filePath, downloadName, session.sessionId);
    },
    [archiveBasePath, handleExportFile]
  );

  const handleExportSubagent = useCallback(
    (archiveId: string, sessionId: string, subagentFileName: string) => {
      if (!archiveBasePath) return;
      const filePath = joinArchivePath(
        archiveBasePath,
        archiveId,
        'subagents',
        sessionId,
        subagentFileName
      );
      const stem = subagentFileName.replace(/\.jsonl$/, '');
      const downloadName = `${stem}.json`;
      handleExportFile(filePath, downloadName, `${sessionId}/${subagentFileName}`);
    },
    [archiveBasePath, handleExportFile]
  );

  const archives = archive.manifest?.archives ?? [];

  return (
    <div className="space-y-4">
      {/* Header with create button */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{t('archive.browse.title')}</h3>
        <Button size="sm" onClick={() => setIsCreateOpen(true)} disabled={archive.isCreatingArchive || archive.isDeletingArchive}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          {t('archive.browse.empty.cta')}
        </Button>
      </div>

      {/* Archive storage path */}
      {archiveBasePath && (
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/40 text-2xs text-muted-foreground">
          <span className="truncate flex-1 font-mono">{archiveBasePath}</span>
          {isTauri() && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 shrink-0"
              onClick={handleOpenInFileManager}
              aria-label={t('archive.browse.openFolder')}
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      )}

      {/* Archive list */}
      {archives.length === 0 ? (
        <div className="text-center py-12">
          <Package className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">
            {t('archive.browse.empty.title')}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {t('archive.browse.empty.description')}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {archives.map((entry) => (
            <Card key={entry.id} className="overflow-hidden">
              <div
                className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => handleExpandArchive(entry.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleExpandArchive(entry.id);
                  }
                }}
              >
                {expandedArchiveId === entry.id ? (
                  <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                )}
                <Archive className="w-4 h-4 text-accent shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{entry.name}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-2xs text-muted-foreground">
                      {t('archive.browse.card.created', {
                        date: new Date(entry.createdAt).toLocaleDateString(),
                      })}
                    </span>
                    <span className="text-muted-foreground/40">·</span>
                    <span className="text-2xs text-muted-foreground">
                      {t('archive.browse.card.sessions', { count: entry.sessionCount })}
                    </span>
                    <span className="text-muted-foreground/40">·</span>
                    <span className="text-2xs text-muted-foreground">
                      {formatBytes(entry.totalSizeBytes)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    aria-label={t('archive.browse.card.rename')}
                    disabled={archive.isCreatingArchive || archive.isDeletingArchive}
                    onClick={(e) => {
                      e.stopPropagation();
                      setTargetArchive(entry);
                      setRenameName(entry.name);
                      setIsRenameOpen(true);
                    }}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    aria-label={t('archive.browse.card.delete')}
                    disabled={archive.isCreatingArchive || archive.isDeletingArchive}
                    onClick={(e) => {
                      e.stopPropagation();
                      setTargetArchive(entry);
                      setIsDeleteOpen(true);
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {/* Expanded session list */}
              {expandedArchiveId === entry.id && (
                <CardContent className="pt-0 pb-3 px-3 border-t border-border/30">
                  {archive.isLoadingSessions ? (
                    <div className="flex items-center justify-center gap-2 py-3">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                      <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
                    </div>
                  ) : archive.error && archive.currentArchiveId === entry.id ? (
                    <p className="text-xs text-destructive py-3 text-center">
                      {t('archive.error.loadSessionsFailed')}
                    </p>
                  ) : archive.currentArchiveSessions.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-3 text-center">
                      {t('archive.browse.sessions.empty')}
                    </p>
                  ) : (
                    <div className="space-y-1 mt-2">
                      {archive.currentArchiveSessions.map((session) => (
                        <div key={session.sessionId}>
                          <div className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/30 transition-colors">
                            <MessageSquare className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs truncate">
                                {session.summary || session.fileName}
                              </p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-2xs text-muted-foreground">
                                  {t('archive.browse.sessions.messages', {
                                    count: session.messageCount,
                                  })}
                                </span>
                                {session.subagentCount > 0 && (
                                  <>
                                    <span className="text-muted-foreground/40">·</span>
                                    <span className="text-2xs text-muted-foreground">
                                      {t('archive.browse.sessions.subagents', {
                                        count: session.subagentCount,
                                      })}
                                    </span>
                                  </>
                                )}
                                <span className="text-muted-foreground/40">·</span>
                                <span className="text-2xs text-muted-foreground">
                                  {formatBytes(session.sizeBytes)}
                                </span>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 shrink-0"
                              aria-label={t('archive.browse.sessions.export')}
                              disabled={exportingSessionId === session.sessionId}
                              onClick={() => handleExportSession(entry.id, session)}
                            >
                              {exportingSessionId === session.sessionId ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Download className="w-3.5 h-3.5" />
                              )}
                            </Button>
                          </div>
                          {session.subagents.length > 0 && (
                            <div className="ml-6 pl-2 border-l border-border/30 space-y-0.5">
                              {session.subagents.map((subagent) => {
                                const trackingId = `${session.sessionId}/${subagent.fileName}`;
                                return (
                                  <div
                                    key={subagent.fileName}
                                    className="flex items-center gap-2 p-1.5 rounded-md hover:bg-muted/20 transition-colors"
                                  >
                                    <Bot className="w-3 h-3 text-muted-foreground/60 shrink-0" />
                                    <div className="min-w-0 flex-1">
                                      <p className="text-2xs truncate text-muted-foreground">
                                        {subagent.fileName.replace(/\.jsonl$/, '')}
                                      </p>
                                      <div className="flex items-center gap-2 mt-0.5">
                                        <span className="text-2xs text-muted-foreground/60">
                                          {t('archive.browse.sessions.messages', {
                                            count: subagent.messageCount,
                                          })}
                                        </span>
                                        <span className="text-muted-foreground/30">·</span>
                                        <span className="text-2xs text-muted-foreground/60">
                                          {formatBytes(subagent.sizeBytes)}
                                        </span>
                                      </div>
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 w-6 p-0 shrink-0"
                                      aria-label={t('archive.browse.sessions.export')}
                                      disabled={exportingSessionId === trackingId}
                                      onClick={() => handleExportSubagent(entry.id, session.sessionId, subagent.fileName)}
                                    >
                                      {exportingSessionId === trackingId ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                      ) : (
                                        <Download className="w-3 h-3" />
                                      )}
                                    </Button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Create Archive Dialog */}
      <ArchiveCreateDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} />

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('archive.browse.delete.title')}</DialogTitle>
            <DialogDescription>
              {t('archive.browse.delete.description', {
                name: targetArchive?.name ?? '',
                count: targetArchive?.sessionCount ?? 0,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteOpen(false)}>
              {t('archive.browse.delete.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={archive.isDeletingArchive}
            >
              {archive.isDeletingArchive ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : null}
              {t('archive.browse.delete.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={isRenameOpen} onOpenChange={setIsRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('archive.browse.rename.title')}</DialogTitle>
            <DialogDescription className="sr-only">
              {t('archive.browse.rename.label')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`${formId}-rename`}>{t('archive.browse.rename.label')}</Label>
            <Input
              id={`${formId}-rename`}
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRenameOpen(false)}>
              {t('archive.browse.rename.cancel')}
            </Button>
            <Button onClick={handleRename} disabled={!renameName.trim() || archive.isRenamingArchive}>
              {archive.isRenamingArchive && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              {t('archive.browse.rename.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
