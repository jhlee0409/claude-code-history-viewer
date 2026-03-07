/**
 * Archive API Service
 *
 * Thin wrapper around the api() adapter for archive-related backend commands.
 * Works in both Tauri desktop mode and WebUI server mode.
 */

import { api } from './api';
import type {
  ArchiveManifest,
  ArchiveEntry,
  ArchiveSessionInfo,
  ArchiveDiskUsage,
  ExpiringSession,
  ExportResult,
  ClaudeMessage,
} from '@/types';

export const archiveApi = {
  getBasePath: () => api<string>('get_archive_base_path'),

  listArchives: () => api<ArchiveManifest>('list_archives'),

  createArchive: (params: {
    name: string;
    description?: string | null;
    sessionFilePaths: string[];
    sourceProvider: string;
    sourceProjectPath: string;
    sourceProjectName: string;
    includeSubagents?: boolean;
  }) =>
    api<ArchiveEntry>('create_archive', {
      name: params.name,
      description: params.description ?? null,
      sessionFilePaths: params.sessionFilePaths,
      sourceProvider: params.sourceProvider,
      sourceProjectPath: params.sourceProjectPath,
      sourceProjectName: params.sourceProjectName,
      includeSubagents: params.includeSubagents ?? true,
    }),

  deleteArchive: (archiveId: string) =>
    api<void>('delete_archive', { archiveId }),

  renameArchive: (archiveId: string, newName: string) =>
    api<string>('rename_archive', { archiveId, newName }),

  getArchiveSessions: (archiveId: string) =>
    api<ArchiveSessionInfo[]>('get_archive_sessions', { archiveId }),

  loadArchiveSessionMessages: (archiveId: string, sessionFileName: string) =>
    api<ClaudeMessage[]>('load_archive_session_messages', {
      archiveId,
      sessionFileName,
    }),

  getDiskUsage: () => api<ArchiveDiskUsage>('get_archive_disk_usage'),

  getExpiringSessions: (projectPath: string, thresholdDays?: number) =>
    api<ExpiringSession[]>('get_expiring_sessions', {
      projectPath,
      thresholdDays: thresholdDays ?? 7,
    }),

  exportSession: (sessionFilePath: string, format: 'json') =>
    api<ExportResult>('export_session', { sessionFilePath, format }),
};
