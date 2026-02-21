import type { UpdateState } from '@/hooks/useUpdater';

interface BuildUpdateDiagnosticsInput {
  error: string;
  state: UpdateState;
}

export function buildUpdateDiagnostics({
  error,
  state,
}: BuildUpdateDiagnosticsInput): string {
  const timestamp = new Date().toISOString();
  const info = {
    timestamp,
    error,
    currentVersion: state.currentVersion || 'unknown',
    newVersion: state.newVersion || 'unknown',
    hasUpdate: state.hasUpdate,
    isDownloading: state.isDownloading,
    isInstalling: state.isInstalling,
    isRestarting: state.isRestarting,
    downloadProgress: state.downloadProgress,
    userAgent:
      typeof navigator !== 'undefined' && navigator.userAgent
        ? navigator.userAgent
        : 'unknown',
  };

  return [
    '[Updater Diagnostics]',
    `timestamp=${info.timestamp}`,
    `error=${info.error}`,
    `currentVersion=${info.currentVersion}`,
    `newVersion=${info.newVersion}`,
    `hasUpdate=${info.hasUpdate}`,
    `isDownloading=${info.isDownloading}`,
    `isInstalling=${info.isInstalling}`,
    `isRestarting=${info.isRestarting}`,
    `downloadProgress=${info.downloadProgress}`,
    `userAgent=${info.userAgent}`,
  ].join('\n');
}
