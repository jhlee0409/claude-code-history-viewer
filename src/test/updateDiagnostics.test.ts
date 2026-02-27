import { describe, expect, it } from 'vitest';
import { buildUpdateDiagnostics } from '@/utils/updateDiagnostics';
import type { UpdateState } from '@/hooks/useUpdater';

function createState(overrides: Partial<UpdateState> = {}): UpdateState {
  return {
    isChecking: false,
    hasUpdate: true,
    isDownloading: false,
    isInstalling: false,
    isRestarting: false,
    requiresManualRestart: false,
    downloadProgress: 100,
    error: null,
    updateInfo: null,
    currentVersion: '1.5.0',
    newVersion: '1.5.1',
    ...overrides,
  };
}

describe('buildUpdateDiagnostics', () => {
  it('includes key updater diagnostics fields', () => {
    const text = buildUpdateDiagnostics({
      error: 'update.manual_restart_required',
      state: createState({ isRestarting: true }),
    });

    expect(text).toContain('[Updater Diagnostics]');
    expect(text).toContain('error=update.manual_restart_required');
    expect(text).toContain('currentVersion=1.5.0');
    expect(text).toContain('newVersion=1.5.1');
    expect(text).toContain('isRestarting=true');
    expect(text).toContain('requiresManualRestart=false');
    expect(text).toContain('downloadProgress=100');
  });
});
