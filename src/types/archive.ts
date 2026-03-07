/**
 * Archive Manager Types
 * Maps to Rust structs in src-tauri/src/commands/archive.rs
 */

export interface ArchiveManifest {
  version: number;
  archives: ArchiveEntry[];
}

export interface ArchiveEntry {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  sourceProvider: string;
  sourceProjectPath: string;
  sourceProjectName: string;
  sessionCount: number;
  totalSizeBytes: number;
  includeSubagents: boolean;
}

export interface ArchiveSessionInfo {
  sessionId: string;
  fileName: string;
  originalFilePath: string;
  messageCount: number;
  firstMessageTime: string;
  lastMessageTime: string;
  summary: string | null;
  sizeBytes: number;
  subagentCount: number;
  subagentSizeBytes: number;
  subagents: SubagentFileInfo[];
}

export interface SubagentFileInfo {
  fileName: string;
  sizeBytes: number;
  messageCount: number;
}

export interface ArchiveDiskUsage {
  totalBytes: number;
  archiveCount: number;
  sessionCount: number;
  perArchive: ArchiveDiskEntry[];
}

export interface ArchiveDiskEntry {
  archiveId: string;
  archiveName: string;
  sizeBytes: number;
  sessionCount: number;
}

export interface ExpiringSession {
  session: import('./core/session').ClaudeSession;
  daysRemaining: number;
  fileSizeBytes: number;
  subagentCount: number;
}

export interface ExportResult {
  content: string;
  format: string;
  sessionId: string;
}

export type ArchiveViewTab = 'overview' | 'browse';
