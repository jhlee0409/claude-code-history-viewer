/**
 * GeneralSection Component
 *
 * Accordion section for general settings:
 * - Model selection (opus, sonnet, haiku)
 * - Language preference for Claude responses
 * - Extended thinking toggle
 * - Auto-update channel selection
 * - Session cleanup period
 * - Various behavior toggles
 * - Attribution settings
 */

import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  ChevronDown,
  ChevronRight,
  Settings2,
  Brain,
  RefreshCw,
  GitCommit,
  Eye,
  FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClaudeCodeSettings, ClaudeModel, AutoUpdatesChannel, AttributionConfig } from "@/types";

// ============================================================================
// Types
// ============================================================================

interface GeneralSectionProps {
  settings: ClaudeCodeSettings;
  isExpanded: boolean;
  onToggle: () => void;
  onChange: (updates: Partial<ClaudeCodeSettings>) => void;
  readOnly: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const COMMON_LANGUAGES = [
  { value: "__auto__", label: "Auto (system default)" },
  { value: "english", label: "English" },
  { value: "korean", label: "한국어 (Korean)" },
  { value: "japanese", label: "日本語 (Japanese)" },
  { value: "chinese", label: "中文 (Chinese)" },
  { value: "spanish", label: "Español (Spanish)" },
  { value: "french", label: "Français (French)" },
  { value: "german", label: "Deutsch (German)" },
  { value: "portuguese", label: "Português (Portuguese)" },
];

// ============================================================================
// Component
// ============================================================================

export const GeneralSection: React.FC<GeneralSectionProps> = React.memo(({
  settings,
  isExpanded,
  onToggle,
  onChange,
  readOnly,
}) => {
  const { t } = useTranslation();

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleModelChange = (value: string) => {
    onChange({ model: value as ClaudeModel });
  };

  const handleLanguageChange = (value: string) => {
    // "__auto__" is a placeholder for empty/undefined (Radix Select doesn't allow empty strings)
    onChange({ language: value === "__auto__" ? undefined : value });
  };

  const handleAutoUpdatesChannelChange = (value: string) => {
    onChange({ autoUpdatesChannel: value as AutoUpdatesChannel });
  };

  const handleCleanupPeriodChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10);
    onChange({ cleanupPeriodDays: isNaN(value) ? undefined : value });
  };

  const handleOutputStyleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ outputStyle: e.target.value || undefined });
  };

  const handlePlansDirectoryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ plansDirectory: e.target.value || undefined });
  };

  const handleBooleanChange = (key: keyof ClaudeCodeSettings) => (checked: boolean) => {
    onChange({ [key]: checked });
  };

  const handleAttributionChange = (field: keyof AttributionConfig) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const currentAttribution = settings.attribution || {};
    onChange({
      attribution: {
        ...currentAttribution,
        [field]: e.target.value || undefined,
      },
    });
  };

  // -------------------------------------------------------------------------
  // Computed
  // -------------------------------------------------------------------------

  const summaryParts: string[] = [];
  if (settings.model) summaryParts.push(settings.model);
  if (settings.language) summaryParts.push(settings.language);
  if (settings.alwaysThinkingEnabled) summaryParts.push("thinking");

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <CollapsibleTrigger
        className={cn(
          "flex items-center justify-between w-full py-3 px-4 rounded-lg",
          "border border-border/40 transition-colors duration-150",
          "text-muted-foreground hover:text-accent hover:bg-accent/10 hover:border-border/60",
          isExpanded && "bg-accent/10 border-border/60 text-foreground"
        )}
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              background: "color-mix(in oklch, var(--accent) 15%, transparent)",
            }}
          >
            <Settings2 className="w-4 h-4 text-accent" />
          </div>
          <span className="font-medium text-sm">
            {t("settingsManager.unified.sections.general")}
          </span>
        </div>
        {summaryParts.length > 0 && (
          <span className="text-xs text-muted-foreground font-mono">
            {summaryParts.join(" · ")}
          </span>
        )}
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="pl-10 pr-4 pb-4 pt-2 space-y-5">
          {/* ============================================================= */}
          {/* Model & Language Group */}
          {/* ============================================================= */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <Brain className="w-3.5 h-3.5" />
              {t("settingsManager.general.modelLanguage")}
            </div>

            {/* Model Selection */}
            <div className="space-y-2">
              <Label htmlFor="model-select">
                {t("settingsManager.visual.model")}
              </Label>
              <Select
                value={settings.model || ""}
                onValueChange={handleModelChange}
                disabled={readOnly}
              >
                <SelectTrigger id="model-select" className="w-full">
                  <SelectValue
                    placeholder={t("settingsManager.visual.selectModel")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="opus">
                    Opus ({t("settingsManager.unified.model.opus")})
                  </SelectItem>
                  <SelectItem value="sonnet">
                    Sonnet ({t("settingsManager.unified.model.sonnet")})
                  </SelectItem>
                  <SelectItem value="haiku">
                    Haiku ({t("settingsManager.unified.model.haiku")})
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("settingsManager.unified.model.description")}
              </p>
            </div>

            {/* Language Selection */}
            <div className="space-y-2">
              <Label htmlFor="language-select">
                {t("settingsManager.general.language")}
              </Label>
              <Select
                value={settings.language || "__auto__"}
                onValueChange={handleLanguageChange}
                disabled={readOnly}
              >
                <SelectTrigger id="language-select" className="w-full">
                  <SelectValue placeholder={t("settingsManager.general.languagePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_LANGUAGES.map((lang) => (
                    <SelectItem key={lang.value} value={lang.value}>
                      {lang.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("settingsManager.general.languageDesc")}
              </p>
            </div>

            {/* Extended Thinking Toggle */}
            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <Label htmlFor="always-thinking">
                  {t("settingsManager.general.alwaysThinking")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("settingsManager.general.alwaysThinkingDesc")}
                </p>
              </div>
              <Switch
                id="always-thinking"
                checked={settings.alwaysThinkingEnabled ?? false}
                onCheckedChange={handleBooleanChange("alwaysThinkingEnabled")}
                disabled={readOnly}
              />
            </div>

            {/* Output Style */}
            <div className="space-y-2">
              <Label htmlFor="output-style">
                {t("settingsManager.general.outputStyle")}
              </Label>
              <Input
                id="output-style"
                value={settings.outputStyle ?? ""}
                onChange={handleOutputStyleChange}
                placeholder={t("settingsManager.general.outputStylePlaceholder")}
                disabled={readOnly}
              />
              <p className="text-xs text-muted-foreground">
                {t("settingsManager.general.outputStyleDesc")}
              </p>
            </div>
          </div>

          <Separator className="opacity-50" />

          {/* ============================================================= */}
          {/* Updates & Maintenance Group */}
          {/* ============================================================= */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <RefreshCw className="w-3.5 h-3.5" />
              {t("settingsManager.general.maintenance")}
            </div>

            {/* Auto-Update Channel */}
            <div className="space-y-2">
              <Label htmlFor="update-channel">
                {t("settingsManager.general.autoUpdatesChannel")}
              </Label>
              <Select
                value={settings.autoUpdatesChannel || "stable"}
                onValueChange={handleAutoUpdatesChannelChange}
                disabled={readOnly}
              >
                <SelectTrigger id="update-channel" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stable">
                    Stable ({t("settingsManager.general.channelStable")})
                  </SelectItem>
                  <SelectItem value="latest">
                    Latest ({t("settingsManager.general.channelLatest")})
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("settingsManager.general.autoUpdatesChannelDesc")}
              </p>
            </div>

            {/* Cleanup Period */}
            <div className="space-y-2">
              <Label htmlFor="cleanup-period">
                {t("settingsManager.general.cleanupPeriod")}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="cleanup-period"
                  type="number"
                  min={0}
                  max={365}
                  value={settings.cleanupPeriodDays ?? 30}
                  onChange={handleCleanupPeriodChange}
                  className="w-24"
                  disabled={readOnly}
                />
                <span className="text-sm text-muted-foreground">
                  {t("settingsManager.general.days")}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("settingsManager.general.cleanupPeriodDesc")}
              </p>
            </div>

            {/* Plans Directory */}
            <div className="space-y-2">
              <Label htmlFor="plans-directory">
                <span className="flex items-center gap-1.5">
                  <FolderOpen className="w-3.5 h-3.5" />
                  {t("settingsManager.general.plansDirectory")}
                </span>
              </Label>
              <Input
                id="plans-directory"
                value={settings.plansDirectory ?? ""}
                onChange={handlePlansDirectoryChange}
                placeholder="~/.claude/plans"
                disabled={readOnly}
              />
              <p className="text-xs text-muted-foreground">
                {t("settingsManager.general.plansDirectoryDesc")}
              </p>
            </div>
          </div>

          <Separator className="opacity-50" />

          {/* ============================================================= */}
          {/* Behavior Toggles Group */}
          {/* ============================================================= */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <Eye className="w-3.5 h-3.5" />
              {t("settingsManager.general.behavior")}
            </div>

            {/* Respect Gitignore */}
            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <Label htmlFor="respect-gitignore">
                  {t("settingsManager.general.respectGitignore")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("settingsManager.general.respectGitignoreDesc")}
                </p>
              </div>
              <Switch
                id="respect-gitignore"
                checked={settings.respectGitignore ?? true}
                onCheckedChange={handleBooleanChange("respectGitignore")}
                disabled={readOnly}
              />
            </div>

            {/* Show Turn Duration */}
            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <Label htmlFor="show-turn-duration">
                  {t("settingsManager.general.showTurnDuration")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("settingsManager.general.showTurnDurationDesc")}
                </p>
              </div>
              <Switch
                id="show-turn-duration"
                checked={settings.showTurnDuration ?? true}
                onCheckedChange={handleBooleanChange("showTurnDuration")}
                disabled={readOnly}
              />
            </div>

            {/* Spinner Tips */}
            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <Label htmlFor="spinner-tips">
                  {t("settingsManager.general.spinnerTips")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("settingsManager.general.spinnerTipsDesc")}
                </p>
              </div>
              <Switch
                id="spinner-tips"
                checked={settings.spinnerTipsEnabled ?? true}
                onCheckedChange={handleBooleanChange("spinnerTipsEnabled")}
                disabled={readOnly}
              />
            </div>

            {/* Terminal Progress Bar */}
            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <Label htmlFor="terminal-progress-bar">
                  {t("settingsManager.general.terminalProgressBar")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("settingsManager.general.terminalProgressBarDesc")}
                </p>
              </div>
              <Switch
                id="terminal-progress-bar"
                checked={settings.terminalProgressBarEnabled ?? true}
                onCheckedChange={handleBooleanChange("terminalProgressBarEnabled")}
                disabled={readOnly}
              />
            </div>

          </div>

          <Separator className="opacity-50" />

          {/* ============================================================= */}
          {/* Attribution Group */}
          {/* ============================================================= */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <GitCommit className="w-3.5 h-3.5" />
              {t("settingsManager.general.attribution")}
            </div>

            {/* Commit Attribution */}
            <div className="space-y-2">
              <Label htmlFor="attribution-commit">
                {t("settingsManager.general.commitAttribution")}
              </Label>
              <Input
                id="attribution-commit"
                value={settings.attribution?.commit ?? "Co-Authored-By: Claude <noreply@anthropic.com>"}
                onChange={handleAttributionChange("commit")}
                placeholder="Co-Authored-By: Claude <noreply@anthropic.com>"
                disabled={readOnly}
              />
              <p className="text-xs text-muted-foreground">
                {t("settingsManager.general.commitAttributionDesc")}
              </p>
            </div>

            {/* PR Attribution */}
            <div className="space-y-2">
              <Label htmlFor="attribution-pr">
                {t("settingsManager.general.prAttribution")}
              </Label>
              <Input
                id="attribution-pr"
                value={settings.attribution?.pr ?? ""}
                onChange={handleAttributionChange("pr")}
                placeholder="Generated with Claude Code"
                disabled={readOnly}
              />
              <p className="text-xs text-muted-foreground">
                {t("settingsManager.general.prAttributionDesc")}
              </p>
            </div>
          </div>

        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});

GeneralSection.displayName = "GeneralSection";
