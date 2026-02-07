import { useState, useEffect } from "react";
import { Terminal, CheckCircle, AlertCircle, Info, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { layout } from "@/components/renderers";
import { HighlightedText } from "../common/HighlightedText";

type Props = {
  text: string;
  searchQuery?: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
};

interface CommandGroup {
  name?: string;
  message?: string;
  args?: string;
}

interface OutputTag {
  type: "stdout" | "stderr" | "other";
  name: string;
  content: string;
}

interface CaveatBlock {
  content: string;
}

export const CommandRenderer = ({
  text,
  searchQuery,
  isCurrentMatch = false,
  currentMatchIndex = 0,
}: Props) => {
  const { t } = useTranslation();
  const [isCommandExpanded, setIsCommandExpanded] = useState(false);

  // Auto-expand on search query match
  useEffect(() => {
    if (searchQuery && text.toLowerCase().includes(searchQuery.toLowerCase())) {
      setIsCommandExpanded(true);
    }
  }, [searchQuery, text]);

  // Command 그룹 (name, message, args) 추출
  const commandNameRegex = /<command-name>\s*(.*?)\s*<\/command-name>/gs;
  const commandMessageRegex =
    /<command-message>\s*(.*?)\s*<\/command-message>/gs;
  const commandArgsRegex = /<command-args>\s*(.*?)\s*<\/command-args>/gs;

  const nameMatch = text.match(commandNameRegex);
  const messageMatch = text.match(commandMessageRegex);
  const argsMatch = text.match(commandArgsRegex);

  const extractedName = nameMatch?.[0]
    ?.replace(/<\/?command-name>/g, "")
    .trim();
  const extractedMessage = messageMatch?.[0]
    ?.replace(/<\/?command-message>/g, "")
    .trim();
  const extractedArgs = argsMatch?.[0]
    ?.replace(/<\/?command-args>/g, "")
    .trim();

  // Hide message if it's just the command name without slash (e.g., name="/cost", message="cost")
  const isRedundantMessage =
    extractedName && extractedMessage &&
    extractedName.replace(/^\//, "") === extractedMessage;

  const commandGroup: CommandGroup = {
    name: extractedName && extractedName.length > 0 ? extractedName : undefined,
    message:
      extractedMessage && extractedMessage.length > 0 && !isRedundantMessage
        ? extractedMessage
        : undefined,
    args: extractedArgs && extractedArgs.length > 0 ? extractedArgs : undefined,
  };

  // 출력 태그들 (stdout, stderr 등) 추출 - 더 포괄적인 패턴 사용
  const outputTags: OutputTag[] = [];

  // stdout 계열: stdout, output이 포함된 모든 태그 (local-command-stdout 제외 - 별도 처리)
  const stdoutRegex = /<(?!local-command-stdout)([^>]*(?:stdout|output)[^>]*)\s*>\s*(.*?)\s*<\/\1>/gs;
  // stderr 계열: stderr, error가 포함된 모든 태그
  const stderrRegex = /<([^>]*(?:stderr|error)[^>]*)\s*>\s*(.*?)\s*<\/\1>/gs;

  let match;

  // stdout 계열 태그들
  while ((match = stdoutRegex.exec(text)) !== null) {
    const [, tagName, content] = match;
    if (content && content.trim()) {
      outputTags.push({
        type: "stdout",
        name: tagName ?? "",
        content: content.trim(),
      });
    }
  }

  // stderr 계열 태그들
  while ((match = stderrRegex.exec(text)) !== null) {
    const [, tagName, content] = match;
    if (content && content.trim()) {
      outputTags.push({
        type: "stderr",
        name: tagName ?? "",
        content: content.trim(),
      });
    }
  }

  // Extract local-command-caveat tags
  const caveatRegex = /<local-command-caveat>\s*(.*?)\s*<\/local-command-caveat>/gs;
  const caveats: CaveatBlock[] = [];
  let caveatMatch;
  while ((caveatMatch = caveatRegex.exec(text)) !== null) {
    const [, content] = caveatMatch;
    if (content && content.trim()) {
      caveats.push({ content: content.trim() });
    }
  }

  // Extract local-command-stdout tags (user-visible command output, e.g., /cost)
  const localStdoutRegex = /<local-command-stdout>\s*(.*?)\s*<\/local-command-stdout>/gs;
  const localStdoutBlocks: string[] = [];
  let localStdoutMatch;
  while ((localStdoutMatch = localStdoutRegex.exec(text)) !== null) {
    const [, content] = localStdoutMatch;
    if (content && content.trim()) {
      localStdoutBlocks.push(content.trim());
    }
  }

  // Remove all tags
  const withoutCommands = text
    .replace(commandNameRegex, "")
    .replace(commandMessageRegex, "")
    .replace(commandArgsRegex, "")
    .replace(stdoutRegex, "")
    .replace(stderrRegex, "")
    .replace(caveatRegex, "")
    .replace(localStdoutRegex, "")
    .replace(/^\s*\n/gm, "")
    .trim();

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
        <div className={cn(layout.rounded, "border bg-accent/10 border-accent/30")}>
          {hasExpandableContent ? (
            <button
              onClick={() => setIsCommandExpanded(!isCommandExpanded)}
              aria-expanded={isCommandExpanded}
              aria-label={`${isCommandExpanded ? t("commandRenderer.collapse") : t("commandRenderer.expand")} ${commandGroup.name || t("commandRenderer.commandExecution")}`}
              className={cn(
                "w-full flex items-center",
                layout.iconGap,
                layout.headerPadding,
                layout.rounded,
                "text-left hover:bg-accent/20 transition-colors"
              )}
            >
              <ChevronRight
                className={cn(
                  layout.iconSize,
                  "transition-transform text-accent",
                  isCommandExpanded && "rotate-90"
                )}
              />
              <Terminal className={cn(layout.iconSize, "text-accent")} />
              <span className={cn(layout.titleText, "text-accent")}>
                {commandGroup.name ? commandGroup.name : t("commandRenderer.commandExecution")}
              </span>
            </button>
          ) : (
            <div className={cn("flex items-center", layout.iconGap, layout.headerPadding)}>
              <Terminal className={cn(layout.iconSize, "text-accent")} />
              <span className={cn(layout.titleText, "text-accent")}>
                {commandGroup.name ? commandGroup.name : t("commandRenderer.commandExecution")}
              </span>
            </div>
          )}

          {isCommandExpanded && hasExpandableContent && (
            <div className={layout.contentPadding}>
              {/* Command args if present */}
              {commandGroup.args && (
                <div className={cn("flex items-start mb-1.5", layout.iconSpacing)}>
                  <span className={cn("text-[11px] font-medium mt-0.5 min-w-[40px] text-accent")}>
                    {t("commandRenderer.arguments")}
                  </span>
                  <code className={cn("px-1.5 py-0.5 text-[11px]", layout.rounded, "font-mono whitespace-pre-wrap bg-tool-search/20 text-tool-search")}>
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
                  <span className={cn("text-[11px] font-medium mt-0.5 min-w-[40px] text-accent")}>
                    {t("commandRenderer.status")}
                  </span>
                  <span className={cn("text-[11px] italic text-accent")}>
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
                    "whitespace-pre-wrap font-mono text-xs leading-relaxed"
                  )}
                >
                  {searchQuery ? (
                    <HighlightedText
                      text={output}
                      searchQuery={searchQuery}
                      isCurrentMatch={isCurrentMatch}
                      currentMatchIndex={currentMatchIndex}
                    />
                  ) : (
                    output
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Output Tags */}
      {outputTags.map((output, index) => {
        const isError = output.type === "stderr";
        const Icon = isError ? AlertCircle : CheckCircle;
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
              <Markdown remarkPlugins={[remarkGfm]}>{output.content}</Markdown>
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
            <Terminal className={cn(layout.iconSize, "text-muted-foreground")} />
            <span className={cn("text-xs font-medium text-muted-foreground")}>
              {t("commandRenderer.commandOutput")}
            </span>
          </div>
          <div
            className={cn(
              "px-2.5 py-2",
              layout.rounded,
              "bg-card text-foreground/80",
              "whitespace-pre-wrap font-mono text-xs leading-relaxed"
            )}
          >
            {searchQuery ? (
              <HighlightedText
                text={output}
                searchQuery={searchQuery}
                isCurrentMatch={isCurrentMatch}
                currentMatchIndex={currentMatchIndex}
              />
            ) : (
              output
            )}
          </div>
        </div>
      ))}

      {/* Caveats - collapsible info blocks */}
      {caveats.map((caveat, index) => (
        <CaveatRenderer
          key={index}
          content={caveat.content}
          searchQuery={searchQuery}
          isCurrentMatch={isCurrentMatch}
          currentMatchIndex={currentMatchIndex}
        />
      ))}

      {/* Remaining Text */}
      {withoutCommands && (
        <div className={layout.prose}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
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
  const [isExpanded, setIsExpanded] = useState(false);
  const { t } = useTranslation();

  // 검색 쿼리가 있고 내용에 매칭되면 자동으로 펼치기
  useEffect(() => {
    if (searchQuery && content.toLowerCase().includes(searchQuery.toLowerCase())) {
      setIsExpanded(true);
    }
  }, [searchQuery, content]);

  return (
    <div className={cn(layout.rounded, "border bg-info/10 border-info/30")}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? t("commandRenderer.collapse") : t("commandRenderer.expand")} ${t("commandRenderer.systemNote")}`}
        className={cn(
          "w-full flex items-center",
          layout.iconGap,
          layout.headerPadding,
          layout.rounded,
          "text-left hover:bg-info/20 transition-colors"
        )}
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
      </button>

      {isExpanded && (
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
      )}
    </div>
  );
};
