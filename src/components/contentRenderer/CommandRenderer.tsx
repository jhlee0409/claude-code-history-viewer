import { useId } from "react";
import { Button } from "@/components/ui/button";
import { useEffect } from "react";
import { SquareTerminal, CircleCheckBig, CircleAlert, Info, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import { REMARK_PLUGINS, REHYPE_PLUGINS } from "@/lib/markdownPlugins";
import { cn } from "@/lib/utils";
import { layout } from "@/components/renderers";
import { useCaptureExpandState } from "@/contexts/CaptureExpandContext";
import { HighlightedText } from "../common/HighlightedText";
import { AnsiText } from "../common/AnsiText";
import { stripAnsiCodes } from "@/utils/ansiToHtml";
import { parseCommandMessage } from "@/utils/commandMessage";

type Props = {
  text: string;
  searchQuery?: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
  /** Color variant — "accent" (default, blue) for assistant context, "system" (amber) for system messages */
  variant?: "accent" | "system";
};

const VARIANT_COLORS = {
  accent: {
    text: "text-accent",
    bg: "bg-accent/10",
    border: "border-accent/30",
    hover: "hover:bg-accent/20",
    argBg: "bg-tool-search/20 text-tool-search",
  },
  system: {
    text: "text-warning",
    bg: "bg-warning/10",
    border: "border-warning/30",
    hover: "hover:bg-warning/20",
    argBg: "bg-warning/15 text-warning",
  },
} as const;

export const CommandRenderer = ({
  text,
  searchQuery,
  isCurrentMatch = false,
  currentMatchIndex = 0,
  variant = "accent",
}: Props) => {
  const isCommandExpandedContentId = useId();
  const { t } = useTranslation();
  const [isCommandExpanded, setIsCommandExpanded] = useCaptureExpandState("command", false);
  const colors = VARIANT_COLORS[variant];

  // Auto-expand on search query match
  useEffect(() => {
    if (searchQuery && text.toLowerCase().includes(searchQuery.toLowerCase())) {
      setIsCommandExpanded(true);
    }
  }, [searchQuery, text, setIsCommandExpanded]);

  const {
    command: commandGroup,
    outputs: outputTags,
    caveats,
    localStdout: localStdoutBlocks,
    remainingText: withoutCommands,
  } = parseCommandMessage(text);

  const hasCommandGroup =
    commandGroup.name || commandGroup.message || commandGroup.args;
  const hasOutputs = outputTags.length > 0;
  const hasCaveats = caveats.length > 0;
  const hasLocalStdout = localStdoutBlocks.length > 0;
  // Only show collapse chevron when there's content to expand
  const hasExpandableContent = !!commandGroup.args || !!commandGroup.message || hasLocalStdout;

  if (!hasCommandGroup && !hasOutputs && !hasCaveats && !hasLocalStdout && !withoutCommands) {
    return null;
  }

  return (
    <div className="space-y-2">
      {/* Command Group (with optional inline stdout output) */}
      {hasCommandGroup && (
        <div className={cn(layout.rounded, "border", colors.bg, colors.border)}>
          {hasExpandableContent ? (
            <Button aria-controls={isCommandExpandedContentId} variant="ghost" size="sm" type="button"
              onClick={() => setIsCommandExpanded(prev => !prev)}
              aria-expanded={isCommandExpanded}
              aria-label={`${isCommandExpanded ? t("commandRenderer.collapse") : t("commandRenderer.expand")} ${commandGroup.name || t("commandRenderer.commandExecution")}`}
              className={cn("h-auto whitespace-normal justify-start font-normal", cn(
                "w-full flex items-center",
                layout.iconGap,
                layout.headerPadding,
                layout.rounded,
                "text-left transition-colors",
                colors.hover
              ))}
            >
              <ChevronRight
                className={cn(
                  layout.iconSize,
                  "transition-transform",
                  colors.text,
                  isCommandExpanded && "rotate-90"
                )}
              />
              <SquareTerminal className={cn(layout.iconSize, colors.text)} />
              <span className={cn(layout.titleText, colors.text)}>
                {commandGroup.name ? commandGroup.name : t("commandRenderer.commandExecution")}
              </span>
            </Button>
          ) : (
            <div className={cn("flex items-center", layout.iconGap, layout.headerPadding)}>
              <SquareTerminal className={cn(layout.iconSize, colors.text)} />
              <span className={cn(layout.titleText, colors.text)}>
                {commandGroup.name ? commandGroup.name : t("commandRenderer.commandExecution")}
              </span>
            </div>
          )}

          <div id={isCommandExpandedContentId} hidden={!isCommandExpanded}>{isCommandExpanded && hasExpandableContent && (
            <div className={layout.contentPadding}>
              {/* Command args if present */}
              {commandGroup.args && (
                <div className={cn("flex items-start mb-1.5", layout.iconSpacing)}>
                  <span className={cn("text-caption font-medium mt-0.5 min-w-[40px]", colors.text)}>
                    {t("commandRenderer.arguments")}
                  </span>
                  <code className={cn("px-1.5 py-0.5 text-caption", layout.rounded, "font-mono whitespace-pre-wrap wrap-anywhere", colors.argBg)}>
                    {searchQuery ? (
                      <HighlightedText
                        text={commandGroup.args}
                        searchQuery={searchQuery}
                        isCurrentMatch={isCurrentMatch}
                        currentMatchIndex={currentMatchIndex}
                      />
                    ) : (
                      commandGroup.args
                    )}
                  </code>
                </div>
              )}

              {/* Command message/status if present */}
              {commandGroup.message && (
                <div className={cn("flex items-start mb-1.5", layout.iconSpacing)}>
                  <span className={cn("text-caption font-medium mt-0.5 min-w-[40px]", colors.text)}>
                    {t("commandRenderer.status")}
                  </span>
                  <span className={cn("text-caption italic", colors.text)}>
                    {searchQuery ? (
                      <HighlightedText
                        text={commandGroup.message}
                        searchQuery={searchQuery}
                        isCurrentMatch={isCurrentMatch}
                        currentMatchIndex={currentMatchIndex}
                      />
                    ) : (
                      commandGroup.message
                    )}
                  </span>
                </div>
              )}

              {/* Inline local stdout output (e.g., /cost results) — rendered inside the command card */}
              {localStdoutBlocks.map((output, index) => (
                <div
                  key={index}
                  className={cn(
                    "mt-1.5 px-2.5 py-2",
                    layout.rounded,
                    "bg-background/50 text-foreground/80",
                    "whitespace-pre-wrap font-mono text-list leading-relaxed"
                  )}
                >
                  {searchQuery ? (
                    <HighlightedText
                      text={stripAnsiCodes(output)}
                      searchQuery={searchQuery}
                      isCurrentMatch={isCurrentMatch}
                      currentMatchIndex={currentMatchIndex}
                    />
                  ) : (
                    <AnsiText text={output} />
                  )}
                </div>
              ))}
            </div>
          )}</div>
        </div>
      )}

      {/* Output Tags */}
      {outputTags.map((output, index) => {
        const isError = output.type === "stderr";
        const Icon = isError ? CircleAlert : CircleCheckBig;
        const label = isError
          ? t("commandRenderer.errorOutput")
          : t("commandRenderer.executionResult");

        return (
          <div
            key={index}
            className={cn(
              layout.rounded,
              layout.containerPadding,
              "border",
              isError ? "bg-destructive/10 border-destructive/30" : "bg-success/10 border-success/30"
            )}
          >
            <div className={cn("flex items-center mb-2", layout.iconSpacing)}>
              <Icon className={cn(layout.iconSize, isError ? "text-destructive" : "text-success")} />
              <span className={cn(layout.titleText, isError ? "text-destructive" : "text-success")}>
                {label} ({output.name})
              </span>
            </div>

            <div
              className={cn(
                layout.containerPadding,
                layout.rounded,
                "max-h-80 overflow-y-auto",
                layout.bodyText,
                isError ? "bg-destructive/5 text-destructive" : "bg-success/5 text-success"
              )}
            >
              <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} skipHtml>{output.content}</ReactMarkdown>
            </div>
          </div>
        );
      })}

      {/* Standalone Local Command Output (only when no command group to inline into) */}
      {!hasCommandGroup && localStdoutBlocks.map((output, index) => (
        <div
          key={index}
          className={cn(
            layout.rounded,
            layout.containerPadding,
            "border bg-muted/50 border-border"
          )}
        >
          <div className={cn("flex items-center mb-1.5", layout.iconSpacing)}>
            <SquareTerminal className={cn(layout.iconSize, "text-muted-foreground")} />
            <span className={cn("text-list font-medium text-muted-foreground")}>
              {t("commandRenderer.commandOutput")}
            </span>
          </div>
          <div
            className={cn(
              "px-2.5 py-2",
              layout.rounded,
              "bg-card text-foreground/80",
              "whitespace-pre-wrap font-mono text-list leading-relaxed"
            )}
          >
            {searchQuery ? (
              <HighlightedText
                text={stripAnsiCodes(output)}
                searchQuery={searchQuery}
                isCurrentMatch={isCurrentMatch}
                currentMatchIndex={currentMatchIndex}
              />
            ) : (
              <AnsiText text={output} />
            )}
          </div>
        </div>
      ))}

      {/* Caveats - collapsible info blocks */}
      {caveats.map((caveat, index) => (
        <CaveatRenderer
          key={index}
          content={caveat}
          searchQuery={searchQuery}
          isCurrentMatch={isCurrentMatch}
          currentMatchIndex={currentMatchIndex}
        />
      ))}

      {/* Remaining Text */}
      {withoutCommands && (
        <div className={layout.prose}>
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} skipHtml>
            {withoutCommands}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
};

interface CaveatRendererProps {
  content: string;
  searchQuery?: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
}

const CaveatRenderer = ({
  content,
  searchQuery,
  isCurrentMatch = false,
  currentMatchIndex = 0,
}: CaveatRendererProps) => {
  const isExpandedContentId = useId();
  const [isExpanded, setIsExpanded] = useCaptureExpandState("caveat", false);
  const { t } = useTranslation();

  // 검색 쿼리가 있고 내용에 매칭되면 자동으로 펼치기
  useEffect(() => {
    if (searchQuery && content.toLowerCase().includes(searchQuery.toLowerCase())) {
      setIsExpanded(true);
    }
  }, [searchQuery, content, setIsExpanded]);

  return (
    <div className={cn(layout.rounded, "border bg-info/10 border-info/30")}>
      <Button aria-controls={isExpandedContentId} variant="ghost" size="sm" type="button"
        onClick={() => setIsExpanded(prev => !prev)}
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? t("commandRenderer.collapse") : t("commandRenderer.expand")} ${t("commandRenderer.systemNote")}`}
        className={cn("h-auto whitespace-normal justify-start font-normal", cn(
          "w-full flex items-center",
          layout.iconGap,
          layout.headerPadding,
          layout.rounded,
          "text-left hover:bg-info/20 transition-colors"
        ))}
      >
        <ChevronRight
          className={cn(
            layout.iconSize,
            "transition-transform text-info",
            isExpanded && "rotate-90"
          )}
        />
        <Info className={cn(layout.iconSize, "text-info")} />
        <span className={cn(layout.titleText, "text-info")}>
          {t("commandRenderer.systemNote")}
        </span>
      </Button>

      <div id={isExpandedContentId} hidden={!isExpanded}>{isExpanded && (
        <div className={cn(layout.contentPadding, layout.smallText, "text-info")}>
          {searchQuery ? (
            <HighlightedText
              text={content}
              searchQuery={searchQuery}
              isCurrentMatch={isCurrentMatch}
              currentMatchIndex={currentMatchIndex}
            />
          ) : (
            content
          )}
        </div>
      )}</div>
    </div>
  );
};
