import React from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
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

interface ClearUnavailableSessionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectNames: string[];
  projectCount: number;
  sessionCount: number;
  isClearing: boolean;
  onConfirm: () => void | Promise<void>;
}

const MAX_PREVIEW = 5;

export const ClearUnavailableSessionsDialog: React.FC<
  ClearUnavailableSessionsDialogProps
> = ({
  open,
  onOpenChange,
  projectNames,
  projectCount,
  sessionCount,
  isClearing,
  onConfirm,
}) => {
  const { t } = useTranslation();
  const previewNames = projectNames.slice(0, MAX_PREVIEW);
  const remaining = projectNames.length - previewNames.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={!isClearing}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </span>
            {t(
              "project.unavailableCleanup.title",
              "Clear sessions from unavailable locations?"
            )}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            {t(
              "project.unavailableCleanup.description",
              "This deletes every session in the selected unavailable locations. Session data is moved to the trash when possible, otherwise it is permanently deleted."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2">
          <p className="text-xs font-medium text-destructive">
            {t("project.unavailableCleanup.targets", {
              projectCount,
              sessionCount,
              defaultValue: "{{projectCount}} project(s) · {{sessionCount}} session(s)",
            })}
          </p>
          <ul className="mt-1 space-y-0.5">
            {previewNames.map((name) => (
              <li
                key={name}
                className="min-w-0 truncate text-xs text-muted-foreground"
              >
                {name}
              </li>
            ))}
          </ul>
          {remaining > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("project.unavailableCleanup.moreProjects", {
                count: remaining,
                defaultValue: "and {{count}} more",
              })}
            </p>
          )}
        </div>

        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
          <span>
            {t(
              "project.unavailableCleanup.warning",
              "This action cannot be undone from the app."
            )}
          </span>
        </p>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isClearing}
          >
            {t("common.cancel", "Cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={isClearing || sessionCount === 0}
          >
            {isClearing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {t("project.unavailableCleanup.confirmButton", {
              count: sessionCount,
              defaultValue: "Clear {{count}}",
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
