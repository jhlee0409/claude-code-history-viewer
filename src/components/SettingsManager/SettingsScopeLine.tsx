import { useLayoutEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { PathText } from "@/lib/format/PathText";
import { normalizeSettingsMetadata } from "@/services/settingsMetadata";
import { mergeSettings } from "@/utils/settingsMerger";
import type { AllSettingsResponse, SettingsScope } from "@/types";

interface SettingsScopeLineProps {
  allSettings: AllSettingsResponse | null;
  scope: SettingsScope;
  dirty: boolean;
  readOnly: boolean;
  loading?: boolean;
  error?: boolean;
}

// This describes only the existing effective-settings preview, not .claude.json
// or .mcp.json. In particular an empty managed file is not an inherited value.
function previewSources(settings: AllSettingsResponse | null): SettingsScope[] | null {
  if (!settings) return null;
  try {
    for (const scope of ["user", "project", "local", "managed"] as const) {
      const raw = settings[scope];
      // Match the merger's empty-content handling, not file existence.
      if (raw !== null && raw !== "") {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      }
    }
    const merged = mergeSettings(settings);
    const sources = new Set<SettingsScope>();
    for (const value of [merged.model, merged.language, merged.outputStyle,
      merged.cleanupPeriodDays, merged.respectGitignore,
      merged.customApiKeyResponsibleUseAcknowledged, merged.disableBypassPermissionsMode,
      merged.permissions.defaultMode]) {
      if (value.value !== undefined) sources.add(value.source);
    }
    for (const value of [...merged.permissions.allow, ...merged.permissions.deny,
      ...merged.permissions.ask, ...merged.permissions.additionalDirectories,
      ...Object.values(merged.env), ...Object.values(merged.mcpServers)]) sources.add(value.source);
    return (["managed", "local", "project", "user"] as const).filter(scope => sources.has(scope));
  } catch {
    return null;
  }
}

export function SettingsScopeLine({ allSettings, scope, dirty, readOnly, loading, error }: SettingsScopeLineProps) {
  const { t } = useTranslation();
  const lineRef = useRef<HTMLElement>(null);
  // Reserve this line's measured height for native focus/scroll-into-view.
  // The existing margin is the gap role; no fixed locale/zoom height is guessed.
  useLayoutEffect(() => {
    const line = lineRef.current;
    const scroller = line?.parentElement;
    if (!line || !scroller) return;
    const previous = scroller.style.scrollPaddingTop;
    const previousBottom = scroller.style.scrollPaddingBottom;
    let owned = previous;
    let ownedBottom = previousBottom;
    const update = () => {
      const gap = Number.parseFloat(getComputedStyle(line).marginBottom) || 0;
      owned = `${line.getBoundingClientRect().height + gap}px`;
      ownedBottom = `${gap}px`;
      if (scroller.style.scrollPaddingTop !== owned) scroller.style.scrollPaddingTop = owned;
      if (scroller.style.scrollPaddingBottom !== ownedBottom) scroller.style.scrollPaddingBottom = ownedBottom;
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(line);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      if (scroller.style.scrollPaddingTop === owned) scroller.style.scrollPaddingTop = previous;
      if (scroller.style.scrollPaddingBottom === ownedBottom) scroller.style.scrollPaddingBottom = previousBottom;
    };
  }, [t, scope, dirty, readOnly, loading, error, allSettings]);
  const metadata = normalizeSettingsMetadata(allSettings?.metadata);
  const file = metadata.scopes[scope];
  const sources = useMemo(() => previewSources(allSettings), [allSettings]);
  const settled = !loading && !error;
  const status = loading ? "loading" : error ? "loadError" : file.state;
  const targetKnown = settled && (file.state === "present" || file.state === "missing") && file.path;
  // Errors/legacy responses cannot prove an exhaustive source list.
  const sourcesKnown = settled && sources !== null && Object.values(metadata.scopes).every(item =>
    item.state === "present" || item.state === "missing" || item.state === "no_project" || item.state === "unsupported");

  return (
    <section ref={lineRef} data-testid="settings-scope-line" aria-label={t("settingsManager.writeScope.label")}
      className="sticky top-0 z-10 shrink-0 mb-4 rounded-lg border border-border bg-card p-3 text-body space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
        <span className="font-medium">{t("settingsManager.writeScope.editing", { scope: t(`settingsManager.scope.${scope}`) })}</span>
        {settled && file.path && <PathText path={file.path} ctx={{ homeDir: metadata.serverHome ?? undefined }} />}
        <span className="text-muted-foreground">{t(`settingsManager.writeScope.${status}`)}</span>
        {settled && <span>{t(readOnly ? "settingsManager.writeScope.readOnly" : dirty ? "settingsManager.writeScope.dirty" : "settingsManager.writeScope.clean")}</span>}
      </div>
      <p className="text-list text-muted-foreground">
        {t(readOnly ? "settingsManager.writeScope.noWrite" : targetKnown ? "settingsManager.writeScope.saveTarget" : "settingsManager.writeScope.targetUnconfirmed")}
      </p>
      {settled && <p className="text-list text-muted-foreground" data-testid="settings-preview-sources">
        {t(sourcesKnown ? sources.length ? "settingsManager.writeScope.sources" : "settingsManager.writeScope.noSources" : "settingsManager.writeScope.sourcesUnknown")}
        {sourcesKnown && sources.map(source => <span key={source} className="inline-block ml-2" title={metadata.scopes[source].path ?? undefined}>{t(`settingsManager.scope.${source}`)}</span>)}
        {sourcesKnown && sources.length > 0 && <> {t("settingsManager.writeScope.mergeNote")}</>}
      </p>}
    </section>
  );
}
