import type { ProviderId } from "../types";

export const PROVIDER_IDS: ProviderId[] = ["aider", "amazonq", "antigravity", "claude", "cline", "codebuddy", "codex", "continue", "copilot", "crush", "cursor", "cursor-agent", "forgecode", "gemini", "goose", "kimi", "kiro", "llm", "opencode", "openhands", "openinterpreter", "pearai", "qwen", "trae", "zed"];
export const DEFAULT_PROVIDER_ID: ProviderId = "claude";

const PROVIDER_TRANSLATIONS: Record<
  ProviderId,
  { key: string; fallback: string }
> = {
  aider: { key: "common.provider.aider", fallback: "Aider" },
  amazonq: { key: "common.provider.amazonq", fallback: "Amazon Q CLI" },
  antigravity: { key: "common.provider.antigravity", fallback: "Antigravity" },
  claude: { key: "common.provider.claude", fallback: "Claude Code" },
  cline: { key: "common.provider.cline", fallback: "Cline" },
  codebuddy: { key: "common.provider.codebuddy", fallback: "CodeBuddy Code" },
  codex: { key: "common.provider.codex", fallback: "Codex CLI" },
  continue: { key: "common.provider.continue", fallback: "Continue" },
  copilot: { key: "common.provider.copilot", fallback: "Copilot" },
  crush: { key: "common.provider.crush", fallback: "Crush" },
  cursor: { key: "common.provider.cursor", fallback: "Cursor" },
  "cursor-agent": { key: "common.provider.cursorAgent", fallback: "Cursor Agent" },
  forgecode: { key: "common.provider.forgecode", fallback: "ForgeCode" },
  gemini: { key: "common.provider.gemini", fallback: "Gemini CLI" },
  goose: { key: "common.provider.goose", fallback: "Goose" },
  kimi: { key: "common.provider.kimi", fallback: "Kimi CLI" },
  kiro: { key: "common.provider.kiro", fallback: "Kiro CLI" },
  llm: { key: "common.provider.llm", fallback: "llm" },
  opencode: { key: "common.provider.opencode", fallback: "OpenCode" },
  openhands: { key: "common.provider.openhands", fallback: "OpenHands" },
  openinterpreter: { key: "common.provider.openinterpreter", fallback: "Open Interpreter" },
  pearai: { key: "common.provider.pearai", fallback: "PearAI" },
  qwen: { key: "common.provider.qwen", fallback: "Qwen Code" },
  trae: { key: "common.provider.trae", fallback: "Trae" },
  zed: { key: "common.provider.zed", fallback: "Zed" },
};

type TranslateFn = (key: string, defaultValue: string) => string;

export interface ProviderSessionCapability {
  supportsConversationBreakdown: boolean;
  supportsNativeRename: boolean;
  supportsResumeCommand: boolean;
  supportsSessionDeletion: boolean;
  supportsArchiveCreation: boolean;
}

const PROVIDER_SESSION_CAPABILITIES: Record<ProviderId, ProviderSessionCapability> = {
  aider: {
    supportsConversationBreakdown: false,
    supportsNativeRename: false,
    supportsResumeCommand: false,
    supportsSessionDeletion: false,
    supportsArchiveCreation: false,
  },
  amazonq: {
    supportsConversationBreakdown: false,
    supportsNativeRename: false,
    supportsResumeCommand: false,
    supportsSessionDeletion: false,
    supportsArchiveCreation: false,
  },
  antigravity: {
    supportsConversationBreakdown: true,
    supportsNativeRename: false,
    supportsResumeCommand: false,
    supportsSessionDeletion: false,
    supportsArchiveCreation: false,
  },
  claude: {
    supportsConversationBreakdown: true,
    supportsNativeRename: true,
    supportsResumeCommand: true,
    supportsSessionDeletion: true,
    supportsArchiveCreation: true,
  },
  cline: {
    supportsConversationBreakdown: false,
    supportsNativeRename: false,
    supportsResumeCommand: false,
    supportsSessionDeletion: false,
    supportsArchiveCreation: false,
  },
  codebuddy: {
    supportsConversationBreakdown: false,
    supportsNativeRename: false,
    supportsResumeCommand: false,
    supportsSessionDeletion: false,
    supportsArchiveCreation: false,
  },
  codex: {
    supportsConversationBreakdown: false,
    supportsNativeRename: true,
    supportsResumeCommand: true,
    supportsSessionDeletion: true,
    supportsArchiveCreation: false,
  },
  continue: {
    supportsConversationBreakdown: false,
    supportsNativeRename: false,
    supportsResumeCommand: false,
    supportsSessionDeletion: false,
    supportsArchiveCreation: false,
  },
  copilot: {
    supportsConversationBreakdown: false,
    supportsNativeRename: false,
    // Resume capability is entrypoint-dependent (CLI yes, Desktop/VS Code no).
    // The provider-level capability is the optimistic union; per-session
    // gating is done by `supportsResumeCommandForSession` below.
    supportsResumeCommand: true,
    supportsSessionDeletion: false,
    supportsArchiveCreation: false,
  },
  crush: {
    supportsConversationBreakdown: false,
    supportsNativeRename: false,
    supportsResumeCommand: false,
    supportsSessionDeletion: false,
    supportsArchiveCreation: false,
  },
  cursor: {
    supportsConversationBreakdown: false,
    supportsNativeRename: false,
    supportsResumeCommand: false,
    supportsSessionDeletion: false,
    supportsArchiveCreation: false,
  },
  "cursor-agent": {
    supportsConversationBreakdown: false,
    supportsNativeRename: false,
    supportsResumeCommand: false,
    supportsSessionDeletion: false,
    supportsArchiveCreation: false,
  },
  forgecode: {
    supportsConversationBreakdown: true,
    supportsNativeRename: true,
    supportsResumeCommand: true,
    supportsSessionDeletion: true,
    supportsArchiveCreation: false,
  },
  gemini: {
    supportsConversationBreakdown: false,
    supportsNativeRename: false,
    supportsResumeCommand: false,
    supportsSessionDeletion: false,
    supportsArchiveCreation: false,
  },
  goose: {
    supportsConversationBreakdown: false,
    supportsNativeRename: false,
    supportsResumeCommand: false,
    supportsSessionDeletion: false,
    supportsArchiveCreation: false,
  },
  kimi: {
    supportsConversationBreakdown: false,
    supportsNativeRename: false,
    supportsResumeCommand: true,
    supportsSessionDeletion: false,
    supportsArchiveCreation: false,
  },
  kiro: {
    supportsConversationBreakdown: false,
    supportsNativeRename: false,
    supportsResumeCommand: false,
    supportsSessionDeletion: false,
    supportsArchiveCreation: false,
  },
  llm: {
    supportsConversationBreakdown: false,
    supportsNativeRename: false,
    supportsResumeCommand: false,
    supportsSessionDeletion: false,
    supportsArchiveCreation: false,
  },
  opencode: {
    supportsConversationBreakdown: false,
    supportsNativeRename: true,
    supportsResumeCommand: false,
    supportsSessionDeletion: false,
    supportsArchiveCreation: false,
  },
  openhands: {
    supportsConversationBreakdown: false,
    supportsNativeRename: false,
    supportsResumeCommand: false,
    supportsSessionDeletion: false,
    supportsArchiveCreation: false,
  },
  openinterpreter: {
    supportsConversationBreakdown: false,
    supportsNativeRename: false,
    supportsResumeCommand: false,
    supportsSessionDeletion: false,
    supportsArchiveCreation: false,
  },
  pearai: {
    supportsConversationBreakdown: false,
    supportsNativeRename: false,
    supportsResumeCommand: false,
    supportsSessionDeletion: false,
    supportsArchiveCreation: false,
  },
  qwen: {
    supportsConversationBreakdown: false,
    supportsNativeRename: false,
    supportsResumeCommand: false,
    supportsSessionDeletion: false,
    supportsArchiveCreation: false,
  },
  trae: {
    supportsConversationBreakdown: false,
    supportsNativeRename: false,
    supportsResumeCommand: false,
    supportsSessionDeletion: false,
    supportsArchiveCreation: false,
  },
  zed: {
    supportsConversationBreakdown: false,
    supportsNativeRename: false,
    supportsResumeCommand: false,
    supportsSessionDeletion: false,
    supportsArchiveCreation: false,
  },
};

export interface ProviderTokenStatsLike {
  provider_id: string;
  tokens: number;
}

export interface ConversationBreakdownCoverage {
  totalTokens: number;
  coveredTokens: number;
  coveragePercent: number;
  hasLimitedProviders: boolean;
}

export function getProviderId(provider?: ProviderId | string): ProviderId {
  switch (provider) {
    case "aider":
    case "amazonq":
    case "antigravity":
    case "cline":
    case "codebuddy":
    case "codex":
    case "continue":
    case "copilot":
    case "crush":
    case "cursor":
    case "cursor-agent":
    case "gemini":
    case "goose":
    case "kimi":
    case "forgecode":
    case "kiro":
    case "llm":
    case "opencode":
    case "openhands":
    case "openinterpreter":
    case "pearai":
    case "qwen":
    case "trae":
    case "zed":
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

export function supportsConversationBreakdown(
  provider?: ProviderId | string
): boolean {
  if (provider == null || !PROVIDER_IDS.includes(provider as ProviderId)) {
    return false;
  }
  return PROVIDER_SESSION_CAPABILITIES[provider as ProviderId]
    .supportsConversationBreakdown;
}

export function supportsNativeRename(provider?: ProviderId | string): boolean {
  if (provider == null || !PROVIDER_IDS.includes(provider as ProviderId)) {
    return false;
  }
  return PROVIDER_SESSION_CAPABILITIES[provider as ProviderId].supportsNativeRename;
}

export function supportsResumeCommand(provider?: ProviderId | string): boolean {
  if (provider == null || !PROVIDER_IDS.includes(provider as ProviderId)) {
    return false;
  }
  return PROVIDER_SESSION_CAPABILITIES[provider as ProviderId].supportsResumeCommand;
}

// Single-quote a path for safe shell interpolation. Always quotes (cheap and
// robust for arbitrary paths); a literal `'` is escaped as `'\''`.
function shellQuotePath(p: string): string {
  return `'${p.replace(/'/g, "'\\''")}'`;
}

export function getResumeCommand(
  provider: ProviderId | string | undefined,
  sessionId: string,
  cwd?: string,
  entrypoint?: string
): string | null {
  if (!sessionId) {
    return null;
  }

  // Fail-closed: sessionId is interpolated unquoted into a shell command that
  // the user pastes into their terminal. Only allow the charset CLIs actually
  // emit (UUIDs, hex hashes) so a crafted/corrupted JSONL can't extend the
  // command past the resume invocation.
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    return null;
  }

  if (provider == null || !PROVIDER_IDS.includes(provider as ProviderId)) {
    return null;
  }

  let resume: string | null;
  switch (provider as ProviderId) {
    case "claude":
      resume = `claude --resume ${sessionId}`;
      break;
    case "codex":
      resume = `codex resume ${sessionId}`;
      break;
    case "copilot":
      // Only the CLI surface has a resume command; Desktop/VS Code resume by
      // reopening the app.
      resume =
        entrypoint === "copilot-cli"
          ? `copilot --resume=${sessionId}`
          : null;
      break;
    case "forgecode":
      resume = `forge conversation resume ${sessionId}`;
      break;
    case "kimi":
      resume = `kimi -r ${sessionId}`;
      break;
    default:
      resume = null;
  }

  if (resume == null) return null;
  return cwd ? `cd ${shellQuotePath(cwd)} && ${resume}` : resume;
}

/**
 * Per-session variant of supportsResumeCommand. Matches `getResumeCommand`'s
 * gating exactly (Copilot resume requires entrypoint === "copilot-cli").
 */
export function supportsResumeCommandForSession(
  provider: ProviderId | string | undefined,
  entrypoint: string | undefined
): boolean {
  if (!supportsResumeCommand(provider)) return false;
  if (provider === "copilot") return entrypoint === "copilot-cli";
  return true;
}

export function supportsSessionDeletion(provider?: ProviderId | string): boolean {
  if (provider == null || !PROVIDER_IDS.includes(provider as ProviderId)) {
    return false;
  }
  return PROVIDER_SESSION_CAPABILITIES[provider as ProviderId]
    .supportsSessionDeletion;
}

export function supportsArchiveCreation(provider?: ProviderId | string): boolean {
  if (provider == null || !PROVIDER_IDS.includes(provider as ProviderId)) {
    return false;
  }
  return PROVIDER_SESSION_CAPABILITIES[provider as ProviderId].supportsArchiveCreation;
}

export const PROVIDER_BADGE_STYLES: Record<ProviderId, string> = {
  claude: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  codebuddy: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  codex: "bg-green-500/15 text-green-600 dark:text-green-400",
  continue: "bg-lime-500/15 text-lime-700 dark:text-lime-300",
  copilot: "bg-[#8250df]/15 text-[#6639ba] dark:text-[#d2a8ff]",
  cline: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
  crush: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
  cursor: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  "cursor-agent": "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  forgecode: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  gemini: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  goose: "bg-red-500/15 text-red-600 dark:text-red-400",
  kimi: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-300",
  kiro: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  llm: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
  opencode: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  openinterpreter: "bg-stone-500/15 text-stone-600 dark:text-stone-400",
  openhands: "bg-gray-500/15 text-gray-600 dark:text-gray-300",
  pearai: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300",
  qwen: "bg-violet-600/15 text-violet-700 dark:text-violet-300",
  trae: "bg-blue-600/15 text-blue-700 dark:text-blue-300",
  zed: "bg-neutral-500/15 text-neutral-600 dark:text-neutral-400",
  aider: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  amazonq: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  antigravity: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
};

export function getProviderBadgeStyle(provider?: ProviderId | string): string {
  const id = getProviderId(provider);
  return PROVIDER_BADGE_STYLES[id] ?? "bg-gray-500/15 text-gray-500";
}

export function hasAnyConversationBreakdownProvider(
  providers?: readonly (ProviderId | string)[]
): boolean {
  if (!providers || providers.length === 0) {
    return false;
  }
  return providers.some((provider) =>
    supportsConversationBreakdown(provider)
  );
}

export function calculateConversationBreakdownCoverage(
  providers: readonly ProviderTokenStatsLike[]
): ConversationBreakdownCoverage {
  let totalTokens = 0;
  let coveredTokens = 0;
  let hasLimitedProviders = false;

  for (const provider of providers) {
    const tokens = Math.max(0, provider.tokens);
    totalTokens += tokens;

    if (supportsConversationBreakdown(provider.provider_id)) {
      coveredTokens += tokens;
    } else if (tokens > 0) {
      hasLimitedProviders = true;
    }
  }

  const coveragePercent =
    totalTokens > 0 ? (coveredTokens / totalTokens) * 100 : 0;

  return {
    totalTokens,
    coveredTokens,
    coveragePercent,
    hasLimitedProviders,
  };
}
