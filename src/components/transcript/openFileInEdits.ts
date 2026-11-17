/**
 * "Open in Recent edits" for a file (the opened Edit's `…` menu, TR2a): the
 * Edits screen with its search prefilled with the path, the way the Board's
 * file links open it (RecentEditsViewer reads the prefill). A failure is
 * logged and told in a toast; a synchronous throw takes the same path.
 */
import { toast } from "sonner";
import type { TFunction } from "i18next";
import { placeNameKey } from "@/navigation/placeNames";
import { useAppStore } from "@/store/useAppStore";

export function openFileInEdits(path: string, t: TFunction): void {
  const fail = (error: unknown) => {
    console.error("Failed to open the Edits screen:", error);
    toast.error(t("diffView.openFailed", { place: t(placeNameKey("edits")) }));
  };
  try {
    const store = useAppStore.getState();
    store.setAnalyticsRecentEditsSearchQuery(path);
    store.navigate({ view: "edits" }).catch(fail);
  } catch (error) {
    fail(error);
  }
}
