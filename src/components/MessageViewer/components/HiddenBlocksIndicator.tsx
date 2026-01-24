/**
 * HiddenBlocksIndicator Component
 *
 * Ultra-minimal indicator for hidden blocks in capture mode.
 * Both badge and dropdown rendered via Portal to escape stacking context issues.
 */

import { useState, useRef, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

// Z-index constants for portal elements
const Z_INDEX = {
  BADGE: 9998,
  DROPDOWN: 9999,
} as const;

interface HiddenBlocksIndicatorProps {
  count: number;
  hiddenUuids: string[];
  onRestoreOne?: (uuid: string) => void;
  onRestoreAll?: (uuids: string[]) => void;
}

export function HiddenBlocksIndicator({
  count,
  hiddenUuids,
  onRestoreOne,
  onRestoreAll,
}: HiddenBlocksIndicatorProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [badgePosition, setBadgePosition] = useState({ top: 0, left: 0 });
  const dropdownId = useId();

  // Update badge position on events (throttled)
  useEffect(() => {
    let rafId: number | null = null;

    const updatePosition = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setBadgePosition({
          top: rect.top + rect.height / 2,
          left: rect.left,
        });
      }
    };

    const throttledUpdate = () => {
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          updatePosition();
          rafId = null;
        });
      }
    };

    // Initial position
    updatePosition();

    // Event listeners with throttling
    window.addEventListener("scroll", throttledUpdate, true);
    window.addEventListener("resize", throttledUpdate);

    // ResizeObserver for parent container changes (panel resize)
    const resizeObserver = new ResizeObserver(throttledUpdate);
    if (containerRef.current?.parentElement) {
      resizeObserver.observe(containerRef.current.parentElement);
    }

    return () => {
      window.removeEventListener("scroll", throttledUpdate, true);
      window.removeEventListener("resize", throttledUpdate);
      resizeObserver.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  // Close dropdown when clicking outside or pressing Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        badgeRef.current && !badgeRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        badgeRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <>
      {/* Invisible anchor in the DOM tree */}
      <div ref={containerRef} className="h-px bg-zinc-700/30" />

      {/* Badge + Dropdown rendered via Portal */}
      {createPortal(
        <>
          {/* Badge */}
          <button
            ref={badgeRef}
            onClick={() => setIsOpen(!isOpen)}
            aria-expanded={isOpen}
            aria-haspopup="menu"
            aria-controls={dropdownId}
            aria-label={t("captureMode.hiddenCount", { count })}
            className={cn(
              "fixed px-1.5 py-0.5 rounded-r-sm",
              "text-[10px] font-mono tabular-nums",
              "bg-zinc-800 text-zinc-500",
              "border-y border-r border-zinc-700/50",
              "hover:bg-zinc-700 hover:text-zinc-300 cursor-pointer",
              "transition-colors"
            )}
            style={{
              top: badgePosition.top,
              left: badgePosition.left,
              transform: "translateY(-50%)",
              zIndex: Z_INDEX.BADGE,
            }}
            title={t("captureMode.hiddenCount", { count })}
          >
            {count}
          </button>

          {/* Dropdown */}
          {isOpen && (
            <div
              ref={dropdownRef}
              className={cn(
                "fixed min-w-[180px] max-h-[240px] overflow-y-auto",
                "bg-zinc-900 border border-zinc-700 rounded-md",
                "shadow-2xl shadow-black/70",
                "text-[11px]"
              )}
              style={{
                top: badgePosition.top + 12,
                left: badgePosition.left,
                zIndex: Z_INDEX.DROPDOWN,
              }}
            >
              {/* Restore all button */}
              {onRestoreAll && hiddenUuids.length > 1 && (
                <button
                  onClick={() => {
                    onRestoreAll(hiddenUuids);
                    setIsOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2",
                    "text-zinc-300 hover:bg-zinc-800",
                    "border-b border-zinc-700",
                    "transition-colors"
                  )}
                >
                  <RotateCcw className="w-3 h-3" />
                  <span className="font-medium">
                    {t("captureMode.restoreAll")} ({count})
                  </span>
                </button>
              )}

              {/* Individual items */}
              {hiddenUuids.map((uuid) => (
                <button
                  key={uuid}
                  onClick={() => {
                    onRestoreOne?.(uuid);
                    if (hiddenUuids.length === 1) {
                      setIsOpen(false);
                    }
                  }}
                  className={cn(
                    "w-full flex items-center justify-between gap-2 px-3 py-1.5",
                    "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200",
                    "transition-colors"
                  )}
                >
                  <span className="font-mono text-[10px] truncate text-zinc-500">
                    {uuid.slice(0, 8)}...
                  </span>
                  <RotateCcw className="w-3 h-3 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </>,
        document.body
      )}
    </>
  );
}
