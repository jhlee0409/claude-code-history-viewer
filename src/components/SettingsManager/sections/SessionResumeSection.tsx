/**
 * SessionResumeSection Component
 *
 * Settings section for configuring extra CLI arguments when resuming agent sessions.
 * Implements per-CLI argument configuration with live preview and safety validation.
 */

import * as React from "react";
import { useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ChevronDown,
  ChevronRight,
  Terminal,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import {
  supportsResumeCommand,
  getProviderLabel,
  PROVIDER_IDS,
  DEFAULT_PROVIDER_ID,
} from "@/utils/providers";
import {
  parseResumeArgs,
  buildLivePreviewResumeCommand,
  getStoredResumeCliArgs,
} from "@/utils/resumeArgs";
import type { ProviderId } from "@/types";

interface SessionResumeSectionProps {
  isExpanded: boolean;
  onToggle: (open: boolean) => void;
  readOnly?: boolean;
}

/**
 * Settings section for configuring extra CLI arguments when resuming agent sessions.
 * Displays available CLI agent providers, handles input validation and dangerous flag detection,
 * and allows saving or resetting custom arguments.
 *
 * @param props - Component properties
 * @param props.isExpanded - Whether this collapsible section is expanded
 * @param props.onToggle - Callback when expand state changes
 * @param props.readOnly - Whether modifications are disabled
 */
export function SessionResumeSection({
  isExpanded,
  onToggle,
  readOnly = false,
}: SessionResumeSectionProps) {
  const { t } = useTranslation();
  const {
    userMetadata,
    updateUserSettings,
    providers,
    activeProviders,
    sessions,
  } = useAppStore();

  // Find providers that support session resume and are available on this system
  const resumeEligibleProviders = useMemo(() => {
    // Collect detected available providers from providerSlice
    const available = providers
      .filter((p) => p.is_available && supportsResumeCommand(p.id))
      .map((p) => p.id as ProviderId);

    if (available.length > 0) {
      return available;
    }

    // Fallback: active providers that support resume
    const active = activeProviders.filter(supportsResumeCommand);
    if (active.length > 0) {
      return active;
    }

    // Default fallback to Claude Code
    return [DEFAULT_PROVIDER_ID];
  }, [providers, activeProviders]);

  const storedArgsMap = userMetadata?.settings?.resumeCliArgs ?? {};

  const kimiEntrypoint = useMemo(() => {
    const kimiSession = sessions.find(
      (s) => s.provider === "kimi" && s.entrypoint
    );
    return kimiSession?.entrypoint;
  }, [sessions]);

  // Local draft values so typing is responsive without jumping
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});

  /**
   * Retrieves the current draft or stored extra CLI arguments for a specific provider.
   *
   * @param providerId - The CLI provider identifier
   * @returns Current argument string from drafts or user settings
   */
  const getValueForProvider = useCallback(
    (providerId: ProviderId): string => {
      if (providerId in draftValues) {
        return draftValues[providerId] ?? "";
      }
      return getStoredResumeCliArgs(userMetadata?.settings, providerId);
    },
    [draftValues, userMetadata?.settings]
  );

  /**
   * Updates local draft state when the user types into an argument input field.
   *
   * @param providerId - The CLI provider identifier
   * @param value - The raw input value
   */
  const handleInputChange = useCallback(
    (providerId: ProviderId, value: string) => {
      setDraftValues((prev) => ({ ...prev, [providerId]: value }));
    },
    []
  );

  /**
   * Generates a localized error message for an invalid extra argument input.
   *
   * @param validation - Result from parsing and validating the arguments
   * @returns Localized error string
   */
  const getValidationErrorMessage = useCallback(
    (validation: ReturnType<typeof parseResumeArgs>) => {
      if (!validation.errorCode) {
        return (
          validation.error ??
          t("settings.sessionResume.errorInvalid", "Invalid CLI arguments")
        );
      }
      switch (validation.errorCode) {
        case "metacharacters":
          return t(
            "settings.sessionResume.errorMetacharacters",
            "Shell metacharacters are not allowed."
          );
        case "maxTokens":
          return t(
            "settings.sessionResume.errorMaxTokens",
            "Maximum 32 extra arguments allowed."
          );
        case "tokenTooLong":
          return t("settings.sessionResume.errorTokenTooLong", {
            defaultValue: "Argument exceeds 128 characters: \"{{param}}...\"",
            param: validation.errorParam ?? "",
          });
        case "invalidCharacters":
          return t("settings.sessionResume.errorInvalidCharacters", {
            defaultValue: "Argument contains invalid characters: \"{{param}}\"",
            param: validation.errorParam ?? "",
          });
        default:
          return (
            validation.error ??
            t("settings.sessionResume.errorInvalid", "Invalid CLI arguments")
          );
      }
    },
    [t]
  );

  /**
   * Validates and persists the extra arguments for a provider to user settings.
   *
   * @param providerId - The CLI provider identifier
   */
  const handleSave = useCallback(
    async (providerId: ProviderId) => {
      const rawValue = getValueForProvider(providerId);
      const validation = parseResumeArgs(rawValue);

      if (!validation.isValid) {
        toast.error(getValidationErrorMessage(validation));
        return;
      }

      try {
        const nextArgsMap = {
          ...storedArgsMap,
          [providerId]: validation.tokens.join(" "),
        };
        // Clean empty entries
        if (!nextArgsMap[providerId]) {
          delete nextArgsMap[providerId];
        }

        await updateUserSettings({ resumeCliArgs: nextArgsMap });
        // Clear draft for this provider to sync with store
        setDraftValues((prev) => {
          const next = { ...prev };
          delete next[providerId];
          return next;
        });

        toast.success(
          t("settings.sessionResume.saved", "Resume arguments saved")
        );
      } catch (err) {
        toast.error(
          t("settings.sessionResume.saveFailed", "Failed to save settings")
        );
      }
    },
    [getValueForProvider, storedArgsMap, updateUserSettings, t, getValidationErrorMessage]
  );

  /**
   * Resets extra arguments for a provider, clearing drafts and removing stored settings.
   *
   * @param providerId - The CLI provider identifier
   */
  const handleReset = useCallback(
    async (providerId: ProviderId) => {
      setDraftValues((prev) => {
        const next = { ...prev };
        delete next[providerId];
        return next;
      });

      if (storedArgsMap[providerId]) {
        try {
          const nextArgsMap = { ...storedArgsMap };
          delete nextArgsMap[providerId];
          await updateUserSettings({ resumeCliArgs: nextArgsMap });
          toast.success(
            t("settings.sessionResume.resetSuccess", "Reset to default arguments")
          );
        } catch {
          toast.error(
            t("settings.sessionResume.saveFailed", "Failed to save settings")
          );
        }
      }
    },
    [storedArgsMap, updateUserSettings, t]
  );

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle} className="w-full">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex items-center justify-between w-full p-4 text-left hover:bg-muted/30 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-primary shrink-0" />
            <div>
              <h3 className="text-sm font-medium text-foreground">
                {t("settings.sessionResume.title", "Session Resume Arguments")}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t(
                  "settings.sessionResume.description",
                  "Configure extra CLI arguments when resuming sessions in terminal."
                )}
              </p>
            </div>
          </div>
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="p-4 pt-0 space-y-4 border-t border-border/40">
          {resumeEligibleProviders.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              {t(
                "settings.sessionResume.noProviders",
                "No supported CLI agent runtimes detected on this machine."
              )}
            </p>
          ) : (
            <div className="space-y-4 pt-3">
              {resumeEligibleProviders.map((providerId) => {
                const rawValue = getValueForProvider(providerId);
                const validation = parseResumeArgs(rawValue);
                const providerLabel = getProviderLabel(
                  (key, fallback) => t(key, fallback),
                  providerId
                );
                const previewCommand = buildLivePreviewResumeCommand(
                  providerId,
                  rawValue,
                  "<id>",
                  providerId === "kimi" ? kimiEntrypoint : undefined
                );
                const isDirty =
                  providerId in draftValues &&
                  draftValues[providerId] !== (storedArgsMap[providerId] ?? "");

                return (
                  <div
                    key={providerId}
                    className="rounded-lg border border-border/50 bg-background/60 p-3.5 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Label
                        htmlFor={`resume-arg-${providerId}`}
                        className="text-xs font-semibold text-foreground flex items-center gap-1.5"
                      >
                        <span>{providerLabel}</span>
                        <span className="font-mono text-3xs text-muted-foreground font-normal">
                          ({providerId})
                        </span>
                      </Label>

                      {(isDirty || !!storedArgsMap[providerId]) && !readOnly && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handleReset(providerId)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-3xs text-muted-foreground hover:text-foreground rounded hover:bg-muted"
                            title={t("common.reset", "Reset")}
                          >
                            <RotateCcw className="h-3 w-3" />
                            <span>{t("common.reset", "Reset")}</span>
                          </button>
                          {isDirty && (
                            <button
                              type="button"
                              onClick={() => void handleSave(providerId)}
                              disabled={!validation.isValid}
                              className="inline-flex items-center gap-1 px-2.5 py-0.5 text-3xs font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              <span>{t("common.save", "Save")}</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="space-y-1">
                      <Input
                        id={`resume-arg-${providerId}`}
                        value={rawValue}
                        onChange={(e) =>
                          handleInputChange(providerId, e.target.value)
                        }
                        disabled={readOnly}
                        placeholder={t(
                          "settings.sessionResume.placeholder",
                          "e.g. --dangerously-skip-permissions"
                        )}
                        className={cn(
                          "font-mono text-xs h-8 bg-muted/20",
                          !validation.isValid &&
                            "border-destructive focus-visible:ring-destructive"
                        )}
                      />

                      {/* Inline Validation Error */}
                      {!validation.isValid && (
                        <p className="flex items-center gap-1 text-3xs text-destructive">
                          <XCircle className="h-3 w-3 shrink-0" />
                          <span>{getValidationErrorMessage(validation)}</span>
                        </p>
                      )}

                      {/* Inline Dangerous Flag Warning */}
                      {validation.isValid && validation.hasDangerousFlag && (
                        <div className="flex items-center gap-1.5 text-3xs text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1 mt-1">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                          <span>
                            {t(
                              "settings.sessionResume.warningDangerous",
                              "Flag disables permission checks or runs in dangerous mode."
                            )}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Live Preview Command */}
                    <div className="rounded bg-muted/40 px-2.5 py-1.5 border border-border/30">
                      <div className="flex items-center justify-between text-3xs text-muted-foreground mb-0.5">
                        <span>
                          {t(
                            "settings.sessionResume.livePreview",
                            "Command preview:"
                          )}
                        </span>
                      </div>
                      <code className="text-2xs font-mono text-foreground/90 break-all select-all">
                        {previewCommand}
                      </code>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
