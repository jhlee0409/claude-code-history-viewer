/**
 * The explicit "Find other providers" action, shared by the project tree's
 * provider filter and the no-projects screen.
 *
 * Startup scans Claude Code only; Codex CLI, OpenCode and the other
 * assistants are searched only once the user asks (`discoverProviders`, the
 * one caller of the broad provider detector). Screens that report "no
 * projects" use `hasSearchedOtherProviders` to say what was actually
 * searched.
 */
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAppStore } from "@/store/useAppStore";
import type { AppStore } from "@/store/useAppStore";

/**
 * True once other providers have been searched: a discovery completed this
 * run (even one that found nothing, or whose result could not be saved), or
 * a saved discovery survives from an earlier run. Saved provider IDs count
 * too: metadata written before `providersDiscovered` existed has only those.
 */
export const hasSearchedOtherProviders = (
  state: Pick<AppStore, "userMetadata" | "hasDetectedProviders">,
): boolean => {
  const settings = state.userMetadata?.settings;
  return (
    state.hasDetectedProviders ||
    settings?.providersDiscovered === true ||
    (settings?.discoveredProviderIds?.length ?? 0) > 0
  );
};

export function useProviderDiscovery() {
  const { t } = useTranslation();
  const discoverProviders = useAppStore((state) => state.discoverProviders);
  const isDiscovering = useAppStore((state) => state.isDetectingProviders || state.isLoadingProjects);
  const hasSearched = useAppStore(hasSearchedOtherProviders);

  const discover = useCallback(() => {
    void discoverProviders().catch((error) => {
      console.error("Failed to discover providers:", error);
      toast.error(t("common.provider.detectError"));
    });
  }, [discoverProviders, t]);

  return { discover, isDiscovering, hasSearched };
}
