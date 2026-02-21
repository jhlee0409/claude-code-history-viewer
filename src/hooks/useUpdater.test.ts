import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { UPDATE_MANUAL_RESTART_REQUIRED_ERROR_CODE } from '@/utils/updateError';

// Use vi.hoisted to create mocks that can be referenced in vi.mock
const { mockCheck, mockRelaunch, mockGetVersion } = vi.hoisted(() => ({
  mockCheck: vi.fn(),
  mockRelaunch: vi.fn(),
  mockGetVersion: vi.fn(),
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

import { useUpdater } from './useUpdater';

describe('useUpdater', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetVersion.mockResolvedValue('1.0.0');
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('initial state', () => {
    it('should have correct initial state', async () => {
      mockCheck.mockResolvedValue(null);

      const { result } = renderHook(() => useUpdater());

      expect(result.current.state.isChecking).toBe(false);
      expect(result.current.state.hasUpdate).toBe(false);
      expect(result.current.state.isDownloading).toBe(false);
      expect(result.current.state.downloadProgress).toBe(0);
      expect(result.current.state.error).toBeNull();

      await waitFor(() => {
        expect(result.current.state.currentVersion).toBe('1.0.0');
      });
    });
  });

  describe('checkForUpdates', () => {
    it('should set isChecking true during check', async () => {
      let resolveCheck: (value: null) => void;
      mockCheck.mockImplementation(
        () => new Promise((resolve) => { resolveCheck = resolve; })
      );

      const { result } = renderHook(() => useUpdater());

      act(() => {
        result.current.checkForUpdates();
      });

      expect(result.current.state.isChecking).toBe(true);

      await act(async () => {
        resolveCheck!(null);
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

      expect(result.current.state.hasUpdate).toBe(true);
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

      act(() => {
        result.current.checkForUpdates();
      });

      expect(result.current.state.isChecking).toBe(true);

      // Fast-forward past timeout (20 seconds)
      await act(async () => {
        vi.advanceTimersByTime(21000);
      });

      expect(result.current.state.isChecking).toBe(false);
      expect(result.current.state.error).toContain('timeout');

      vi.useRealTimers();
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
      expect(result.current.state.error).toBe(UPDATE_MANUAL_RESTART_REQUIRED_ERROR_CODE);
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
      expect(result.current.state.error).toBe(UPDATE_MANUAL_RESTART_REQUIRED_ERROR_CODE);
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
