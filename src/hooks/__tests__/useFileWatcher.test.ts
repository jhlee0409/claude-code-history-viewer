import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// Use vi.hoisted to create mocks that can be referenced in vi.mock
const { mockListen, mockToastError } = vi.hoisted(() => ({
  mockListen: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: mockListen,
}));

vi.mock('sonner', () => ({
  toast: {
    error: mockToastError,
  },
}));

import { useFileWatcher } from '../useFileWatcher';

describe('useFileWatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('initial state', () => {
    it('should not set up listeners when enabled is false', async () => {
      renderHook(() => useFileWatcher({ enabled: false }));

      // Give time for any async effects to run
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockListen).not.toHaveBeenCalled();
    });

    it('should set up event listeners on mount when enabled is true', async () => {
      const mockUnlisten = vi.fn();
      mockListen.mockResolvedValue(mockUnlisten);

      renderHook(() => useFileWatcher({ enabled: true }));

      await waitFor(() => {
        expect(mockListen).toHaveBeenCalledTimes(3);
      });

      expect(mockListen).toHaveBeenCalledWith('session-file-changed', expect.any(Function));
      expect(mockListen).toHaveBeenCalledWith('session-file-created', expect.any(Function));
      expect(mockListen).toHaveBeenCalledWith('session-file-deleted', expect.any(Function));
    });

    it('should default to enabled when no options provided', async () => {
      const mockUnlisten = vi.fn();
      mockListen.mockResolvedValue(mockUnlisten);

      renderHook(() => useFileWatcher());

      await waitFor(() => {
        expect(mockListen).toHaveBeenCalledTimes(3);
      });
    });

    it('should set isWatching to true after successful start', async () => {
      const mockUnlisten = vi.fn();
      mockListen.mockResolvedValue(mockUnlisten);

      const { result } = renderHook(() => useFileWatcher({ enabled: true }));

      await waitFor(() => {
        expect(result.current.isWatching).toBe(true);
      });
    });
  });

  describe('cleanup', () => {
    it('should clean up event listeners on unmount', async () => {
      const mockUnlisten = vi.fn();
      mockListen.mockResolvedValue(mockUnlisten);

      const { unmount } = renderHook(() => useFileWatcher({ enabled: true }));

      await waitFor(() => {
        expect(mockListen).toHaveBeenCalledTimes(3);
      });

      unmount();

      expect(mockUnlisten).toHaveBeenCalledTimes(3);
    });
  });

  describe('event callbacks', () => {
    it('should call onSessionChanged callback when session-file-changed event is received', async () => {
      const mockUnlisten = vi.fn();
      let capturedCallback: ((event: { payload: unknown }) => void) | undefined;

      mockListen.mockImplementation((eventName, callback) => {
        if (eventName === 'session-file-changed') {
          capturedCallback = callback;
        }
        return Promise.resolve(mockUnlisten);
      });

      const onSessionChanged = vi.fn();
      renderHook(() =>
        useFileWatcher({ enabled: true, onSessionChanged, debounceMs: 0 })
      );

      await waitFor(() => {
        expect(mockListen).toHaveBeenCalledTimes(3);
      });

      // Simulate event
      const eventPayload = {
        projectPath: '/test/project',
        sessionPath: '/test/session.jsonl',
        eventType: 'changed' as const,
      };

      capturedCallback?.({ payload: eventPayload });

      // Wait for callback (debounce is 0)
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(onSessionChanged).toHaveBeenCalledWith(eventPayload);
    });

    it('should call onSessionCreated callback when session-file-created event is received', async () => {
      const mockUnlisten = vi.fn();
      let capturedCallback: ((event: { payload: unknown }) => void) | undefined;

      mockListen.mockImplementation((eventName, callback) => {
        if (eventName === 'session-file-created') {
          capturedCallback = callback;
        }
        return Promise.resolve(mockUnlisten);
      });

      const onSessionCreated = vi.fn();
      renderHook(() =>
        useFileWatcher({ enabled: true, onSessionCreated, debounceMs: 0 })
      );

      await waitFor(() => {
        expect(mockListen).toHaveBeenCalledTimes(3);
      });

      const eventPayload = {
        projectPath: '/test/project',
        sessionPath: '/test/session.jsonl',
        eventType: 'created' as const,
      };

      capturedCallback?.({ payload: eventPayload });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(onSessionCreated).toHaveBeenCalledWith(eventPayload);
    });

    it('should call onSessionDeleted callback when session-file-deleted event is received', async () => {
      const mockUnlisten = vi.fn();
      let capturedCallback: ((event: { payload: unknown }) => void) | undefined;

      mockListen.mockImplementation((eventName, callback) => {
        if (eventName === 'session-file-deleted') {
          capturedCallback = callback;
        }
        return Promise.resolve(mockUnlisten);
      });

      const onSessionDeleted = vi.fn();
      renderHook(() =>
        useFileWatcher({ enabled: true, onSessionDeleted, debounceMs: 0 })
      );

      await waitFor(() => {
        expect(mockListen).toHaveBeenCalledTimes(3);
      });

      const eventPayload = {
        projectPath: '/test/project',
        sessionPath: '/test/session.jsonl',
        eventType: 'deleted' as const,
      };

      capturedCallback?.({ payload: eventPayload });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(onSessionDeleted).toHaveBeenCalledWith(eventPayload);
    });
  });

  describe('debouncing', () => {
    it('should debounce rapid events with same key', async () => {
      vi.useFakeTimers();

      const mockUnlisten = vi.fn();
      let capturedCallback: ((event: { payload: unknown }) => void) | undefined;

      mockListen.mockImplementation((eventName, callback) => {
        if (eventName === 'session-file-changed') {
          capturedCallback = callback;
        }
        return Promise.resolve(mockUnlisten);
      });

      const onSessionChanged = vi.fn();
      renderHook(() =>
        useFileWatcher({ enabled: true, onSessionChanged, debounceMs: 300 })
      );

      // Manually advance for the useEffect to run
      await vi.advanceTimersByTimeAsync(10);

      // Fire multiple events rapidly
      const eventPayload = {
        projectPath: '/test/project',
        sessionPath: '/test/session.jsonl',
        eventType: 'changed' as const,
      };

      capturedCallback?.({ payload: eventPayload });
      capturedCallback?.({ payload: eventPayload });
      capturedCallback?.({ payload: eventPayload });

      // Should not have been called yet
      expect(onSessionChanged).not.toHaveBeenCalled();

      // Advance timers past debounce
      await vi.advanceTimersByTimeAsync(350);

      // Should only be called once
      expect(onSessionChanged).toHaveBeenCalledTimes(1);
      expect(onSessionChanged).toHaveBeenCalledWith(eventPayload);

      vi.useRealTimers();
    });
  });

  describe('manual control', () => {
    it('should provide startWatching function', async () => {
      const mockUnlisten = vi.fn();
      mockListen.mockResolvedValue(mockUnlisten);

      const { result } = renderHook(() => useFileWatcher({ enabled: false }));

      expect(result.current.startWatching).toBeInstanceOf(Function);
    });

    it('should provide stopWatching function', async () => {
      const mockUnlisten = vi.fn();
      mockListen.mockResolvedValue(mockUnlisten);

      const { result } = renderHook(() => useFileWatcher({ enabled: false }));

      expect(result.current.stopWatching).toBeInstanceOf(Function);
    });

    it('should call unlisten when stopWatching is called', async () => {
      const mockUnlisten = vi.fn();
      mockListen.mockResolvedValue(mockUnlisten);

      const { result } = renderHook(() => useFileWatcher({ enabled: true }));

      await waitFor(() => {
        expect(mockListen).toHaveBeenCalledTimes(3);
      });

      act(() => {
        result.current.stopWatching();
      });

      expect(mockUnlisten).toHaveBeenCalledTimes(3);
    });

    it('should set isWatching to false after stopWatching', async () => {
      const mockUnlisten = vi.fn();
      mockListen.mockResolvedValue(mockUnlisten);

      const { result } = renderHook(() => useFileWatcher({ enabled: true }));

      await waitFor(() => {
        expect(result.current.isWatching).toBe(true);
      });

      act(() => {
        result.current.stopWatching();
      });

      expect(result.current.isWatching).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle listen errors gracefully and show toast', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockListen.mockRejectedValue(new Error('Listen failed'));

      renderHook(() => useFileWatcher({ enabled: true }));

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Failed to start file watcher:',
          expect.any(Error)
        );
      });

      expect(mockToastError).toHaveBeenCalledWith('Failed to start file watcher');

      consoleErrorSpy.mockRestore();
    });

    it('should set isWatching to false on error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockListen.mockRejectedValue(new Error('Listen failed'));

      const { result } = renderHook(() => useFileWatcher({ enabled: true }));

      await waitFor(() => {
        expect(result.current.isWatching).toBe(false);
      });

      vi.restoreAllMocks();
    });
  });

  describe('cancellation', () => {
    it('should abort in-flight startWatching when stopWatching is called', async () => {
      const mockUnlisten = vi.fn();
      let resolveFirst: ((value: () => void) => void) | undefined;

      // Make the first listen call hang until we resolve it
      mockListen.mockImplementationOnce(
        () => new Promise<() => void>((resolve) => { resolveFirst = resolve; })
      );
      mockListen.mockResolvedValue(mockUnlisten);

      const { result } = renderHook(() => useFileWatcher({ enabled: true }));

      // stopWatching while startWatching is still in progress
      act(() => {
        result.current.stopWatching();
      });

      // Now resolve the hanging listen - should be cancelled
      resolveFirst?.(mockUnlisten);

      await new Promise((resolve) => setTimeout(resolve, 50));

      // isWatching should remain false because stop was called
      expect(result.current.isWatching).toBe(false);
    });
  });
});
