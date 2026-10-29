/**
 * The diff's comparison modes and its `…` menu (plan §4.3 "펼친 Edit",
 * feature table "고급 비교", TR2a).
 *
 * Unified is the default; split, word emphasis and six advanced methods all
 * use DiffView's line model and rendering. The menu also holds exact recorded
 * copy payloads and, outside the Edits screen, "Open in Recent edits".
 */
import { useState } from "react";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { Ellipsis } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copyTextToClipboard } from "@/utils/clipboard";
import { Button } from "@/components/ui/button";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { COMPARE_METHODS, type CompareMethod } from "./advancedCompare";

import type { TextHighlight } from "./ToolRow";
import { DiffView, type DiffSection } from "./DiffView";

export type ComparisonMode = "unified" | "sideBySide" | "words" | "advanced";

const MODES: ReadonlyArray<{ mode: ComparisonMode; key: "diffView.modeUnified" | "diffView.modeSideBySide" | "diffView.modeWords" | "diffView.modeAdvanced" }> = [
  { mode: "unified", key: "diffView.modeUnified" },
  { mode: "sideBySide", key: "diffView.modeSideBySide" },
  { mode: "words", key: "diffView.modeWords" },
  { mode: "advanced", key: "diffView.modeAdvanced" },
];

const isMode = (value: string): value is ComparisonMode => MODES.some((m) => m.mode === value);

export interface CopyAction {
  label: string;
  text: string;
}

export interface DiffActionsMenuProps {
  mode: ComparisonMode;
  onModeChange: (mode: ComparisonMode) => void;
  copies?: CopyAction[];
  /** A last item that opens another place ("Open in Recent edits"); omitted on that place itself. */
  openIn?: { label: string; onSelect: () => void };
}

export function DiffActionsMenu({ mode, onModeChange, copies = [], openIn }: DiffActionsMenuProps) {
  const { t } = useTranslation();
  const label = t("diffView.moreActions");

  const copy = async (text: string) => {
    try {
      await copyTextToClipboard(text);
      toast.success(t("diffView.copied"));
    } catch (error) {
      console.error("Failed to copy from the diff menu:", error);
      toast.error(t("diffView.copyFailed"));
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm"
          type="button"
          aria-label={label}
          title={label}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-row text-fg-3 hover:bg-surface-hover hover:text-fg"
        >
          <Ellipsis className="w-4 h-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLabel>{t("diffView.comparison")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode} onValueChange={(value) => isMode(value) && onModeChange(value)}>
          {MODES.map(({ mode: value, key }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {t(key)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {(copies.length > 0 || openIn) && <DropdownMenuSeparator />}
        {copies.map((action) => (
          <DropdownMenuItem key={action.label} onSelect={() => void copy(action.text)}>
            {action.label}
          </DropdownMenuItem>
        ))}
        {openIn && <DropdownMenuItem onSelect={openIn.onSelect}>{openIn.label}</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface DiffComparisonBodyProps {
  mode: ComparisonMode;
  sections: DiffSection[];
  filePath?: string;
  expandKey: string;
  /** DiffView's folding of unchanged lines. */
  context?: number;
  /** Accessible name of the unified diff. */
  label?: string;
  highlight?: TextHighlight;
}

/** The diff in the chosen mode. One element, so whatever precedes it stays directly above it. */
export function DiffComparisonBody({ mode, sections, filePath, expandKey, context, label, highlight }: DiffComparisonBodyProps) {
  const { t } = useTranslation();
  const [method, setMethod] = useState<CompareMethod>("lines");
  const view = <DiffView filePath={filePath} highlight={highlight} sections={sections} expandKey={`${expandKey}:${mode}`} context={context} label={label} split={mode === "sideBySide"} method={mode === "words" || mode === "sideBySide" ? "words" : mode === "advanced" ? method : undefined} />;
  if (mode !== "advanced") return view;
  return <div data-diff-mode="advanced" className="space-y-2">
    <Segmented size="toolbar" className="flex-wrap" aria-label={t("advancedTextDiff.comparisonMethod")} value={method} onValueChange={value => COMPARE_METHODS.includes(value as CompareMethod) && setMethod(value as CompareMethod)}>
      {COMPARE_METHODS.map(value => <SegmentedItem key={value} value={value}>{t(`advancedTextDiff.modes.${value}`)}</SegmentedItem>)}
    </Segmented>
    {sections.map((section, index) => <DiffView key={index} sections={[section]} expandKey={`${expandKey}:advanced-${index}`} context={context} label={label} method={method} highlight={highlight} />)}
  </div>;
}

/** Added/removed filters keep the existing extracted groups, but share all drawing,
 * markers, cap, colours and disclosure semantics with the main diff. */
export function DiffFiltered({ groups, kind, expandKey }: { groups: { startLine: number; lines: string[] }[]; kind: "added" | "removed"; expandKey: string }) {
  const { t } = useTranslation();
  if (!groups.length) return <p className="p-3 text-caption text-fg-3">{t("recentEdits.noLinesToShow")}</p>;
  const added = kind === "added";
  const sections: DiffSection[] = groups.map(group => ({ oldText: added ? "" : group.lines.join("\n"), newText: added ? group.lines.join("\n") : "", oldStart: group.startLine, newStart: group.startLine }));
  return <ExpandKeyProvider value={expandKey}><DiffView sections={sections} expandKey="filtered" /></ExpandKeyProvider>;
}

export interface DiffWithMenuProps {
  oldText: string;
  newText: string;
  filePath?: string;
  expandKey: string;
  sections?: DiffSection[];
  highlight?: TextHighlight;
}

/**
 * A whole-file diff with its `…` menu on a line above it (the Edits screen's
 * diff view): comparison mode and "Copy After Code", as its old toolbar had.
 * The screen's own layout is ED1; this only swaps the viewer.
 */
export function DiffWithMenu({ oldText, newText, filePath = "", expandKey, sections, highlight }: DiffWithMenuProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ComparisonMode>("unified");
  return (
    <div data-diff-with-menu="">
      <div className="flex min-h-row-list items-center justify-end">
        <DiffActionsMenu mode={mode} onModeChange={setMode} copies={[{ label: t("diffViewer.copyAfterCode"), text: newText }]} />
      </div>
      <DiffComparisonBody mode={mode} sections={sections ?? [{ oldText, newText }]} filePath={filePath} expandKey={expandKey} highlight={highlight} />
    </div>
  );
}
