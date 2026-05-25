import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  UPDATE_DOWNLOAD_COMPLETE_RESTART_CODE,
} from '@/utils/updateError';

// Simulate Tauri environment so isTauri() returns true
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__TAURI_INTERNALS__ = {};
});

afterAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).__TAURI_INTERNALS__;
});

// Use vi.hoisted to create mocks that can be referenced in vi.mock
const { mockCheck, mockRelaunch, mockGetVersion, mockInvoke } = vi.hoisted(() => ({
  mockCheck: vi.fn(),
  mockRelaunch: vi.fn(),
  mockGetVersion: vi.fn(),
  mockInvoke: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: mockCheck,
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: mockRelaunch,
}));

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: mockGetVersion,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

import { useUpdater } from './useUpdater';

describe('useUpdater', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetVersion.mockResolvedValue('1.0.0');
    // Default: simulate force_quit_and_relaunch fallback also failing so
    // existing tests continue to assert the manual-restart UX. Tests that
    // verify the successful fallback path override this with mockResolvedValue.
    mockInvoke.mockRejectedValue(new Error('force_quit_and_relaunch unavailable'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  describe('initial state', () => {
    it('should have correct initial state', async () => {
      mockCheck.mockResolvedValue(null);

      const { result } = renderHook(() => useUpdater());

      expect(result.current.state.isChecking).toBe(false);
      expect(result.current.state.hasUpdate).toBe(false);
      expect(result.current.state.isDownloading).toBe(false);
      expect(result.current.state.isInstalling).toBe(false);
      expect(result.current.state.downloadProgress).toBe(0);
      expect(result.current.state.error).toBeNull();
      expect(result.current.state.requiresManualRestart).toBe(false);

      await waitFor(() => {
        expect(result.current.state.currentVersion).toBe('1.0.0');
      });
    });
  });

  describe('checkForUpdates', () => {
    it('should set isChecking true during check', async () => {
      let resolveCheck: ((value: null) => void) | undefined;
      mockCheck.mockImplementation(
        () => new Promise((resolve) => { resolveCheck = resolve; })
      );

      const { result } = renderHook(() => useUpdater());

      // Start checkForUpdates; async act flushes microtasks (dynamic import)
      // so mockCheck is called and resolveCheck is assigned
      let checkPromise!: Promise<unknown>;
      await act(async () => {
        checkPromise = result.current.checkForUpdates();
      });

      await waitFor(() => {
        expect(mockCheck).toHaveBeenCalledTimes(1);
      });
      expect(result.current.state.isChecking).toBe(true);

      if (!resolveCheck) {
        throw new Error('check resolver was not captured');
      }

      await act(async () => {
        resolveCheck(null);
        await checkPromise;
      });

      expect(result.current.state.isChecking).toBe(false);
    });

    it('should set hasUpdate true when update available', async () => {
      const mockUpdate = {
        version: '2.0.0',
        downloadAndInstall: vi.fn(),
      };
      mockCheck.mockResolvedValue(mockUpdate);

      const { result } = renderHook(() => useUpdater());

      await act(async () => {
        await result.current.checkForUpdates();
      });

      await waitFor(() => {
        expect(result.current.state.hasUpdate).toBe(true);
      });
      expect(result.current.state.updateInfo).toEqual(mockUpdate);
      expect(result.current.state.newVersion).toBe('2.0.0');
    });

    it('should set hasUpdate false when no update', async () => {
      mockCheck.mockResolvedValue(null);

      const { result } = renderHook(() => useUpdater());

      await act(async () => {
        await result.current.checkForUpdates();
      });

      expect(result.current.state.hasUpdate).toBe(false);
      expect(result.current.state.updateInfo).toBeNull();
    });

    it('should handle check error', async () => {
      mockCheck.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useUpdater());

      await act(async () => {
        await result.current.checkForUpdates();
      });

      expect(result.current.state.isChecking).toBe(false);
      expect(result.current.state.error).toBe('Network error');
    });

    it('should timeout after configured duration', async () => {
      vi.useFakeTimers();
      mockCheck.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      const { result } = renderHook(() => useUpdater());

      // Start checkForUpdates inside act so initial state updates are tracked.
      let checkPromise!: Promise<unknown>;
      await act(async () => {
        checkPromise = result.current.checkForUpdates();
      });

      expect(result.current.state.isChecking).toBe(true);

      // Fast-forward past timeout (20 seconds) — use async variant to flush microtasks
      await act(async () => {
        await vi.advanceTimersByTimeAsync(21000);
        await checkPromise;
      });

      expect(result.current.state.isChecking).toBe(false);
      expect(result.current.state.error).toContain('timeout');
    });
  });

  describe('downloadAndInstall', () => {
    it('should call downloadAndInstall and relaunch', async () => {
      const mockDownloadAndInstall = vi.fn().mockImplementation((callback) => {
        callback({ event: 'Started', data: { contentLength: 1000 } });
        callback({ event: 'Progress', data: { chunkLength: 500 } });
        callback({ event: 'Progress', data: { chunkLength: 500 } });
        callback({ event: 'Finished' });
        return Promise.resolve();
      });

      const mockUpdate = {
        version: '2.0.0',
        downloadAndInstall: mockDownloadAndInstall,
      };
      mockCheck.mockResolvedValue(mockUpdate);
      mockRelaunch.mockResolvedValue(undefined);

      const { result } = renderHook(() => useUpdater());

      await act(async () => {
        await result.current.checkForUpdates();
      });

      await act(async () => {
        await result.current.downloadAndInstall();
      });

      expect(mockDownloadAndInstall).toHaveBeenCalled();
      expect(mockRelaunch).toHaveBeenCalled();
    });

    it('should track download progress', async () => {
      const mockDownloadAndInstall = vi.fn().mockImplementation((callback) => {
        callback({ event: 'Started', data: { contentLength: 1000 } });
        callback({ event: 'Progress', data: { chunkLength: 250 } });
        callback({ event: 'Progress', data: { chunkLength: 250 } });
        callback({ event: 'Progress', data: { chunkLength: 500 } });
        callback({ event: 'Finished' });
        return Promise.resolve();
      });

      const mockUpdate = {
        version: '2.0.0',
        downloadAndInstall: mockDownloadAndInstall,
      };
      mockCheck.mockResolvedValue(mockUpdate);
      mockRelaunch.mockResolvedValue(undefined);

      const { result } = renderHook(() => useUpdater());

      await act(async () => {
        await result.current.checkForUpdates();
      });

      await act(async () => {
        await result.current.downloadAndInstall();
      });

      expect(result.current.state.downloadProgress).toBe(100);
    });

    it('should not do anything if no update info', async () => {
      mockCheck.mockResolvedValue(null);

      const { result } = renderHook(() => useUpdater());

      await act(async () => {
        await result.current.checkForUpdates();
      });

      await act(async () => {
        await result.current.downloadAndInstall();
      });

      expect(mockRelaunch).not.toHaveBeenCalled();
    });

    it('should handle download error', async () => {
      const mockDownloadAndInstall = vi.fn().mockRejectedValue(new Error('Download failed'));

      const mockUpdate = {
        version: '2.0.0',
        downloadAndInstall: mockDownloadAndInstall,
      };
      mockCheck.mockResolvedValue(mockUpdate);

      const { result } = renderHook(() => useUpdater());

      await act(async () => {
        await result.current.checkForUpdates();
      });

      await act(async () => {
        await result.current.downloadAndInstall();
      });

      expect(result.current.state.isDownloading).toBe(false);
      expect(result.current.state.error).toBe('Download failed');
    });

    it('should preserve string errors from updater invoke', async () => {
      const mockDownloadAndInstall = vi
        .fn()
        .mockRejectedValue('Failed to move the new app into place');

      const mockUpdate = {
        version: '2.0.0',
        downloadAndInstall: mockDownloadAndInstall,
      };
      mockCheck.mockResolvedValue(mockUpdate);

      const { result } = renderHook(() => useUpdater());

      await act(async () => {
        await result.current.checkForUpdates();
      });

      await act(async () => {
        await result.current.downloadAndInstall();
      });

      expect(result.current.state.error).toBe('Failed to move the new app into place');
    });

    it('should recover from relaunch failure by resetting restarting state', async () => {
      const mockDownloadAndInstall = vi.fn().mockImplementation((callback) => {
        callback({ event: 'Started', data: { contentLength: 1000 } });
        callback({ event: 'Finished' });
        return Promise.resolve();
      });

      const mockUpdate = {
        version: '2.0.0',
        downloadAndInstall: mockDownloadAndInstall,
      };
      mockCheck.mockResolvedValue(mockUpdate);
      mockRelaunch.mockRejectedValue(new Error('Relaunch failed'));

      const { result } = renderHook(() => useUpdater());

      await act(async () => {
        await result.current.checkForUpdates();
      });

      await act(async () => {
        await result.current.downloadAndInstall();
      });

      expect(result.current.state.isDownloading).toBe(false);
      expect(result.current.state.isRestarting).toBe(false);
      expect(result.current.state.requiresManualRestart).toBe(true);
      expect(result.current.state.error).toBe(UPDATE_DOWNLOAD_COMPLETE_RESTART_CODE);
    });

    it('should ask for manual restart when updater fails after finished event', async () => {
      const mockDownloadAndInstall = vi.fn().mockImplementation((callback) => {
        callback({ event: 'Started', data: { contentLength: 1000 } });
        callback({ event: 'Finished' });
        return Promise.reject(new Error('Download failed'));
      });

      const mockUpdate = {
        version: '2.0.0',
        downloadAndInstall: mockDownloadAndInstall,
      };
      mockCheck.mockResolvedValue(mockUpdate);

      const { result } = renderHook(() => useUpdater());

      await act(async () => {
        await result.current.checkForUpdates();
      });

      await act(async () => {
        await result.current.downloadAndInstall();
      });

      expect(mockRelaunch).not.toHaveBeenCalled();
      expect(result.current.state.isDownloading).toBe(false);
      expect(result.current.state.isRestarting).toBe(false);
      expect(result.current.state.requiresManualRestart).toBe(true);
      expect(result.current.state.error).toBe(UPDATE_DOWNLOAD_COMPLETE_RESTART_CODE);
    });

    it('should treat partial download failure as real error, not manual restart', async () => {
      const mockDownloadAndInstall = vi.fn().mockImplementation((callback) => {
        callback({ event: 'Started', data: { contentLength: 1000 } });
        callback({ event: 'Progress', data: { chunkLength: 700 } });
        return Promise.reject(new Error('Download failed'));
      });

      const mockUpdate = {
        version: '2.0.0',
        downloadAndInstall: mockDownloadAndInstall,
      };
      mockCheck.mockResolvedValue(mockUpdate);

      const { result } = renderHook(() => useUpdater());

      await act(async () => {
        await result.current.checkForUpdates();
      });

      await act(async () => {
        await result.current.downloadAndInstall();
      });

      expect(mockRelaunch).not.toHaveBeenCalled();
      expect(result.current.state.isDownloading).toBe(false);
      expect(result.current.state.isRestarting).toBe(false);
      expect(result.current.state.requiresManualRestart).toBe(false);
      expect(result.current.state.error).toBe('Download failed');
    });

    it('should guide manual restart when all bytes downloaded but install fails', async () => {
      const mockDownloadAndInstall = vi.fn().mockImplementation((callback) => {
        callback({ event: 'Started', data: { contentLength: 1000 } });
        callback({ event: 'Progress', data: { chunkLength: 1000 } });
        return Promise.reject(new Error('Install failed'));
      });

      const mockUpdate = {
        version: '2.0.0',
        downloadAndInstall: mockDownloadAndInstall,
      };
      mockCheck.mockResolvedValue(mockUpdate);

      const { result } = renderHook(() => useUpdater());

      await act(async () => {
        await result.current.checkForUpdates();
      });

      await act(async () => {
        await result.current.downloadAndInstall();
      });

      expect(mockRelaunch).not.toHaveBeenCalled();
      expect(result.current.state.isDownloading).toBe(false);
      expect(result.current.state.isRestarting).toBe(false);
      expect(result.current.state.requiresManualRestart).toBe(true);
      expect(result.current.state.error).toBe(UPDATE_DOWNLOAD_COMPLETE_RESTART_CODE);
    });

    it('should guide manual restart when install fails in separated flow (Tauri v2 macOS known issue)', async () => {
      const mockDownload = vi.fn().mockImplementation((callback) => {
        callback({ event: 'Started', data: { contentLength: 1000 } });
        callback({ event: 'Progress', data: { chunkLength: 1000 } });
        callback({ event: 'Finished' });
        return Promise.resolve();
      });
      const mockInstall = vi.fn().mockRejectedValue(new Error('Download failed'));

      const mockUpdate = {
        version: '2.0.0',
        download: mockDownload,
        install: mockInstall,
      };
      mockCheck.mockResolvedValue(mockUpdate);

      const { result } = renderHook(() => useUpdater());

      await act(async () => {
        await result.current.checkForUpdates();
      });

      await act(async () => {
        await result.current.downloadAndInstall();
      });

      expect(mockDownload).toHaveBeenCalledTimes(1);
      expect(mockInstall).toHaveBeenCalledTimes(1);
      expect(mockRelaunch).not.toHaveBeenCalled();
      expect(result.current.state.isInstalling).toBe(false);
      expect(result.current.state.isRestarting).toBe(false);
      expect(result.current.state.requiresManualRestart).toBe(true);
      expect(result.current.state.error).toBe(UPDATE_DOWNLOAD_COMPLETE_RESTART_CODE);
    });

    it('should ask for manual restart when relaunch fails in separated flow', async () => {
      const mockDownload = vi.fn().mockImplementation((callback) => {
        callback({ event: 'Started', data: { contentLength: 1000 } });
        callback({ event: 'Progress', data: { chunkLength: 1000 } });
        callback({ event: 'Finished' });
        return Promise.resolve();
      });
      const mockInstall = vi.fn().mockResolvedValue(undefined);

      const mockUpdate = {
        version: '2.0.0',
        download: mockDownload,
        install: mockInstall,
      };
      mockCheck.mockResolvedValue(mockUpdate);
      mockRelaunch.mockRejectedValue(new Error('Relaunch failed'));

      const { result } = renderHook(() => useUpdater());

      await act(async () => {
        await result.current.checkForUpdates();
      });

      await act(async () => {
        await result.current.downloadAndInstall();
      });

      expect(mockDownload).toHaveBeenCalledTimes(1);
      expect(mockInstall).toHaveBeenCalledTimes(1);
      expect(mockRelaunch).toHaveBeenCalledTimes(1);
      // Fallback was attempted but also failed (default beforeEach), so we end
      // in the manual-restart UX as before.
      expect(mockInvoke).toHaveBeenCalledWith('force_quit_and_relaunch');
      expect(result.current.state.isInstalling).toBe(false);
      expect(result.current.state.isRestarting).toBe(false);
      expect(result.current.state.requiresManualRestart).toBe(true);
      expect(result.current.state.error).toBe(UPDATE_DOWNLOAD_COMPLETE_RESTART_CODE);
    });

    it('should auto-fallback to force_quit_and_relaunch when Tauri relaunch fails', async () => {
      const mockDownload = vi.fn().mockImplementation((callback) => {
        callback({ event: 'Started', data: { contentLength: 1000 } });
        callback({ event: 'Progress', data: { chunkLength: 1000 } });
        callback({ event: 'Finished' });
        return Promise.resolve();
      });
      const mockInstall = vi.fn().mockResolvedValue(undefined);

      const mockUpdate = {
        version: '2.0.0',
        download: mockDownload,
        install: mockInstall,
      };
      mockCheck.mockResolvedValue(mockUpdate);
      mockRelaunch.mockRejectedValue(new Error('Relaunch failed'));
      mockInvoke.mockResolvedValue(undefined); // fallback succeeds

      const { result } = renderHook(() => useUpdater());

      await act(async () => {
        await result.current.checkForUpdates();
      });

      await act(async () => {
        await result.current.downloadAndInstall();
      });

      expect(mockInvoke).toHaveBeenCalledWith('force_quit_and_relaunch');
      // User stays in the "restarting" state — the OS-level helper will close
      // this process and reopen the new bundle.
      expect(result.current.state.isRestarting).toBe(true);
      expect(result.current.state.requiresManualRestart).toBe(false);
      expect(result.current.state.error).toBeNull();
    });

    it('should fall through to manual-restart UX when both relaunch paths fail', async () => {
      const mockDownload = vi.fn().mockImplementation((callback) => {
        callback({ event: 'Started', data: { contentLength: 1000 } });
        callback({ event: 'Progress', data: { chunkLength: 1000 } });
        callback({ event: 'Finished' });
        return Promise.resolve();
      });
      const mockInstall = vi.fn().mockResolvedValue(undefined);

      const mockUpdate = {
        version: '2.0.0',
        download: mockDownload,
        install: mockInstall,
      };
      mockCheck.mockResolvedValue(mockUpdate);
      mockRelaunch.mockRejectedValue(new Error('Relaunch failed'));
      mockInvoke.mockRejectedValue(new Error('helper spawn failed'));

      const { result } = renderHook(() => useUpdater());

      await act(async () => {
        await result.current.checkForUpdates();
      });

      await act(async () => {
        await result.current.downloadAndInstall();
      });

      expect(mockInvoke).toHaveBeenCalledWith('force_quit_and_relaunch');
      expect(result.current.state.isRestarting).toBe(false);
      expect(result.current.state.requiresManualRestart).toBe(true);
      expect(result.current.state.error).toBe(UPDATE_DOWNLOAD_COMPLETE_RESTART_CODE);
    });

    it('should not invoke force_quit_and_relaunch on partial download failure', async () => {
      const mockDownloadAndInstall = vi.fn().mockImplementation((callback) => {
        callback({ event: 'Started', data: { contentLength: 1000 } });
        callback({ event: 'Progress', data: { chunkLength: 700 } });
        return Promise.reject(new Error('Download failed'));
      });

      const mockUpdate = {
        version: '2.0.0',
        downloadAndInstall: mockDownloadAndInstall,
      };
      mockCheck.mockResolvedValue(mockUpdate);
      mockInvoke.mockResolvedValue(undefined); // would succeed if called

      const { result } = renderHook(() => useUpdater());

      await act(async () => {
        await result.current.checkForUpdates();
      });

      await act(async () => {
        await result.current.downloadAndInstall();
      });

      // Download did not complete, so the fallback must not run.
      expect(mockInvoke).not.toHaveBeenCalled();
      expect(result.current.state.requiresManualRestart).toBe(false);
      expect(result.current.state.error).toBe('Download failed');
    });
  });

  describe('dismissUpdate', () => {
    it('should reset update state', async () => {
      const mockUpdate = {
        version: '2.0.0',
        downloadAndInstall: vi.fn(),
      };
      mockCheck.mockResolvedValue(mockUpdate);

      const { result } = renderHook(() => useUpdater());

      await act(async () => {
        await result.current.checkForUpdates();
      });

      expect(result.current.state.hasUpdate).toBe(true);

      act(() => {
        result.current.dismissUpdate();
      });

      expect(result.current.state.hasUpdate).toBe(false);
      expect(result.current.state.updateInfo).toBeNull();
      expect(result.current.state.error).toBeNull();
    });
  });
});
