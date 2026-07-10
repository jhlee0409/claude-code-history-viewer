import React from "react";
import { Loader2, Trash2 } from "lucide-react";
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

interface SessionMultiDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Number of sessions that will actually be deleted. */
  count: number;
  /** Number of selected sessions skipped because their provider can't delete. */
  skippedCount: number;
  /** Preview names of the sessions to delete (first few). */
  names: string[];
  isDeleting: boolean;
  onConfirm: () => void | Promise<void>;
}

const MAX_PREVIEW = 5;

export const SessionMultiDeleteDialog: React.FC<SessionMultiDeleteDialogProps> = ({
  open,
  onOpenChange,
  count,
  skippedCount,
  names,
  isDeleting,
  onConfirm,
}) => {
  const { t } = useTranslation();
  const previewNames = names.slice(0, MAX_PREVIEW);
  const remaining = names.length - previewNames.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={!isDeleting}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </span>
            {t("session.selection.deleteTitle", {
              count,
              defaultValue: "Delete {{count}} sessions",
            })}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            {t(
              "session.deleteConfirm",
              "This will delete the session file and all associated data (subagents, tool results). The file is moved to the trash when possible, otherwise it is permanently deleted."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2">
          <p className="text-xs font-medium text-destructive">
            {t("session.selection.deleteTargets", {
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
              {t("session.selection.deleteMore", {
                count: remaining,
                defaultValue: "and {{count}} more",
              })}
            </p>
          )}
        </div>

        {skippedCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("session.selection.deleteSkipped", {
              count: skippedCount,
              defaultValue:
                "{{count}} selected session(s) can't be deleted and will be skipped.",
            })}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            {t("common.cancel", "Cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={isDeleting || count === 0}
          >
            {isDeleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {t("session.selection.deleteConfirmButton", {
              count,
              defaultValue: "Delete {{count}}",
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
