import type { ProviderId } from "../types";

export const PROVIDER_IDS: ProviderId[] = ["claude", "codex", "opencode"];
export const DEFAULT_PROVIDER_ID: ProviderId = "claude";

const PROVIDER_TRANSLATIONS: Record<
  ProviderId,
  { key: string; fallback: string }
> = {
  claude: { key: "common.provider.claude", fallback: "Claude Code" },
  codex: { key: "common.provider.codex", fallback: "Codex CLI" },
  opencode: { key: "common.provider.opencode", fallback: "OpenCode" },
};

type TranslateFn = (key: string, defaultValue: string) => string;

export function getProviderId(provider?: ProviderId | string): ProviderId {
  switch (provider) {
    case "codex":
    case "opencode":
    case "claude":
      return provider;
    default:
      return DEFAULT_PROVIDER_ID;
  }
}

export function normalizeProviderIds(ids: readonly ProviderId[]): ProviderId[] {
  return PROVIDER_IDS.filter((id) => ids.includes(id));
}

export function hasNonDefaultProvider(
  ids: readonly ProviderId[]
): boolean {
  return ids.some((id) => id !== DEFAULT_PROVIDER_ID);
}

export function getProviderLabel(
  translate: TranslateFn,
  provider?: ProviderId | string
): string {
  const id = getProviderId(provider);
  const config = PROVIDER_TRANSLATIONS[id];
  return translate(config.key, config.fallback);
}
