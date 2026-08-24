import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2 } from "lucide-react";
import { api } from "@/services/api";
import { EnhancedDiffViewer } from "../EnhancedDiffViewer";

export interface RestoreDiffPreviewProps {
  filePath: string;
  /** The version that would be written, as captured in the transcript. */
  restoreContent: string;
  /**
   * What the list already believes about the file, used only to phrase the
   * result. The read below is the authority; this just distinguishes "absent"
   * from "unreadable" when the read fails.
   */
  existsOnDisk?: boolean;
}

type State =
  | { kind: "loading" }
  | { kind: "identical" }
  | { kind: "diff"; current: string }
  | { kind: "creating" }
  | { kind: "unreadable"; message: string };

/**
 * What restoring will actually do to the file on disk.
 *
 * Restore overwrites without a backup, and the confirmation previously named
 * only the path. A path does not tell you whether you are about to lose an
 * hour of work or rewrite a file with its own contents. Showing the delta makes
 * that visible at the moment the decision is made, which is worth more than a
 * second confirmation click: a second click asks you to be careful, a diff
 * tells you what to be careful about.
 */
export const RestoreDiffPreview: React.FC<RestoreDiffPreviewProps> = ({
  filePath,
  restoreContent,
  existsOnDisk,
}) => {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    const read = async () => {
      try {
        const current = await api<string>("read_text_file", { path: filePath });
        if (cancelled) return;
        setState(
          current === restoreContent
            ? { kind: "identical" }
            : { kind: "diff", current }
        );
      } catch (error) {
        if (cancelled) return;
        // A file the list already reported absent is a create, not a failure.
        if (existsOnDisk === false) {
          setState({ kind: "creating" });
          return;
        }
        setState({
          kind: "unreadable",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };

    void read();
    // Guards a late response from overwriting the state after the dialog closed
    // or moved to another file.
    return () => {
      cancelled = true;
    };
  }, [filePath, restoreContent, existsOnDisk]);

  if (state.kind === "loading") {
    return (
      <div className="flex items-center gap-2 py-2 text-px11 text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        {t("recentEdits.restorePreviewLoading", "Reading the file on disk...")}
      </div>
    );
  }

  if (state.kind === "identical") {
    return (
      <p className="py-2 text-px11 text-muted-foreground">
        {t(
          "recentEdits.restorePreviewIdentical",
          "The file on disk already matches this version. Restoring changes nothing."
        )}
      </p>
    );
  }

  if (state.kind === "creating") {
    return (
      <p className="py-2 text-px11 text-muted-foreground">
        {t(
          "recentEdits.restorePreviewCreating",
          "This file is not on disk. Restoring will create it."
        )}
      </p>
    );
  }

  if (state.kind === "unreadable") {
    return (
      <div className="flex items-start gap-2 rounded bg-destructive/10 px-2 py-1.5 text-px11 text-destructive">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        <span>
          {t(
            "recentEdits.restorePreviewUnreadable",
            "The file on disk could not be read, so the change cannot be previewed. Restoring will still overwrite it."
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <p className="pb-1 text-px11 font-medium text-muted-foreground">
        {t("recentEdits.restorePreviewHeading", "What changes on disk")}
      </p>
      {/*
        Current contents on the left, the version being written on the right, so
        the diff reads in the direction the action moves the file.
      */}
      <div className="max-h-64 overflow-auto rounded border border-border">
        <EnhancedDiffViewer
          oldText={state.current}
          newText={restoreContent}
          filePath={filePath}
        />
      </div>
    </div>
  );
};

RestoreDiffPreview.displayName = "RestoreDiffPreview";
