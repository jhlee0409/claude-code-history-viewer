/**
 * Where the transcript is scrolled, readable from outside the viewer.
 *
 * The message viewer registers a reader for the session it shows; a tab
 * switch reads it to save the outgoing tab's scroll anchor (plan §4.3). The
 * reader is keyed by the session it reads, so a stale viewer cannot answer
 * for another session.
 */
import type { ScrollAnchor } from "./documents";

interface AnchorSource {
  sessionPath: string;
  read: () => ScrollAnchor | null;
}

let source: AnchorSource | null = null;

/** Register the viewer's reader; returns the unregister function. */
export function registerScrollAnchorSource(next: AnchorSource): () => void {
  source = next;
  return () => {
    if (source === next) source = null;
  };
}

/**
 * The anchor of `sessionPath` as shown now: the first visible message and
 * its offset, or null at the bottom (or when nothing shows that session).
 */
export function captureScrollAnchor(sessionPath: string | null | undefined): ScrollAnchor | null {
  if (!sessionPath || !source || source.sessionPath !== sessionPath) return null;
  try {
    return source.read();
  } catch {
    return null;
  }
}
