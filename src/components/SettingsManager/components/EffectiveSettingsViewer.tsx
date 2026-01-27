/**
 * EffectiveSettingsViewer Component
 *
 * Displays the merged/effective settings with source attribution.
 * Shows which scope each value comes from and any overrides.
 */

import * as React from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Server,
  Key,
  Shield,
  Settings2,
} from "lucide-react";
import type { AllSettingsResponse, SettingsScope } from "@/types";
import {
  mergeSettings,
  getTotalMCPServerCount,
  getConflictingServers,
  type MergedSettings,
} from "@/utils/settingsMerger";
import { maskIfSensitive } from "@/utils/securityUtils";

// ============================================================================
// Types
// ============================================================================

interface EffectiveSettingsViewerProps {
  allSettings: AllSettingsResponse;
  onNavigateToScope?: (scope: SettingsScope) => void;
}

// ============================================================================
// Scope Badge Component
// ============================================================================

const scopeColors: Record<SettingsScope, string> = {
  user: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  project: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  local: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  managed: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

interface ScopeBadgeProps {
  scope: SettingsScope;
  onClick?: () => void;
}

const ScopeBadge: React.FC<ScopeBadgeProps> = React.memo(({ scope, onClick }) => {
  const { t } = useTranslation();

  return (
    <Badge
      variant="outline"
      className={`${scopeColors[scope]} cursor-pointer hover:opacity-80 text-xs`}
      onClick={onClick}
    >
      {t(`settingsManager.scope.${scope}`)}
    </Badge>
  );
});

ScopeBadge.displayName = "ScopeBadge";

// ============================================================================
// Section Components
// ============================================================================

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = React.memo(({
  title,
  icon,
  defaultOpen = false,
  badge,
  children,
}) => {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-2 px-3 rounded-md text-muted-foreground hover:text-accent hover:bg-accent/10 transition-colors duration-150">
        <div className="flex items-center gap-2">
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
          {icon}
          <span className="font-medium text-sm">{title}</span>
        </div>
        {badge}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pl-8 pr-3 pb-3 space-y-2">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
});

Section.displayName = "Section";

// ============================================================================
// Value Row Component
// ============================================================================

interface ValueRowProps {
  label: string;
  value: React.ReactNode;
  source: SettingsScope;
  overriddenBy?: SettingsScope[];
  onNavigate?: () => void;
}

const ValueRow: React.FC<ValueRowProps> = React.memo(({
  label,
  value,
  source,
  overriddenBy,
  onNavigate,
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex items-start justify-between py-1.5 border-b border-border/50 last:border-0">
      <div className="flex-1">
        <span className="text-sm text-muted-foreground">{label}</span>
        <div className="font-mono text-sm mt-0.5">{value}</div>
        {overriddenBy && overriddenBy.length > 0 && (
          <div className="text-xs text-muted-foreground/70 mt-1">
            {t("settingsManager.overview.overrides")}:{" "}
            {overriddenBy.map((s) => t(`settingsManager.scope.${s}`)).join(", ")}
          </div>
        )}
      </div>
      <ScopeBadge scope={source} onClick={onNavigate} />
    </div>
  );
});

ValueRow.displayName = "ValueRow";

// ============================================================================
// Permission List Component
// ============================================================================

interface PermissionListProps {
  permissions: Array<{ pattern: string; source: SettingsScope }>;
  type: "allow" | "deny" | "ask";
  onNavigate?: (scope: SettingsScope) => void;
}

const PermissionList: React.FC<PermissionListProps> = React.memo(({
  permissions,
  type,
  onNavigate,
}) => {
  const { t } = useTranslation();

  if (permissions.length === 0) return null;

  const typeColors = {
    allow: "text-green-600 dark:text-green-400",
    deny: "text-red-600 dark:text-red-400",
    ask: "text-amber-600 dark:text-amber-400",
  };

  return (
    <div className="space-y-1">
      <div className={`text-xs font-medium ${typeColors[type]}`}>
        {type === "allow" && t("settingsManager.visual.allowList")}
        {type === "deny" && t("settingsManager.visual.denyList")}
        {type === "ask" && t("settingsManager.visual.askList")}
        {type === "deny" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertTriangle className="w-3 h-3 inline ml-1 text-red-500" />
            </TooltipTrigger>
            <TooltipContent>
              {t("settingsManager.overview.denyPriority")}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="space-y-1">
        {permissions.map((perm, idx) => (
          <div
            key={`${perm.pattern}-${idx}`}
            className="flex items-center justify-between py-1 px-2 bg-muted/50 rounded text-xs"
          >
            <code className="font-mono">{perm.pattern}</code>
            <ScopeBadge
              scope={perm.source}
              onClick={() => onNavigate?.(perm.source)}
            />
          </div>
        ))}
      </div>
    </div>
  );
});

PermissionList.displayName = "PermissionList";

// ============================================================================
// MCP Server List Component
// ============================================================================

interface MCPServerListProps {
  merged: MergedSettings;
  onNavigate?: (scope: SettingsScope) => void;
}

const MCPServerList: React.FC<MCPServerListProps> = React.memo(({ merged, onNavigate }) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-2">
      {Object.entries(merged.mcpServers).map(([name, server]) => {
        const hasConflict = server.alternatives && server.alternatives.length > 0;

        return (
          <div
            key={name}
            className={`p-2 rounded border ${
              hasConflict ? "border-amber-300 dark:border-amber-700" : "border-border"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {hasConflict && (
                  <Tooltip>
                    <TooltipTrigger>
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("settingsManager.overview.serverConflict")}
                    </TooltipContent>
                  </Tooltip>
                )}
                <span className="font-medium text-sm">{name}</span>
              </div>
              <ScopeBadge
                scope={server.source}
                onClick={() => onNavigate?.(server.source)}
              />
            </div>
            <code className="text-xs text-muted-foreground font-mono block mt-1">
              {server.config.command} {server.config.args?.join(" ")}
            </code>
            {hasConflict && server.alternatives && (
              <div className="mt-2 pt-2 border-t border-border/50">
                <span className="text-xs text-muted-foreground">
                  {t("settingsManager.overview.alternatives")}:
                </span>
                {server.alternatives.map((alt) => (
                  <div
                    key={alt.source}
                    className="flex items-center justify-between mt-1 text-xs opacity-80"
                  >
                    <code className="font-mono">
                      {alt.config.command} {alt.config.args?.join(" ")}
                    </code>
                    <ScopeBadge
                      scope={alt.source}
                      onClick={() => onNavigate?.(alt.source)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {Object.keys(merged.mcpServers).length === 0 && (
        <p className="text-sm text-muted-foreground py-2">
          {t("settingsManager.mcp.empty")}
        </p>
      )}
    </div>
  );
});

MCPServerList.displayName = "MCPServerList";

// ============================================================================
// Main Component
// ============================================================================

export const EffectiveSettingsViewer: React.FC<EffectiveSettingsViewerProps> = React.memo(({
  allSettings,
  onNavigateToScope,
}) => {
  const { t } = useTranslation();

  // Merge settings
  const merged = useMemo(() => mergeSettings(allSettings), [allSettings]);

  // Count servers
  const serverCount = getTotalMCPServerCount(merged);
  const conflicts = getConflictingServers(merged);

  // Handle navigation
  const handleNavigate = (scope: SettingsScope) => {
    onNavigateToScope?.(scope);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Settings2 className="w-5 h-5" />
          {t("settingsManager.overview.title")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("settingsManager.overview.description")}
        </p>
      </CardHeader>
      <CardContent className="space-y-1">
        {/* General Settings */}
        <Section
          title={t("settingsManager.overview.general")}
          icon={<Settings2 className="w-4 h-4 text-muted-foreground" />}
          defaultOpen
        >
          {merged.model.value && (
            <ValueRow
              label={t("settingsManager.visual.model")}
              value={merged.model.value}
              source={merged.model.source}
              overriddenBy={merged.model.overriddenBy}
              onNavigate={() => handleNavigate(merged.model.source)}
            />
          )}
          {!merged.model.value && !merged.customApiKeyResponsibleUseAcknowledged.value && (
            <p className="text-sm text-muted-foreground py-2">
              {t("settingsManager.overview.noGeneralSettings")}
            </p>
          )}
        </Section>

        {/* Permissions */}
        <Section
          title={t("settingsManager.overview.permissions")}
          icon={<Shield className="w-4 h-4 text-muted-foreground" />}
          badge={
            <Badge variant="secondary" className="text-xs">
              {merged.permissions.allow.length + merged.permissions.deny.length + merged.permissions.ask.length}
            </Badge>
          }
        >
          <PermissionList
            permissions={merged.permissions.deny}
            type="deny"
            onNavigate={handleNavigate}
          />
          <PermissionList
            permissions={merged.permissions.allow}
            type="allow"
            onNavigate={handleNavigate}
          />
          <PermissionList
            permissions={merged.permissions.ask}
            type="ask"
            onNavigate={handleNavigate}
          />
          {merged.permissions.allow.length === 0 &&
            merged.permissions.deny.length === 0 &&
            merged.permissions.ask.length === 0 && (
              <p className="text-sm text-muted-foreground py-2">
                {t("settingsManager.overview.noPermissions")}
              </p>
            )}
        </Section>

        {/* MCP Servers */}
        <Section
          title={t("settingsManager.mcp.title")}
          icon={<Server className="w-4 h-4 text-muted-foreground" />}
          badge={
            <div className="flex items-center gap-2">
              {conflicts.length > 0 && (
                <Badge variant="outline" className="text-xs text-amber-600">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  {conflicts.length}
                </Badge>
              )}
              <Badge variant="secondary" className="text-xs">
                {serverCount}
              </Badge>
            </div>
          }
        >
          <MCPServerList merged={merged} onNavigate={handleNavigate} />
        </Section>

        {/* Environment Variables */}
        <Section
          title={t("settingsManager.overview.envVars")}
          icon={<Key className="w-4 h-4 text-muted-foreground" />}
          badge={
            <Badge variant="secondary" className="text-xs">
              {Object.keys(merged.env).length}
            </Badge>
          }
        >
          {Object.entries(merged.env).map(([key, envVar]) => (
            <ValueRow
              key={key}
              label={key}
              value={
                <code className="text-muted-foreground font-mono text-xs">
                  {maskIfSensitive(key, envVar.value)}
                </code>
              }
              source={envVar.source}
              overriddenBy={envVar.overriddenScopes}
              onNavigate={() => handleNavigate(envVar.source)}
            />
          ))}
          {Object.keys(merged.env).length === 0 && (
            <p className="text-sm text-muted-foreground py-2">
              {t("settingsManager.overview.noEnvVars")}
            </p>
          )}
        </Section>
      </CardContent>
    </Card>
  );
});

EffectiveSettingsViewer.displayName = "EffectiveSettingsViewer";
