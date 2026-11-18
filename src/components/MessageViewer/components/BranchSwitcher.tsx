/**
 * BranchSwitcher (#782)
 *
 * Inline control at a fork of the conversation (an edited prompt, `/rewind`,
 * a resume at an earlier message): "Branch ‹ 2 / 3 ›". Choosing another
 * alternative swaps everything after the fork for that alternative.
 */

import { memo, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, GitBranch } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon/Icon";
import { Num } from "@/lib/format/Num";
import type { BranchSwitch } from "@/utils/conversationBranches";

type Control = "previous" | "next";

/**
 * The control to focus once a switch re-renders: the button pressed, or the
 * other one when it just became disabled (the end of the list). A switcher
 * drawn on the alternative's own first row moves to another row when the
 * alternative changes; the new one takes the focus the old one had.
 */
let pendingFocus: { parentUuid: string; control: Control } | null = null;

interface BranchSwitcherProps {
  branch: BranchSwitch;
  onSelect: (parentUuid: string, headUuid: string) => void;
}

export const BranchSwitcher = memo(function BranchSwitcher({ branch, onSelect }: BranchSwitcherProps) {
  const { t } = useTranslation();
  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const { parentUuid, headUuids, position } = branch;
  const total = headUuids.length;
  const hasPrevious = position > 0;
  const hasNext = position < total - 1;

  useEffect(() => {
    if (pendingFocus?.parentUuid !== parentUuid) return;
    const wanted = pendingFocus.control === "previous" ? previousRef.current : nextRef.current;
    const target = wanted && !wanted.disabled ? wanted : (hasPrevious ? previousRef.current : nextRef.current);
    pendingFocus = null;
    target?.focus();
  }, [parentUuid, position, hasPrevious]);

  const go = (control: Control) => {
    const head = headUuids[control === "previous" ? position - 1 : position + 1];
    if (!head) return;
    pendingFocus = { parentUuid, control };
    onSelect(parentUuid, head);
  };

  const buttonClass = cn(
    "inline-flex items-center justify-center rounded-md p-1",
    "text-muted-foreground hover:bg-muted hover:text-foreground transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    "disabled:opacity-40 disabled:pointer-events-none",
  );

  return (
    <div className="flex items-center gap-3 py-2" data-branch-point={parentUuid}>
      <div className="flex-1 h-px bg-border/40" />
      <div
        role="group"
        aria-label={t("messageViewer.conversationBranch.group", { current: position + 1, total })}
        title={t("messageViewer.conversationBranch.hint")}
        className="inline-flex items-center gap-1 text-caption text-muted-foreground"
      >
        <Icon icon={GitBranch} size={14} aria-hidden="true" />
        <span className="font-medium">{t("messageViewer.conversationBranch.label")}</span>
        <button
          ref={previousRef}
          type="button"
          className={buttonClass}
          disabled={!hasPrevious}
          onClick={() => go("previous")}
          aria-label={t("messageViewer.conversationBranch.previous")}
        >
          <Icon icon={ChevronLeft} size={14} aria-hidden="true" />
        </button>
        <span aria-hidden="true">
          <Num>{`${position + 1} / ${total}`}</Num>
        </span>
        <button
          ref={nextRef}
          type="button"
          className={buttonClass}
          disabled={!hasNext}
          onClick={() => go("next")}
          aria-label={t("messageViewer.conversationBranch.next")}
        >
          <Icon icon={ChevronRight} size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="flex-1 h-px bg-border/40" />
    </div>
  );
});
