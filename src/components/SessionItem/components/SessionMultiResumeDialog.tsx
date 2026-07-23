import React from "react";
import { Loader2, TerminalSquare as SquareTerminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui";

interface SessionMultiResumeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Number of sessions that will actually be resumed. */
  count: number;
  /** Number of selected sessions skipped because their provider can't resume. */
  skippedCount: number;
  /** Preview names of the sessions to resume (first few). */
  names: string[];
  isResuming: boolean;
  onConfirm: () => void | Promise<void>;
}

const MAX_PREVIEW = 5;

export const SessionMultiResumeDialog: React.FC<SessionMultiResumeDialogProps> = ({
  open,
  onOpenChange,
  count,
  skippedCount,
  names,
  isResuming,
  onConfirm,
}) => {
  const { t } = useTranslation();
  const previewNames = names.slice(0, MAX_PREVIEW);
  const remaining = names.length - previewNames.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={!isResuming}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <SquareTerminal className="h-4 w-4" aria-hidden="true" />
            </span>
            {t("session.selection.resumeTitle", {
              count,
              defaultValue: "Resume {{count}} sessions",
            })}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            {t("session.selection.resumeDescription", {
              defaultValue:
                "This opens a terminal window for each session and runs its CLI resume command (e.g. copilot --resume=…).",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 rounded-md border bg-muted/30 px-3 py-2">
          <p className="text-xs font-medium text-foreground">
            {t("session.selection.resumeTargets", {
              count,
              defaultValue: "{{count}} sessions",
            })}
          </p>
          <ul className="mt-1 space-y-0.5">
            {previewNames.map((name, i) => (
              <li
                key={`${name}-${i}`}
                className="min-w-0 truncate text-xs text-muted-foreground"
              >
                {name}
              </li>
            ))}
          </ul>
          {remaining > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("session.selection.resumeMore", {
                count: remaining,
                defaultValue: "and {{count}} more",
              })}
            </p>
          )}
        </div>

        {skippedCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("session.selection.resumeSkipped", {
              count: skippedCount,
              defaultValue:
                "{{count}} selected session(s) can't be resumed and will be skipped.",
            })}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isResuming}
          >
            {t("common.cancel", "Cancel")}
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={isResuming || count === 0}
          >
            {isResuming ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <SquareTerminal className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {t("session.selection.resumeConfirmButton", {
              count,
              defaultValue: "Resume {{count}}",
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
