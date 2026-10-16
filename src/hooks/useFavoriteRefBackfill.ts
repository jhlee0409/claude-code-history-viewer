/**
 * Legacy favourites (starred before `ref` existed) learn where they live
 * when their project's sessions load (plan T7): the sidebar shows them as
 * "location check needed" until then.
 */
import { useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";
import { favoritesMissingRef } from "@/navigation/library";

export function useFavoriteRefBackfill(): void {
  const sessions = useAppStore((s) => s.sessions);
  const userMetadata = useAppStore((s) => s.userMetadata);
  const isMetadataLoaded = useAppStore((s) => s.isMetadataLoaded);
  const backfillFavoriteRefs = useAppStore((s) => s.backfillFavoriteRefs);
  const missing = isMetadataLoaded && userMetadata && sessions ? favoritesMissingRef(userMetadata, sessions) : [];
  const missingKey = missing.map((s) => s.session_id).join("\n");

  useEffect(() => {
    if (!missingKey) return;
    const { userMetadata: latest, sessions: loaded } = useAppStore.getState();
    void backfillFavoriteRefs(favoritesMissingRef(latest, loaded));
  }, [missingKey, backfillFavoriteRefs]);
}
