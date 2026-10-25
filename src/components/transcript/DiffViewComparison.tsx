/**
 * The diff's comparison modes and its `…` menu (plan §4.3 "펼친 Edit",
 * feature table "고급 비교", TR2a).
 *
 * Unified (DiffView) is the default. The two older viewers — the advanced
 * compare (AdvancedTextDiff, its six methods) and the side-by-side
 * react-diff-viewer — moved behind the menu unchanged; feature parity on
 * the new line model is TR2b. The same menu holds the copies and, where the
 * diff is not already on the Edits screen, "Open in Recent edits".
 */
import { useState } from "react";
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
import { AdvancedTextDiff } from "../AdvancedTextDiff";
import { SideBySideDiff } from "../EnhancedDiffViewer";
import { DiffView, type DiffSection } from "./DiffView";

export type ComparisonMode = "unified" | "sideBySide" | "advanced";

const MODES: ReadonlyArray<{ mode: ComparisonMode; key: "diffView.modeUnified" | "diffView.modeSideBySide" | "diffView.modeAdvanced" }> = [
  { mode: "unified", key: "diffView.modeUnified" },
  { mode: "sideBySide", key: "diffView.modeSideBySide" },
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
        <button
          type="button"
          aria-label={label}
          title={label}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-row text-fg-3 hover:bg-surface-hover hover:text-fg"
        >
          <Ellipsis className="w-4 h-4" aria-hidden="true" />
        </button>
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
}

/** The diff in the chosen mode. One element, so whatever precedes it stays directly above it. */
export function DiffComparisonBody({ mode, sections, filePath = "", expandKey, context, label }: DiffComparisonBodyProps) {
  const { t } = useTranslation();
  if (mode === "unified") return <DiffView sections={sections} expandKey={expandKey} context={context} label={label} />;
  if (mode === "sideBySide") {
    return (
      <div data-diff-mode="sideBySide" className="space-y-2">
        {sections.map((section, index) => (
          <SideBySideDiff key={index} oldText={section.oldText} newText={section.newText} filePath={filePath} />
        ))}
      </div>
    );
  }
  return (
    <div data-diff-mode="advanced" className="space-y-2">
      {sections.map((section, index) => (
        <AdvancedTextDiff key={index} oldText={section.oldText} newText={section.newText} title={t("diffViewer.advancedTextAnalysis")} />
      ))}
    </div>
  );
}

export interface DiffWithMenuProps {
  oldText: string;
  newText: string;
  filePath?: string;
  expandKey: string;
}

/**
 * A whole-file diff with its `…` menu on a line above it (the Edits screen's
 * diff view): comparison mode and "Copy After Code", as its old toolbar had.
 * The screen's own layout is ED1; this only swaps the viewer.
 */
export function DiffWithMenu({ oldText, newText, filePath = "", expandKey }: DiffWithMenuProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ComparisonMode>("unified");
  return (
    <div data-diff-with-menu="">
      <div className="flex min-h-row-list items-center justify-end">
        <DiffActionsMenu mode={mode} onModeChange={setMode} copies={[{ label: t("diffViewer.copyAfterCode"), text: newText }]} />
      </div>
      <DiffComparisonBody mode={mode} sections={[{ oldText, newText }]} filePath={filePath} expandKey={expandKey} />
    </div>
  );
}
