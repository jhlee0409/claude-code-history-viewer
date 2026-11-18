import React, { useState } from "react";
import { LoaderCircle, Trash } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Notice,
} from "@/components/ui";
import type { ClaudeProject, CleanupExclusion } from "@/types";
import { getProviderLabel } from "@/utils/providers";
import { useUnavailableSessionsCleanup } from "../hooks/useUnavailableSessionsCleanup";

interface ClearUnavailableSessionsDialogProps {
  /** The missing last-known location the projects share. */
  location: string;
  /** Every project listed under that location, one per provider store. */
  projects: readonly ClaudeProject[];
  onClose: () => void;
}

/**
 * Bulk clear for one unavailable location (#780). Shows exactly what the
 * backend resolved before anything moves, what is left alone and why, asks
 * the user to confirm the folder is really gone, then reports each session.
 * Mounted while open: closing unmounts it.
 */
export const ClearUnavailableSessionsDialog: React.FC<ClearUnavailableSessionsDialogProps> = ({
  location,
  projects,
  onClose,
}) => {
  const { t } = useTranslation();
  const { phase, previews, error, outcome, clear } = useUnavailableSessionsCleanup(projects);
  const [acknowledged, setAcknowledged] = useState(false);

  const exclusionText = (reason: CleanupExclusion, detail: string | null) => {
    switch (reason) {
      case "permanent_delete":
        return t("project.clearUnavailable.reason.permanentDelete");
      case "unsupported":
        return t("project.clearUnavailable.reason.unsupported");
      case "location_available":
        return t("project.clearUnavailable.reason.locationAvailable");
      case "invalid_project":
        return t("project.clearUnavailable.reason.invalidProject", { detail: detail ?? "" });
    }
  };

  const eligible = previews.filter((p) => p.excluded === null && p.targets.length > 0);
  const targetCount = eligible.reduce((sum, p) => sum + p.targets.length, 0);
  const excluded = previews.filter((p) => p.excluded !== null);
  const skipped = previews.flatMap((p) =>
    p.skipped.map((s) => ({ ...s, provider: p.provider }))
  );
  const isClearing = phase === "clearing";

  const moved = outcome?.results.filter((r) => r.error === null) ?? [];
  const failed = outcome?.results.filter((r) => r.error !== null) ?? [];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isClearing) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl" showCloseButton={!isClearing}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            {t("project.clearUnavailable.title")}
          </DialogTitle>
          <DialogDescription className="text-body leading-relaxed">
            {t("project.clearUnavailable.description")}
          </DialogDescription>
        </DialogHeader>

        <p
          data-mono="path"
          className="break-all font-mono text-caption text-muted-foreground"
          data-testid="clear-unavailable-location"
        >
          {location}
        </p>

        {phase === "loading" && (
          <p className="flex items-center gap-2 text-body text-muted-foreground" role="status">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t("project.clearUnavailable.loading")}
          </p>
        )}

        {phase === "error" && (
          <Notice variant="danger" live title={t("project.clearUnavailable.failed")}>
            {error}
          </Notice>
        )}

        {(phase === "preview" || phase === "clearing") && (
          <div className="space-y-3">
            <Notice variant="warning">{t("project.clearUnavailable.warning")}</Notice>

            {targetCount > 0 ? (
              <section aria-labelledby="clear-unavailable-targets">
                <h3 id="clear-unavailable-targets" className="text-list font-medium">
                  {t("project.clearUnavailable.targets", { count: targetCount })}
                </h3>
                <div className="mt-1 max-h-56 space-y-2 overflow-auto rounded-md border border-border p-2">
                  {eligible.map((preview) => (
                    <div key={`${preview.provider}:${preview.project_path}`}>
                      <p className="text-caption font-medium text-muted-foreground">
                        {getProviderLabel((key, fallback) => t(key, fallback), preview.provider)}
                      </p>
                      <ul className="mt-1 space-y-1" data-testid="clear-unavailable-target-list">
                        {preview.targets.map((target) => (
                          <li key={target.session_path}>
                            <span data-mono="path" className="break-all font-mono text-caption">
                              {target.trash_paths[0]}
                            </span>
                            {target.trash_paths.length > 1 && (
                              <ul className="ml-3 text-muted-foreground">
                                {target.trash_paths.slice(1).map((path) => (
                                  <li key={path} data-mono="path" className="break-all font-mono text-caption">
                                    {path}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            ) : (
              <p className="text-body text-muted-foreground">
                {t("project.clearUnavailable.nothing")}
              </p>
            )}

            {(excluded.length > 0 || skipped.length > 0) && (
              <section aria-labelledby="clear-unavailable-kept">
                <h3 id="clear-unavailable-kept" className="text-list font-medium">
                  {t("project.clearUnavailable.notCleared")}
                </h3>
                <ul
                  className="mt-1 max-h-40 space-y-1 overflow-auto text-list"
                  data-testid="clear-unavailable-not-cleared"
                >
                  {excluded.map((preview) => (
                    <li key={`${preview.provider}:${preview.project_path}`}>
                      <span className="font-medium">
                        {getProviderLabel((key, fallback) => t(key, fallback), preview.provider)}
                      </span>
                      {" — "}
                      {preview.excluded && exclusionText(preview.excluded, preview.detail)}
                    </li>
                  ))}
                  {skipped.map((session) => (
                    <li key={session.session_path}>
                      <span data-mono="path" className="break-all font-mono text-caption">
                        {session.session_path}
                      </span>
                      <span className="block text-muted-foreground">{session.reason}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {targetCount > 0 && (
              <label className="flex items-start gap-2 text-body">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={acknowledged}
                  disabled={isClearing}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                <span>{t("project.clearUnavailable.acknowledge")}</span>
              </label>
            )}
          </div>
        )}

        {phase === "done" && outcome && (
          <div className="space-y-3" data-testid="clear-unavailable-results">
            {moved.length > 0 && (
              <Notice variant="success" live>
                {t("project.clearUnavailable.moved", { count: moved.length })}
              </Notice>
            )}
            {failed.length > 0 && (
              <Notice
                variant="danger"
                live
                title={t("project.clearUnavailable.notMoved", { count: failed.length })}
              >
                <ul className="mt-1 max-h-40 space-y-1 overflow-auto">
                  {failed.map((result) => (
                    <li key={result.session_path}>
                      <span data-mono="path" className="break-all font-mono text-caption">
                        {result.session_path}
                      </span>
                      <span className="block">{result.error}</span>
                    </li>
                  ))}
                </ul>
              </Notice>
            )}
            {outcome.refreshFailed && (
              <Notice variant="warning">{t("project.clearUnavailable.refreshFailed")}</Notice>
            )}
          </div>
        )}

        <DialogFooter>
          {phase === "done" || phase === "error" ? (
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.close")}
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={onClose} disabled={isClearing}>
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void clear()}
                disabled={phase !== "preview" || targetCount === 0 || !acknowledged}
              >
                {isClearing ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Trash className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {isClearing
                  ? t("project.clearUnavailable.clearing")
                  : t("project.clearUnavailable.confirm", { count: targetCount })}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
