"use client";

import { memo } from "react";
import { Folder, Check } from "lucide-react";
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
 */
export const StringRenderer = memo(function StringRenderer({ result, searchQuery }: Props) {
  const { t } = useTranslation();
  const isFileTree = isFileTreeText(result);

  return (
    <Renderer className="bg-tool-file/10 border-tool-file/30">
      <Renderer.Header
        title={isFileTree ? t("toolResult.fileStructure") : t("toolResult.toolExecutionResult")}
        icon={
          isFileTree ? (
            <Folder className={cn(layout.iconSize, "text-tool-file")} />
          ) : (
            <Check className={cn(layout.iconSize, "text-tool-file")} />
          )
        }
        titleClassName="text-tool-file"
      />
      <Renderer.Content>
        <OutputBlock text={result} searchQuery={searchQuery} expandKey="string-output" />
      </Renderer.Content>
    </Renderer>
  );
});
