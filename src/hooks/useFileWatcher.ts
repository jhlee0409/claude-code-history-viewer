import { useEffect, useCallback, useRef, useState } from 'react';
import { isTauri, getApiBase, getAuthToken } from '@/utils/platform';
import { toast } from 'sonner';

type UnlistenFn = () => void;

/**
 * Event payload structure from Tauri file watcher
 */
interface FileWatcherEvent {
  projectPath: string;
  sessionPath: string;
  eventType: 'changed' | 'created' | 'deleted';
}

/**
 * Configuration options for the file watcher hook
 */
interface UseFileWatcherOptions {
  /** Callback fired when a session file is modified */
  onSessionChanged?: (event: FileWatcherEvent) => void;
  /** Callback fired when a new session file is created */
  onSessionCreated?: (event: FileWatcherEvent) => void;
  /** Callback fired when a session file is deleted */
  onSessionDeleted?: (event: FileWatcherEvent) => void;
  /** Whether file watching is enabled (default: true) */
  enabled?: boolean;
  /** Debounce delay in milliseconds to batch rapid changes (default: 300) */
  debounceMs?: number;
}

/**
 * Return value from the file watcher hook
 */
export interface UseFileWatcherResult {
  /** Whether the file watcher is currently active */
  isWatching: boolean;
  /** Manually start watching (if disabled or stopped) */
  startWatching: () => void;
  /** Manually stop watching */
  stopWatching: () => void;
}

/**
 * React hook that listens to Tauri file system events and triggers callbacks
 * for session file changes, creations, and deletions.
 *
 * Automatically handles event listener cleanup on unmount and provides
 * debouncing to batch rapid file system changes.
 *
 * @example
 * ```tsx
 * const { isWatching } = useFileWatcher({
 *   onSessionChanged: ({ projectPath, sessionPath }) => {
 *     console.log('Session changed:', sessionPath);
 *     refreshSessionData(projectPath);
 *   },
 *   debounceMs: 500
 * });
 * ```
 */
export function useFileWatcher(options: UseFileWatcherOptions = {}): UseFileWatcherResult {
  const {
    onSessionChanged,
    onSessionCreated,
    onSessionDeleted,
    enabled = true,
    debounceMs = 300,
  } = options;

  const [isWatching, setIsWatching] = useState(false);
  const isWatchingRef = useRef(false);
  const unlistenersRef = useRef<UnlistenFn[]>([]);
  const debounceTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  /** Cancellation token: incremented on stop/unmount to abort in-flight startWatching */
  const watchVersionRef = useRef(0);

  /**
   * Debounced callback wrapper to batch rapid file changes
   */
  const createDebouncedCallback = useCallback(
    (callback: ((event: FileWatcherEvent) => void) | undefined, event: FileWatcherEvent) => {
      if (!callback) return;

      const key = `${event.eventType}-${event.sessionPath}`;
      const existingTimer = debounceTimersRef.current.get(key);

      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const timer = setTimeout(() => {
        callback(event);
        debounceTimersRef.current.delete(key);
      }, debounceMs);

      debounceTimersRef.current.set(key, timer);
    },
    [debounceMs]
  );

  /**
   * Stop listening to file watcher events and clean up
   */
  const stopWatching = useCallback(() => {
    // Increment cancellation token to abort any in-flight startWatching
    watchVersionRef.current += 1;

    // Clear all debounce timers
    debounceTimersRef.current.forEach((timer) => clearTimeout(timer));
    debounceTimersRef.current.clear();

    // Unlisten from all events
    for (const unlisten of unlistenersRef.current) {
      try {
        unlisten();
      } catch (error) {
        console.error('Failed to unlisten from event:', error);
        toast.error('Failed to clean up file watcher listener');
      }
    }

    unlistenersRef.current = [];
    isWatchingRef.current = false;
    setIsWatching(false);
  }, []);

  /**
   * Start listening to file watcher events.
   *
   * - **Tauri desktop**: subscribes to native Tauri events.
   * - **WebUI server**: opens an SSE connection to `/api/events`.
   */
  const startWatching = useCallback(async () => {
    if (isWatchingRef.current) return;

    // Capture the current version for cancellation checking
    const version = watchVersionRef.current;

    if (isTauri()) {
      // ---- Desktop path: Tauri event listeners ----
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const unlisteners: UnlistenFn[] = [];

        const unlistenChanged = await listen<FileWatcherEvent>('session-file-changed', (event) => {
          createDebouncedCallback(onSessionChanged, event.payload);
        });
        if (watchVersionRef.current !== version) { unlistenChanged(); return; }
        unlisteners.push(unlistenChanged);

        const unlistenCreated = await listen<FileWatcherEvent>('session-file-created', (event) => {
          createDebouncedCallback(onSessionCreated, event.payload);
        });
        if (watchVersionRef.current !== version) { unlisteners.forEach((fn) => fn()); return; }
        unlisteners.push(unlistenCreated);

        const unlistenDeleted = await listen<FileWatcherEvent>('session-file-deleted', (event) => {
          createDebouncedCallback(onSessionDeleted, event.payload);
        });
        if (watchVersionRef.current !== version) { unlisteners.forEach((fn) => fn()); return; }
        unlisteners.push(unlistenDeleted);

        unlistenersRef.current = unlisteners;
        isWatchingRef.current = true;
        setIsWatching(true);
      } catch (error) {
        console.error('Failed to start file watcher:', error);
        toast.error('Failed to start file watcher');
        isWatchingRef.current = false;
        setIsWatching(false);
      }
    } else {
      // ---- Web path: SSE via EventSource ----
      try {
        const base = getApiBase();
        const token = getAuthToken();
        const url = token
          ? `${base}/api/events?token=${encodeURIComponent(token)}`
          : `${base}/api/events`;

        const es = new EventSource(url);

        es.addEventListener('session-file-changed', (e: MessageEvent) => {
          const event = JSON.parse(e.data) as FileWatcherEvent;
          createDebouncedCallback(onSessionChanged, event);
        });

        es.addEventListener('session-file-created', (e: MessageEvent) => {
          const event = JSON.parse(e.data) as FileWatcherEvent;
          createDebouncedCallback(onSessionCreated, event);
        });

        es.addEventListener('session-file-deleted', (e: MessageEvent) => {
          const event = JSON.parse(e.data) as FileWatcherEvent;
          createDebouncedCallback(onSessionDeleted, event);
        });

        // EventSource auto-reconnects on transient errors; no manual retry needed.

        unlistenersRef.current = [() => es.close()];
        isWatchingRef.current = true;
        setIsWatching(true);
      } catch (error) {
        console.error('Failed to start SSE file watcher:', error);
        isWatchingRef.current = false;
        setIsWatching(false);
      }
    }
  }, [onSessionChanged, onSessionCreated, onSessionDeleted, createDebouncedCallback]);

  /**
   * Auto-start/stop based on enabled prop
   */
  useEffect(() => {
    if (enabled) {
      startWatching();
    } else {
      stopWatching();
    }

    return () => {
      stopWatching();
    };
  }, [enabled, startWatching, stopWatching]);

  return {
    isWatching,
    startWatching,
    stopWatching,
  };
}
