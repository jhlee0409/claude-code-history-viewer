"use client";

import { memo } from "react";
import { Folder, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Renderer } from "../../shared/RendererHeader";
import { layout } from "@/components/renderers";
import { cn } from "@/lib/utils";
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
 * The header is a neutral label (plan D3): a plain string result carries no
 * verdict, so no check mark, no tool-colour fill, border or title.
 */
export const StringRenderer = memo(function StringRenderer({ result, searchQuery }: Props) {
  const { t } = useTranslation();
  const isFileTree = isFileTreeText(result);

  return (
    <Renderer>
      <Renderer.Header
        title={isFileTree ? t("toolResult.fileStructure") : t("toolResult.toolExecutionResult")}
        icon={
          isFileTree ? (
            <Folder className={cn(layout.iconSize, "shrink-0 text-fg-3")} />
          ) : (
            <FileText className={cn(layout.iconSize, "shrink-0 text-fg-3")} />
          )
        }
        titleClassName="text-fg-2"
      />
      <Renderer.Content>
        <OutputBlock text={result} searchQuery={searchQuery} expandKey="string-output" />
      </Renderer.Content>
    </Renderer>
  );
});
