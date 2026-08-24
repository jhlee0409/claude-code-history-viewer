import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export interface FileEditDirectoryLinkProps {
  /** The elided directory, as shown. */
  directory: string;
  /** The full path, kept as the hover title so nothing is hidden by elision. */
  fullPath: string;
  /**
   * Reveal is a Tauri-only capability. Where it is unavailable this renders as
   * plain text rather than a dead control: an underlined path that does nothing
   * when clicked is worse than a path that never claimed to be clickable.
   */
  canReveal: boolean;
  onReveal: () => void;
  /** "Reveal in Finder" / "Show in Explorer", already localized by the caller. */
  revealLabel: string;
  className?: string;
}

/**
 * The directory line, doubling as the control that opens the containing folder.
 *
 * The path is already on screen and already means "where this lives", so it can
 * carry the action without spending width on another icon - which matters in a
 * panel that goes down to 280px. A dotted underline marks it as interactive at
 * rest and goes solid on hover.
 *
 * Shared by both densities on purpose. The alternative was the same affordance
 * written twice, which is the failure this branch has spent several rounds
 * fixing elsewhere.
 */
export const FileEditDirectoryLink: React.FC<FileEditDirectoryLinkProps> = ({
  directory,
  fullPath,
  canReveal,
  onReveal,
  revealLabel,
  className,
}) => {
  const { t } = useTranslation();
  /*
    `elideProjectRoot` returns an empty string for a file sitting directly in the
    project root, because there is nothing left after the root is removed. Passed
    straight through, that rendered a blank line - and where reveal is available,
    a clickable control with no content and no name.

    Shown as "." because the rest of the column is relative paths and that is
    what a relative path to the root looks like. The accessible name says it in
    words instead: "." read aloud is not a location.
  */
  const isRoot = directory.trim() === "";
  const shown = isRoot ? "." : directory;
  const spoken = isRoot ? t("recentEdits.projectRoot", "Project root") : directory;

  if (!canReveal) {
    return (
      <span className={cn("truncate", className)} title={fullPath}>
        {shown}
      </span>
    );
  }

  return (
    <button
      type="button"
      // The row's own click target sits behind this content, so stop the event
      // rather than expanding the row on the way to opening a folder.
      onClick={(event) => {
        event.stopPropagation();
        onReveal();
      }}
      title={`${revealLabel} - ${fullPath}`}
      /*
        Names itself by the folder it opens, not by the bare action. The icon
        button beside it already carries the plain "Show in Explorer", and two
        controls sharing one accessible name is ambiguous to anyone navigating
        by name: "which of these two is the one I want" has no answer.
      */
      aria-label={`${revealLabel}: ${spoken}`}
      className={cn(
        "pointer-events-auto truncate text-left underline decoration-dotted underline-offset-2",
        "transition-colors hover:text-foreground hover:decoration-solid",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 rounded-sm",
        className
      )}
    >
      {shown}
    </button>
  );
};

FileEditDirectoryLink.displayName = "FileEditDirectoryLink";
