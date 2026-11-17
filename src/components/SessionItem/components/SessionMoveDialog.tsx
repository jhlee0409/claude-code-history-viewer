import React, { useEffect, useId, useMemo, useState } from "react";
import { FolderInput, LoaderCircle, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { getProjectDisplayName } from "@/utils/pathUtils";
import type { ClaudeProject } from "@/types";

interface SessionMoveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Candidate destinations (other Claude projects in the same root). */
  projects: ClaudeProject[];
  isMoving: boolean;
  onConfirm: (target: ClaudeProject) => void | Promise<void>;
}

export const SessionMoveDialog: React.FC<SessionMoveDialogProps> = ({
  open,
  onOpenChange,
  projects,
  isMoving,
  onConfirm,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const radioName = useId();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  // Start fresh each time the dialog opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedPath(null);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter(
      (project) =>
        getProjectDisplayName(project).toLowerCase().includes(needle) ||
        project.actual_path.toLowerCase().includes(needle)
    );
  }, [projects, query]);

  // A choice the search hides is no choice: Move only acts on a visible one.
  const selected = filtered.find((project) => project.path === selectedPath) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={!isMoving}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        // The dialog is portaled but React events still bubble to the session
        // row, whose Enter handler would swallow the buttons' activation.
        onKeyDown={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderInput className="h-4 w-4" aria-hidden="true" />
            {t("session.move.title")}
          </DialogTitle>
          <DialogDescription className="text-body leading-relaxed">
            {t("session.move.description")}
          </DialogDescription>
        </DialogHeader>

        <p className="text-list leading-relaxed text-muted-foreground">
          {t("session.move.resumeNote")}
        </p>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("session.move.searchPlaceholder")}
            aria-label={t("session.move.searchLabel")}
            className="pl-8"
            disabled={isMoving}
          />
        </div>

        <div
          role="radiogroup"
          aria-label={t("session.move.searchLabel")}
          className="max-h-64 overflow-y-auto rounded-md border border-border p-1"
        >
          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-center text-list text-muted-foreground">
              {t("session.move.noProjects")}
            </p>
          ) : (
            filtered.map((project) => {
              const isChosen = project.path === selectedPath;
              // Native radios give the group arrow-key navigation and a
              // single Tab stop.
              return (
                <label
                  key={project.path}
                  className={cn(
                    "flex w-full cursor-pointer flex-col items-start rounded-md px-2 py-2 text-left",
                    "hover:bg-accent hover:text-accent-foreground transition-colors",
                    "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                    isChosen && "bg-accent/15 ring-1 ring-accent/30",
                    isMoving && "pointer-events-none opacity-50"
                  )}
                >
                  <input
                    type="radio"
                    name={radioName}
                    value={project.path}
                    checked={isChosen}
                    disabled={isMoving}
                    onChange={() => setSelectedPath(project.path)}
                    className="sr-only"
                  />
                  <span className="text-list font-medium">
                    {getProjectDisplayName(project)}
                  </span>
                  <span className="break-all text-caption text-muted-foreground">
                    {project.actual_path}
                  </span>
                </label>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isMoving}
          >
            {t("common.cancel", "Cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => selected && onConfirm(selected)}
            disabled={isMoving || !selected}
          >
            {isMoving ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <FolderInput className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {t("session.move.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
