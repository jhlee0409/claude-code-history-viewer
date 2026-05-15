/**
 * TruncatedScrollText
 *
 * A read-only inline text container that:
 *   - Default state: shows the text with a **middle ellipsis** when the full
 *     string doesn't fit. Both the start and end of the string remain
 *     visible — better for paths/IDs than the end-truncation `truncate` class.
 *   - Hover state: scrolls the full text horizontally inside the container
 *     (CSS marquee). Speed scales with text length so long names finish in
 *     a similar wall-clock time to short ones.
 *
 * The middle-ellipsis split point is found via binary search using a hidden
 * measurement span. We re-run on `text` change and on container resize.
 */

import * as React from "react";
import { cn } from "@/lib/utils";

interface Props {
  text: string;
  className?: string;
  /** Optional override for the native tooltip; falls back to the full text. */
  title?: string;
}

export function TruncatedScrollText({ text, className, title }: Props) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const measureRef = React.useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = React.useState(text);
  const [needsScroll, setNeedsScroll] = React.useState(false);

  React.useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const compute = () => {
      const cw = container.clientWidth;
      if (cw === 0) return;
      measure.textContent = text;
      if (measure.scrollWidth <= cw) {
        setTruncated(text);
        setNeedsScroll(false);
        return;
      }
      // Binary search the longest "head + … + tail" string that fits.
      let lo = 0;
      let hi = text.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const head = Math.floor(mid / 2);
        const tail = mid - head;
        const candidate =
          text.slice(0, head) + "…" + text.slice(text.length - tail);
        measure.textContent = candidate;
        if (measure.scrollWidth <= cw) lo = mid;
        else hi = mid - 1;
      }
      const head = Math.floor(lo / 2);
      const tail = lo - head;
      if (lo <= 1) {
        setTruncated(text.slice(0, 1));
        setNeedsScroll(true);
        return;
      }
      setTruncated(
        text.slice(0, head) + "…" + text.slice(text.length - tail),
      );
      setNeedsScroll(true);
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(container);
    return () => {
      ro.disconnect();
    };
  }, [text]);

  // Marquee duration: keep ~30 char/sec scroll speed across name lengths.
  const marqueeDurationSec = Math.max(4, text.length * 0.18);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative overflow-hidden whitespace-nowrap group/marquee",
        className,
      )}
      title={title ?? text}
    >
      <span
        ref={measureRef}
        className="invisible absolute left-0 top-0 whitespace-nowrap pointer-events-none"
        aria-hidden="true"
      />
      {needsScroll ? (
        <>
          <span className="block group-hover/marquee:hidden">{truncated}</span>
          <span
            className="marquee-scroll hidden group-hover/marquee:inline-flex items-center whitespace-nowrap will-change-transform"
            style={{
              "--marquee-duration": `${marqueeDurationSec}s`,
            } as React.CSSProperties}
          >
            <span>{text}</span>
            <span aria-hidden="true" className="inline-block w-12 shrink-0" />
            <span aria-hidden="true">{text}</span>
          </span>
        </>
      ) : (
        <span className="block">{text}</span>
      )}
    </div>
  );
}
