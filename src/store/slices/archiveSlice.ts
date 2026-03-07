/**
 * Archive Slice
 *
 * Manages archive manager state: list of archives, current archive sessions,
 * disk usage, expiring sessions, and async operation flags.
 */

import type { StateCreator } from 'zustand';
import type {
  ArchiveManifest,
  ArchiveEntry,
  ArchiveSessionInfo,
  ArchiveDiskUsage,
  ArchiveViewTab,
  ExpiringSession,
} from '@/types';
import { archiveApi } from '@/services/archiveApi';
import type { FullAppStore } from './types';

// ============================================================================
// State Interface
// ============================================================================

export interface ArchiveSliceState {
  archive: {
    manifest: ArchiveManifest | null;
    currentArchiveId: string | null;
    currentArchiveSessions: ArchiveSessionInfo[];
    diskUsage: ArchiveDiskUsage | null;
    expiringSessions: ExpiringSession[];
    activeTab: ArchiveViewTab;
    isLoadingArchives: boolean;
    isCreatingArchive: boolean;
    isDeletingArchive: boolean;
    isLoadingSessions: boolean;
    isLoadingExpiring: boolean;
    isLoadingDiskUsage: boolean;
    isRenamingArchive: boolean;
    isExporting: boolean;
    error: string | null;
  };
}

export interface ArchiveSliceActions {
  loadArchives: () => Promise<void>;
  createArchive: (params: {
    name: string;
    description?: string | null;
    sessionFilePaths: string[];
    sourceProvider: string;
    sourceProjectPath: string;
    sourceProjectName: string;
    includeSubagents?: boolean;
  }) => Promise<ArchiveEntry>;
  deleteArchive: (id: string) => Promise<void>;
  renameArchive: (id: string, name: string) => Promise<void>;
  loadArchiveSessions: (id: string) => Promise<void>;
  loadDiskUsage: () => Promise<void>;
  loadExpiringSessions: (projectPath: string, thresholdDays?: number) => Promise<void>;
  exportSession: (path: string, format: 'json') => Promise<string>;
  setArchiveActiveTab: (tab: ArchiveViewTab) => void;
  clearArchiveError: () => void;
  resetArchive: () => void;
}

export type ArchiveSlice = ArchiveSliceState & ArchiveSliceActions;

// ============================================================================
// Initial State
// ============================================================================

const initialArchiveState: ArchiveSliceState['archive'] = {
  manifest: null,
  currentArchiveId: null,
  currentArchiveSessions: [],
  diskUsage: null,
  expiringSessions: [],
  activeTab: 'overview',
  isLoadingArchives: false,
  isCreatingArchive: false,
  isDeletingArchive: false,
  isLoadingSessions: false,
  isLoadingExpiring: false,
  isLoadingDiskUsage: false,
  isRenamingArchive: false,
  isExporting: false,
  error: null,
};

// ============================================================================
// Slice Creator
// ============================================================================

export const createArchiveSlice: StateCreator<
  FullAppStore,
  [],
  [],
  ArchiveSlice
> = (set) => ({
  archive: { ...initialArchiveState },

  loadArchives: async () => {
    set((s) => ({ archive: { ...s.archive, isLoadingArchives: true, error: null } }));
    try {
      const manifest = await archiveApi.listArchives();
      set((s) => ({ archive: { ...s.archive, manifest, isLoadingArchives: false } }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      set((s) => ({ archive: { ...s.archive, isLoadingArchives: false, error: msg } }));
    }
  },

  createArchive: async (params) => {
    set((s) => ({ archive: { ...s.archive, isCreatingArchive: true, error: null } }));
    try {
      const entry = await archiveApi.createArchive(params);
      // Reload manifest to get updated list
      const manifest = await archiveApi.listArchives();
      set((s) => ({ archive: { ...s.archive, manifest, isCreatingArchive: false } }));
      return entry;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      set((s) => ({ archive: { ...s.archive, isCreatingArchive: false, error: msg } }));
      throw error;
    }
  },

  deleteArchive: async (id) => {
    set((s) => ({ archive: { ...s.archive, isDeletingArchive: true, error: null } }));
    try {
      await archiveApi.deleteArchive(id);
      const manifest = await archiveApi.listArchives();
      set((s) => ({
        archive: {
          ...s.archive,
          manifest,
          isDeletingArchive: false,
          // Read currentArchiveId from the callback state (s) to avoid stale closure
          currentArchiveId: s.archive.currentArchiveId === id ? null : s.archive.currentArchiveId,
          currentArchiveSessions:
            s.archive.currentArchiveId === id ? [] : s.archive.currentArchiveSessions,
        },
      }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      set((s) => ({ archive: { ...s.archive, isDeletingArchive: false, error: msg } }));
      throw error;
    }
  },

  renameArchive: async (id, name) => {
    set((s) => ({ archive: { ...s.archive, isRenamingArchive: true, error: null } }));
    try {
      await archiveApi.renameArchive(id, name);
      const manifest = await archiveApi.listArchives();
      set((s) => ({ archive: { ...s.archive, manifest, isRenamingArchive: false } }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      set((s) => ({ archive: { ...s.archive, isRenamingArchive: false, error: msg } }));
      throw error;
    }
  },

  loadArchiveSessions: async (id) => {
    set((s) => ({
      archive: {
        ...s.archive,
        currentArchiveId: id,
        currentArchiveSessions: [],
        isLoadingSessions: true,
        error: null,
      },
    }));
    try {
      const sessions = await archiveApi.getArchiveSessions(id);
      set((s) => {
        // Guard against stale response from a previous request
        if (s.archive.currentArchiveId !== id) return s;
        return { archive: { ...s.archive, currentArchiveSessions: sessions, isLoadingSessions: false } };
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      set((s) => {
        if (s.archive.currentArchiveId !== id) return s;
        return { archive: { ...s.archive, isLoadingSessions: false, error: msg } };
      });
    }
  },

  loadDiskUsage: async () => {
    set((s) => ({ archive: { ...s.archive, isLoadingDiskUsage: true, error: null } }));
    try {
      const diskUsage = await archiveApi.getDiskUsage();
      set((s) => ({ archive: { ...s.archive, diskUsage, isLoadingDiskUsage: false } }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      set((s) => ({ archive: { ...s.archive, isLoadingDiskUsage: false, error: msg } }));
    }
  },

  loadExpiringSessions: async (projectPath, thresholdDays) => {
    set((s) => ({ archive: { ...s.archive, isLoadingExpiring: true, expiringSessions: [], error: null } }));
    try {
      const expiringSessions = await archiveApi.getExpiringSessions(projectPath, thresholdDays);
      set((s) => ({ archive: { ...s.archive, expiringSessions, isLoadingExpiring: false } }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      set((s) => ({ archive: { ...s.archive, isLoadingExpiring: false, error: msg } }));
    }
  },

  exportSession: async (path, format) => {
    set((s) => ({ archive: { ...s.archive, isExporting: true, error: null } }));
    try {
      const result = await archiveApi.exportSession(path, format);
      set((s) => ({ archive: { ...s.archive, isExporting: false } }));
      return result.content;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      set((s) => ({ archive: { ...s.archive, isExporting: false, error: msg } }));
      throw error;
    }
  },

  setArchiveActiveTab: (tab) => {
    set((s) => ({ archive: { ...s.archive, activeTab: tab } }));
  },

  clearArchiveError: () => {
    set((s) => ({ archive: { ...s.archive, error: null } }));
  },

  resetArchive: () => {
    set({ archive: { ...initialArchiveState } });
  },
});
