/**
 * useProjectSessions
 *
 * Loads sessions for a given project independently from the global store.
 * Used by ArchiveCreateDialog to avoid coupling to sidebar selection.
 */

import { useState, useCallback, useMemo } from 'react';
import { api } from '@/services/api';
import { useAppStore } from '@/store/useAppStore';
import { toast } from 'sonner';
import type { ClaudeProject, ClaudeSession } from '@/types';

const isSubagentSession = (s: ClaudeSession) =>
  s.file_path.includes('/subagents/') || s.file_path.includes('\\subagents\\');

export function useProjectSessions() {
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const mainSessions = useMemo(
    () => sessions.filter((s) => !isSubagentSession(s)),
    [sessions]
  );
  const subagentSessions = useMemo(
    () => sessions.filter(isSubagentSession),
    [sessions]
  );

  const loadSessions = useCallback(async (project: ClaudeProject) => {
    setIsLoading(true);
    setSessions([]);
    try {
      const provider = project.provider ?? 'claude';
      const { excludeSidechain } = useAppStore.getState();
      const result =
        provider !== 'claude'
          ? await api<ClaudeSession[]>('load_provider_sessions', {
              provider,
              projectPath: project.path,
              excludeSidechain,
            })
          : await api<ClaudeSession[]>('load_project_sessions', {
              projectPath: project.path,
              excludeSidechain,
            });
      setSessions(result);
    } catch (error) {
      console.error('Failed to load project sessions:', error);
      toast.error(error instanceof Error ? error.message : String(error));
      setSessions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearSessions = useCallback(() => {
    setSessions([]);
  }, []);

  return { sessions, mainSessions, subagentSessions, isLoading, loadSessions, clearSessions };
}
