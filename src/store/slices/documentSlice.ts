/**
 * The conversation tabs' state (plan §4.3, T8). The model and its storage
 * format are in `src/navigation/documents.ts`; switching, opening and closing
 * tabs is `src/navigation/tabs.ts`.
 *
 * The active document is the store's live state (place, selection,
 * subagent stack, target, `placeHistory`); `documents` holds its last
 * snapshot and every other tab's. `hydratedDocumentId` says which document
 * the live state currently is: it is null while a tab is being opened (or
 * restored at startup), so a snapshot taken then keeps the tab's saved
 * place instead of the half-loaded store.
 */
import type { StateCreator } from "zustand";
import type { FullAppStore } from "./types";
import {
  blankDocument,
  loadStoredTabs,
  type ScrollAnchor,
  type TabDocument,
} from "@/navigation/documents";

/** A scroll position to restore once the tab's transcript has loaded. */
export interface PendingAnchor {
  documentId: string;
  sessionPath: string;
  /** Null: the bottom of the transcript. */
  anchor: ScrollAnchor | null;
}

export interface DocumentSliceState {
  documents: TabDocument[];
  activeDocumentId: string;
  hydratedDocumentId: string | null;
  pendingAnchor: PendingAnchor | null;
  /**
   * Startup: tabs came from storage and the active one still has to be
   * opened (after any CLI / deep-link hint, plan §4.3).
   */
  tabsRestorePending: boolean;
  /** What reading `tabs.v1` found, reported once at startup. */
  tabsRestoreReport: { corrupt: boolean; dropped: number };
}

export interface DocumentSliceActions {
  /** Drop `anchor` once restored - only if it is still the pending one. */
  clearPendingAnchor: (anchor: PendingAnchor) => void;
}

export type DocumentSlice = DocumentSliceState & DocumentSliceActions;

/** The initial tabs: those stored in `tabs.v1`, or one empty tab. */
export function initialDocumentState(): DocumentSliceState {
  const stored = loadStoredTabs();
  if (stored.kind === "ok") {
    return {
      documents: stored.tabs.documents,
      activeDocumentId: stored.tabs.activeId,
      hydratedDocumentId: null,
      pendingAnchor: null,
      tabsRestorePending: true,
      tabsRestoreReport: { corrupt: false, dropped: stored.tabs.dropped },
    };
  }
  const blank = blankDocument();
  return {
    documents: [blank],
    activeDocumentId: blank.id,
    hydratedDocumentId: blank.id,
    pendingAnchor: null,
    tabsRestorePending: false,
    tabsRestoreReport: { corrupt: stored.kind === "corrupt", dropped: 0 },
  };
}

export const createDocumentSlice: StateCreator<FullAppStore, [], [], DocumentSlice> = (set, get) => ({
  ...initialDocumentState(),

  clearPendingAnchor: (anchor) => {
    if (get().pendingAnchor === anchor) set({ pendingAnchor: null });
  },
});
