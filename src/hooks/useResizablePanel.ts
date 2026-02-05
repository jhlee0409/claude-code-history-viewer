/**
 * Resizable Panel Hook
 *
 * Provides drag-to-resize functionality for UI panels with optional
 * localStorage persistence and boundary constraints.
 *
 * @example Basic Usage
 * ```typescript
 * const { width, isResizing, handleMouseDown } = useResizablePanel({
 *   defaultWidth: 300,
 *   minWidth: 200,
 *   maxWidth: 600,
 *   storageKey: "sidebar-width"  // Persists to localStorage
 * });
 *
 * return (
 *   <div style={{ width }}>
 *     <div onMouseDown={handleMouseDown} className="resize-handle" />
 *     Panel content
 *   </div>
 * );
 * ```
 *
 * @remarks
 * **Features:**
 * - Smooth drag-to-resize with mouse tracking
 * - Enforces min/max width constraints
 * - Auto-saves to localStorage (if storageKey provided)
 * - Prevents text selection during resize
 * - Changes cursor to col-resize during drag
 *
 * **Implementation Details:**
 * - Uses refs to avoid stale closures in event handlers
 * - Cleans up event listeners on unmount
 * - Restores body styles after resize
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

interface UseResizablePanelOptions {
  /** Initial width in pixels */
  defaultWidth: number;
  /** Minimum allowed width in pixels */
  minWidth: number;
  /** Maximum allowed width in pixels */
  maxWidth: number;
  /** Optional localStorage key for persistence */
  storageKey?: string;
  /** Resize direction: "right" = panel grows rightward (left sidebar), "left" = panel grows leftward (right sidebar) */
  direction?: "right" | "left";
}

interface UseResizablePanelReturn {
  /** Current panel width in pixels */
  width: number;
  /** Whether the panel is currently being resized */
  isResizing: boolean;
  /** Mouse down handler for the resize handle element */
  handleMouseDown: (e: ReactMouseEvent<HTMLElement>) => void;
}

/**
 * Hook for creating resizable panels with drag handles
 *
 * @param options - Configuration for resize behavior and constraints
 * @returns Panel width state and resize handler
 */
export function useResizablePanel({
  defaultWidth,
  minWidth,
  maxWidth,
  storageKey,
  direction = "right",
}: UseResizablePanelOptions): UseResizablePanelReturn {
  /**
   * Initialize width from localStorage if available, otherwise use default
   * Validates stored value against min/max constraints
   */
  const [width, setWidth] = useState<number>(() => {
    if (storageKey) {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          const parsed = parseInt(stored, 10);
          if (!isNaN(parsed) && parsed >= minWidth && parsed <= maxWidth) {
            return parsed;
          }
        }
      } catch {
        // localStorage may be unavailable (e.g. privacy mode)
      }
    }
    return defaultWidth;
  });

  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0); // Initial mouse X position
  const startWidthRef = useRef(0); // Initial panel width
  const widthRef = useRef(width); // Latest width for stale-closure safety
  widthRef.current = width;

  /**
   * Start resize operation
   * Captures initial mouse position and panel width for delta calculation
   */
  const handleMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLElement>) => {
      e.preventDefault();
      setIsResizing(true);
      startXRef.current = e.clientX;
      startWidthRef.current = widthRef.current;
    },
    []
  );

  /**
   * Handle resize drag operation
   * Attaches global mouse handlers while resizing, prevents text selection
   */
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Calculate delta from start position
      const delta = e.clientX - startXRef.current;
      const effectiveDelta = direction === "left" ? -delta : delta;
      // Apply constraints (min/max) to new width
      const newWidth = Math.min(
        maxWidth,
        Math.max(minWidth, startWidthRef.current + effectiveDelta)
      );
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      // Persist to localStorage on mouse up using ref for latest value
      if (storageKey) {
        try { localStorage.setItem(storageKey, widthRef.current.toString()); } catch { /* ignore */ }
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    // Prevent text selection during drag and show resize cursor
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isResizing, minWidth, maxWidth, storageKey, direction]);

  /**
   * Persist width changes to localStorage (when not resizing)
   */
  useEffect(() => {
    if (storageKey && !isResizing) {
      try { localStorage.setItem(storageKey, width.toString()); } catch { /* ignore */ }
    }
  }, [width, storageKey, isResizing]);

  return {
    width,
    isResizing,
    handleMouseDown,
  };
}
