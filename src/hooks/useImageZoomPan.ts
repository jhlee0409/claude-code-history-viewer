/**
 * useImageZoomPan Hook
 *
 * Manages zoom/pan state for an image viewer.
 * - Wheel: zoom at cursor position (keeps image point under cursor fixed)
 * - Drag: pan via mousedown → mousemove → mouseup
 * - resetZoom: fit image to viewport (no upscale)
 */

import { useCallback, useEffect, useRef, useState } from "react";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.25;

export interface ZoomPanState {
  zoom: number;
  panX: number;
  panY: number;
}

export function useImageZoomPan() {
  const [state, setState] = useState<ZoomPanState>({
    zoom: 1,
    panX: 0,
    panY: 0,
  });

  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

  /**
   * Zoom in by one step, centered on the viewport.
   */
  const zoomIn = useCallback(() => {
    setState((prev) => ({
      ...prev,
      zoom: clampZoom(prev.zoom + ZOOM_STEP),
    }));
  }, []);

  /**
   * Zoom out by one step, centered on the viewport.
   */
  const zoomOut = useCallback(() => {
    setState((prev) => ({
      ...prev,
      zoom: clampZoom(prev.zoom - ZOOM_STEP),
    }));
  }, []);

  /**
   * Fit the image into the given viewport dimensions without upscaling.
   */
  const resetZoom = useCallback(
    (viewportWidth: number, viewportHeight: number, imgWidth: number, imgHeight: number) => {
      if (imgWidth === 0 || imgHeight === 0) return;
      const fitZoom = Math.min(viewportWidth / imgWidth, viewportHeight / imgHeight, 1);
      const panX = (viewportWidth - imgWidth * fitZoom) / 2;
      const panY = (viewportHeight - imgHeight * fitZoom) / 2;
      setState({ zoom: fitZoom, panX, panY });
    },
    [],
  );

  /**
   * Handle wheel zoom at cursor position.
   * Keeps the image point under the cursor fixed.
   */
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      setState((prev) => {
        const direction = e.deltaY < 0 ? 1 : -1;
        const newZoom = clampZoom(prev.zoom + direction * ZOOM_STEP);
        const ratio = newZoom / prev.zoom;

        // Keep the point under the cursor fixed
        const newPanX = cursorX - ratio * (cursorX - prev.panX);
        const newPanY = cursorY - ratio * (cursorY - prev.panY);

        return { zoom: newZoom, panX: newPanX, panY: newPanY };
      });
    },
    [],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return; // Left click only
      isDragging.current = true;
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        panX: stateRef.current.panX,
        panY: stateRef.current.panY,
      };
    },
    [],
  );

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setState((prev) => ({
      ...prev,
      panX: dragStart.current.panX + dx,
      panY: dragStart.current.panY + dy,
    }));
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  return {
    ...state,
    isDragging: isDragging.current,
    zoomIn,
    zoomOut,
    resetZoom,
    handleWheel,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
}
