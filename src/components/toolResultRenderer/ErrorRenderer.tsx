import { X } from "lucide-react";
import { Renderer } from "../../shared/RendererHeader";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import { layout } from "@/components/renderers";
import { cn } from "@/lib/utils";
import { HighlightedText } from "../common/HighlightedText";

type Props = {
  error: string;
  searchQuery?: string;
};

export const ErrorRenderer = ({ error, searchQuery }: Props) => {
  const { t } = useTranslation("components");
  // Extract the error details
  const errorMessage = error.replace("Error: ", "");

  return (
    <Renderer className="bg-destructive/10 border-destructive/30">
      <Renderer.Header
        title={t("error.toolExecutionError")}
        icon={<X className={cn(layout.iconSize, "text-destructive")} />}
        titleClassName="text-destructive"
      />
      <Renderer.Content>
        <div className={cn(layout.bodyText, layout.containerPadding, layout.rounded, "max-h-80 overflow-y-scroll text-destructive bg-destructive/5 border border-destructive/30 whitespace-pre-wrap")}>
          {searchQuery ? (
            <HighlightedText text={errorMessage} searchQuery={searchQuery} />
          ) : (
            <Markdown remarkPlugins={[remarkGfm]}>{errorMessage}</Markdown>
          )}
        </div>
      </Renderer.Content>
    </Renderer>
  );
};
