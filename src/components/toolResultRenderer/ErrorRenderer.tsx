import { X } from "lucide-react";
import { RecordedResult } from "@/components/transcript/RecordedResult";
import Markdown from "react-markdown";
import { REMARK_PLUGINS, REHYPE_PLUGINS } from "@/lib/markdownPlugins";
import { useTranslation } from "react-i18next";
import { layout } from "@/components/renderers";
import { cn } from "@/lib/utils";
import { HighlightedText } from "../common/HighlightedText";

type Props = {
  error: string;
  searchQuery?: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
};

export const ErrorRenderer = ({
  error,
  searchQuery,
  isCurrentMatch = false,
  currentMatchIndex = 0,
}: Props) => {
  const { t } = useTranslation();
  // Extract the error details
  const errorMessage = error.replace("Error: ", "");

  return (
    <RecordedResult title={t("error.toolExecutionError")}
        icon={<X className="w-4 h-4" />} record={error} expandKey={"error-result"} searchQuery={searchQuery}>
        <div className={cn(layout.bodyText, layout.containerPadding, layout.rounded, "max-h-80 overflow-y-scroll text-destructive bg-destructive/5 border border-destructive/30 whitespace-pre-wrap")}>
          {searchQuery ? (
            <HighlightedText
              text={errorMessage}
              searchQuery={searchQuery}
              isCurrentMatch={isCurrentMatch}
              currentMatchIndex={currentMatchIndex}
            />
          ) : (
            <Markdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>{errorMessage}</Markdown>
          )}
        </div>
      </RecordedResult>
  );
};
