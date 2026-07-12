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
    currentArchiveSessionsError: string | null;
    diskUsage: ArchiveDiskUsage | null;
    expiringSessions: ExpiringSession[];
    expiringError: string | null;
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
  renameArchive: (id: string, name: string) => Promise<string>;
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
  currentArchiveSessionsError: null,
  diskUsage: null,
  expiringSessions: [],
  expiringError: null,
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

const READ_ONLY_ERROR = "Server is running in read-only mode";

// ============================================================================
// Slice Creator
// ============================================================================

export const createArchiveSlice: StateCreator<
  FullAppStore,
  [],
  [],
  ArchiveSlice
> = (set, get) => {
  let archiveSessionsRequestId = 0;
  let expiringSessionsRequestId = 0;

  return {
    archive: { ...initialArchiveState },

    loadArchives: async () => {
      if (get().archive.isLoadingArchives) {
        return;
      }
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
      if (get().isServerReadOnly) {
        set((s) => ({ archive: { ...s.archive, error: READ_ONLY_ERROR } }));
        throw new Error(READ_ONLY_ERROR);
      }
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
      if (get().isServerReadOnly) {
        set((s) => ({ archive: { ...s.archive, error: READ_ONLY_ERROR } }));
        throw new Error(READ_ONLY_ERROR);
      }
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
            currentArchiveSessionsError:
              s.archive.currentArchiveId === id ? null : s.archive.currentArchiveSessionsError,
          },
        }));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        set((s) => ({ archive: { ...s.archive, isDeletingArchive: false, error: msg } }));
        throw error;
      }
    },

    renameArchive: async (id, name) => {
      if (get().isServerReadOnly) {
        set((s) => ({ archive: { ...s.archive, error: READ_ONLY_ERROR } }));
        throw new Error(READ_ONLY_ERROR);
      }
      set((s) => ({ archive: { ...s.archive, isRenamingArchive: true, error: null } }));
      try {
        const newId = await archiveApi.renameArchive(id, name);
        const manifest = await archiveApi.listArchives();
        set((s) => ({
          archive: {
            ...s.archive,
            manifest,
            isRenamingArchive: false,
            currentArchiveId: s.archive.currentArchiveId === id ? newId : s.archive.currentArchiveId,
          },
        }));
        return newId;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        set((s) => ({ archive: { ...s.archive, isRenamingArchive: false, error: msg } }));
        throw error;
      }
    },

    loadArchiveSessions: async (id) => {
      const requestId = ++archiveSessionsRequestId;
      set((s) => ({
        archive: {
          ...s.archive,
          currentArchiveId: id,
          currentArchiveSessions: [],
          currentArchiveSessionsError: null,
          isLoadingSessions: true,
        },
      }));
      try {
        const sessions = await archiveApi.getArchiveSessions(id);
        set((s) => {
          if (
            requestId !== archiveSessionsRequestId ||
            s.archive.currentArchiveId !== id
          ) {
            return s;
          }
          return {
            archive: {
              ...s.archive,
              currentArchiveSessions: sessions,
              currentArchiveSessionsError: null,
              isLoadingSessions: false,
            },
          };
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        set((s) => {
          if (
            requestId !== archiveSessionsRequestId ||
            s.archive.currentArchiveId !== id
          ) {
            return s;
          }
          return {
            archive: {
              ...s.archive,
              currentArchiveSessionsError: msg,
              isLoadingSessions: false,
            },
          };
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
      const requestId = ++expiringSessionsRequestId;
      set((s) => ({
        archive: {
          ...s.archive,
          isLoadingExpiring: true,
          expiringSessions: [],
          expiringError: null,
        },
      }));
      try {
        const expiringSessions = await archiveApi.getExpiringSessions(
          projectPath,
          thresholdDays
        );
        set((s) => {
          if (requestId !== expiringSessionsRequestId) {
            return s;
          }
          return {
            archive: {
              ...s.archive,
              expiringSessions,
              expiringError: null,
              isLoadingExpiring: false,
            },
          };
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        set((s) => {
          if (requestId !== expiringSessionsRequestId) {
            return s;
          }
          return {
            archive: {
              ...s.archive,
              expiringError: msg,
              isLoadingExpiring: false,
            },
          };
        });
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
      set((s) => ({
        archive: {
          ...s.archive,
          error: null,
          currentArchiveSessionsError: null,
          expiringError: null,
        },
      }));
    },

    resetArchive: () => {
      archiveSessionsRequestId += 1;
      expiringSessionsRequestId += 1;
      set({ archive: { ...initialArchiveState } });
    },
  };
};
