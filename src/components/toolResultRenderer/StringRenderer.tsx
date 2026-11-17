"use client";
import { Button } from "@/components/ui/button";

import { memo, useContext, useEffect, useId } from "react";
import { ChevronRight, Folder, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { layout } from "@/components/renderers";
import { cn } from "@/lib/utils";
import { useToggle } from "@/hooks/useToggle";
import { RendererDefaultsContext } from "@/shared/rendererDefaults";
import { OutputBlock } from "../transcript/OutputBlock";
import { isFileTreeText } from "../transcript/outputKind";

type Props = {
  result: string;
  searchQuery?: string;
};

/**
 * A plain string tool result. The text is shown as recorded in an
 * OutputBlock (plan TR0, D6): whitespace and line breaks kept, never read as
 * Markdown; ANSI colour and the file-tree / table detection stay. The line
 * cap, "Show all n lines" and the search reveal live in OutputBlock.
 *
 * The header is a neutral disclosure (plan D3: a plain string result carries
 * no verdict, so no check mark, no tool-colour fill or title) with
 * `aria-expanded` + `aria-controls`. The result is one box, the OutputBlock's
 * well — no bordered card around it — and the header always says "Tool
 * Execution Result": what the text is (a file tree, a table) is the well's
 * own label, said once (renderer audit TR9). The open state lives in the
 * capture expand registry under the key the shared renderer header used.
 */
export const StringRenderer = memo(function StringRenderer({ result, searchQuery }: Props) {
  const { t } = useTranslation();
  const ambient = useContext(RendererDefaultsContext);
  const [open, toggle, setOpen] = useToggle("renderer", ambient.defaultExpanded);
  // A search hit inside the text opens the result once, as before TR0
  // (CodeRabbit 4362895001); the user can still collapse it (review round 6), and a new matching query
  // opens it again (review round 7).
  // Same match rule as OutputBlock's reveal.
  const query = searchQuery?.trim().toLowerCase() ?? "";
  const searchHit = query !== "" && result.toLowerCase().includes(query);
  useEffect(() => {
    if (searchHit) setOpen(true);
  }, [searchHit, query, setOpen]);
  const contentId = useId();
  const Icon = isFileTreeText(result) ? Folder : FileText;

  return (
    <div className="mt-1">
      <Button variant="ghost" size="sm"
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={contentId}
        className={cn("h-auto whitespace-normal justify-start font-normal", cn(
          "flex w-full items-center rounded-row text-left hover:bg-surface-hover",
          layout.iconGap,
          layout.headerPadding,
          layout.headerHeight,
        ))}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(layout.iconSize, "shrink-0 text-fg-3 transition-transform", open && "rotate-90")}
        />
        <Icon aria-hidden="true" className={cn(layout.iconSize, "shrink-0 text-fg-3")} />
        <span className={cn(layout.titleText, "truncate text-fg-2")}>{t("toolResult.toolExecutionResult")}</span>
      </Button>
      <div id={contentId} hidden={!open} className={open ? layout.contentPadding : undefined}>
        {open && <OutputBlock text={result} searchQuery={searchQuery} expandKey="string-output" />}
      </div>
    </div>
  );
});
