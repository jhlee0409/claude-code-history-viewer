/**
 * useProjectSessions
 *
 * Loads sessions for a given project independently from the global store.
 * Used by ArchiveCreateDialog to avoid coupling to sidebar selection.
 */

import { useState, useCallback, useMemo, useRef } from 'react';
import { api } from '@/services/api';
import { useAppStore } from '@/store/useAppStore';
import { toast } from 'sonner';
import { usePendingLoad } from './usePendingLoad';
import type { ClaudeProject, ClaudeSession } from '@/types';

const isSubagentSession = (s: ClaudeSession) =>
  s.file_path.includes('/subagents/') || s.file_path.includes('\\subagents\\');

export function useProjectSessions() {
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  usePendingLoad(isLoading);
  const activeRequestIdRef = useRef(0);

  const mainSessions = useMemo(
    () => sessions.filter((s) => !isSubagentSession(s)),
    [sessions]
  );
  const subagentSessions = useMemo(
    () => sessions.filter(isSubagentSession),
    [sessions]
  );

  const loadSessions = useCallback(async (project: ClaudeProject) => {
    const requestId = activeRequestIdRef.current + 1;
    activeRequestIdRef.current = requestId;
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
      if (requestId !== activeRequestIdRef.current) {
        return;
      }
      setSessions(result);
    } catch (error) {
      if (requestId !== activeRequestIdRef.current) {
        return;
      }
      console.error('Failed to load project sessions:', error);
      toast.error(error instanceof Error ? error.message : String(error));
      setSessions([]);
    } finally {
      if (requestId === activeRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  const clearSessions = useCallback(() => {
    activeRequestIdRef.current += 1;
    setSessions([]);
    setIsLoading(false);
  }, []);

  return { sessions, mainSessions, subagentSessions, isLoading, loadSessions, clearSessions };
}
