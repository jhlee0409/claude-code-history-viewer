/**
 * ProseBlock (TR1a): recorded prose — an agent's prompt or report — read as
 * Markdown, without a box around it (renderer audit NC3: no nested coloured
 * folds inside an opened row). Long prose is capped at `lineCap` source
 * lines; the rest waits behind "Show all n lines", a disclosure
 * (`aria-expanded` + `aria-controls` to the prose itself) that stays in the
 * DOM after opening, so focus never drops to the page (amendment 14). Its
 * state lives in the capture expand registry under `expandKey`, one key per
 * block, so two blocks in one row open separately.
 */
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useCaptureExpandState } from "@/contexts/CaptureExpandContext";
import { Markdown } from "../common/Markdown";

export const PROSE_LINE_CAP = 12;

export function ProseBlock({ text, expandKey, lineCap = PROSE_LINE_CAP }: { text: string; expandKey: string; lineCap?: number }) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useCaptureExpandState(`${expandKey}:all`, false);
  const id = useId();
  const lines = text.split("\n");
  const overCap = lines.length > lineCap;
  const shown = overCap && !showAll ? lines.slice(0, lineCap).join("\n") : text;

  return (
    <div data-prose="">
      <div id={id} className="text-list text-fg">
        <Markdown>{shown}</Markdown>
      </div>
      {overCap && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          aria-controls={id}
          className="mt-1 text-caption text-fg-2 hover:text-fg"
        >
          {showAll ? t("outputBlock.showLess") : t("outputBlock.showAll", { count: lines.length })}
        </button>
      )}
    </div>
  );
}
