import type { ProviderId, UserSettings } from "@/types";
import { getResumeCommand } from "./providers";

/** Prohibited shell metacharacters and control symbols. */
const PROHIBITED_SHELL_CHARS_REGEX = /[;&|$`<>\\!"'()\r\n\t]/;

/** Valid token characters: alphanumeric, dashes, underscores, dots, equals, slashes, colons, commas, pluses. */
const VALID_TOKEN_REGEX = /^[a-zA-Z0-9_\-./:=,+]+$/;

/** Stable empty map, so hook dependencies don't change on every render. */
export const NO_RESUME_ARGS: Readonly<Record<string, string>> = Object.freeze({});

export type ResumeArgsErrorCode =
  | "metacharacters"
  | "maxTokens"
  | "tokenTooLong"
  | "invalidCharacters";

export interface ResumeArgsValidationResult {
  isValid: boolean;
  tokens: string[];
  errorCode?: ResumeArgsErrorCode;
  error?: string;
  errorParam?: string;
  warning?: string;
  hasDangerousFlag: boolean;
}

/**
 * Checks whether a single CLI token is considered a dangerous flag
 * (e.g. disables permission checks or security boundaries).
 */
export function isDangerousArg(token: string): boolean {
  const lower = token.toLowerCase();
  return (
    lower.startsWith("--dangerously-") ||
    lower.startsWith("-dangerously-") ||
    lower === "--dangerously-skip-permissions" ||
    lower === "--no-verify" ||
    lower === "--no-permissions"
  );
}

/**
 * Checks if any of the provided tokens or raw arguments string contains a dangerous flag.
 */
export function hasDangerousFlag(tokensOrRaw: string[] | string): boolean {
  if (typeof tokensOrRaw === "string") {
    const { tokens } = parseResumeArgs(tokensOrRaw);
    return tokens.some(isDangerousArg);
  }
  return tokensOrRaw.some(isDangerousArg);
}

/**
 * Parses and validates raw extra CLI argument text entered by the user.
 *
 * Rules:
 * - Empty string or whitespace only is valid (results in empty tokens).
 * - Rejects shell metacharacters (;, &, |, $, `, <, >, \, !, ", ', (, )).
 * - Rejects unescaped quotes or whitespace inside tokens.
 * - Detects dangerous flags (like --dangerously-*) and emits a warning while remaining valid.
 */
export function parseResumeArgs(input: string): ResumeArgsValidationResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      isValid: true,
      tokens: [],
      hasDangerousFlag: false,
    };
  }

  // Check for shell metacharacters or quotes anywhere in the input
  if (PROHIBITED_SHELL_CHARS_REGEX.test(trimmed)) {
    return {
      isValid: false,
      tokens: [],
      errorCode: "metacharacters",
      error: "Shell metacharacters (; & | $ ` < > \\ ! \" ' ( ) etc.) are not allowed.",
      hasDangerousFlag: false,
    };
  }

  const rawTokens = trimmed.split(/\s+/).filter(Boolean);

  if (rawTokens.length > 32) {
    return {
      isValid: false,
      tokens: [],
      errorCode: "maxTokens",
      error: "Maximum 32 extra arguments allowed.",
      hasDangerousFlag: false,
    };
  }

  for (const token of rawTokens) {
    if (token.length > 128) {
      return {
        isValid: false,
        tokens: [],
        errorCode: "tokenTooLong",
        errorParam: token.slice(0, 20),
        error: `Argument exceeds 128 characters: "${token.slice(0, 20)}..."`,
        hasDangerousFlag: false,
      };
    }

    if (!VALID_TOKEN_REGEX.test(token)) {
      return {
        isValid: false,
        tokens: [],
        errorCode: "invalidCharacters",
        errorParam: token,
        error: `Argument contains invalid characters: "${token}"`,
        hasDangerousFlag: false,
      };
    }
  }

  const dangerous = rawTokens.some(isDangerousArg);

  return {
    isValid: true,
    tokens: rawTokens,
    warning: dangerous
      ? "Warning: Flags like --dangerously-* disable permission checks."
      : undefined,
    hasDangerousFlag: dangerous,
  };
}

/**
 * Retrieves the stored extra resume CLI arguments for a specific provider from user settings.
 */
export function getStoredResumeCliArgs(
  userSettings?: UserSettings,
  providerId?: ProviderId | string
): string {
  if (!userSettings?.resumeCliArgs || !providerId) {
    return "";
  }
  return userSettings.resumeCliArgs[providerId as ProviderId] ?? "";
}

/**
 * Builds a live preview resume command for settings UI display.
 */
export function buildLivePreviewResumeCommand(
  provider: ProviderId | string,
  extraArgsString: string,
  placeholderId = "<id>",
  entrypoint?: string
): string {
  const { tokens } = parseResumeArgs(extraArgsString);
  const extra = tokens.length > 0 ? tokens.join(" ") : undefined;
  const dummyId = "SESSION_ID_PLACEHOLDER";
  const effectiveEntrypoint =
    entrypoint ?? (provider === "copilot" ? "copilot-cli" : undefined);
  const cmd = getResumeCommand(provider, dummyId, undefined, effectiveEntrypoint, extra);
  if (cmd) {
    return cmd.replace(dummyId, placeholderId);
  }
  return `${provider} ${extra ? `${extra} ` : ""}--resume ${placeholderId}`;
}
