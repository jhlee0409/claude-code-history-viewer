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
 * True once other providers have been searched: a discovery result was
 * saved (it survives restarts), or a discovery detected providers this run
 * even if saving its result failed.
 */
export const hasSearchedOtherProviders = (state: Pick<AppStore, "userMetadata" | "providers">): boolean =>
  (state.userMetadata?.settings?.discoveredProviderIds?.length ?? 0) > 0 || state.providers.length > 0;

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
