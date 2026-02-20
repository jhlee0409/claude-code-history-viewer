"use client";

import { memo } from "react";

/**
 * ClaudeToolResultItem - Renders tool execution results
 *
 * Handles different result types:
 * - Numbered file content (with line numbers)
 * - File search results
 * - Generic tool results (text/array/object)
 */

import { Check, FileText, AlertTriangle, Folder, File } from "lucide-react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Highlight, themes } from "prism-react-renderer";
import { useCopyButton } from "../../hooks/useCopyButton";
import { Renderer } from "../../shared/RendererHeader";
import { cn } from "@/lib/utils";
import { useTheme } from "@/contexts/theme";
import { HighlightedText } from "../common";
import {
  type IndexedRendererProps,
  getVariantStyles,
  hasNumberedLines,
  extractCodeFromNumberedLines,
  parseSystemReminders,
  isFileSearchResult,
  parseFilePath,
  codeTheme,
  safeStringify,
  layout,
} from "../renderers";
import { getPreStyles, getLineStyles, getTokenStyles, getInlineLineNumberStyles } from "@/utils/prismStyles";

interface ClaudeToolResultItemProps extends IndexedRendererProps {
  toolResult: Record<string, unknown>;
}

export const ClaudeToolResultItem = memo(function ClaudeToolResultItem({
  toolResult,
  index,
  searchQuery = "",
  isCurrentMatch = false,
  currentMatchIndex = 0,
}: ClaudeToolResultItemProps) {
  const { t } = useTranslation();
  const { renderCopyButton } = useCopyButton();
  const { isDarkMode } = useTheme();

  const toolUseId = (toolResult.tool_use_id as string) || "";
  const content = toolResult.content;
  const isError = toolResult.is_error === true;

  // Get variant based on error state
  const variant = isError ? "error" : "success";
  const styles = getVariantStyles(variant);

  // Tool ID with search highlighting
  const renderToolUseId = (id: string) => {
    if (!id) return null;
    const label = `${t("common.toolId")}: ${id}`;
    return searchQuery ? (
      <HighlightedText
        text={label}
        searchQuery={searchQuery}
        isCurrentMatch={isCurrentMatch}
        currentMatchIndex={currentMatchIndex}
      />
    ) : (
      <>{label}</>
    );
  };

  // Render system reminder messages
  const renderSystemMessages = (
    messages: Array<{ type: string; message: string }>
  ) => {
    if (messages.length === 0) return null;
    const warningStyles = getVariantStyles("warning");

    return (
      <div className="mt-3 space-y-2">
        {messages.map((msg, idx) => (
          <div key={idx} className={cn("p-2", layout.rounded, "border", warningStyles.container)}>
            <div className={cn("flex items-center mb-1", layout.iconSpacing)}>
              <AlertTriangle className={cn(layout.iconSize, warningStyles.icon)} />
              <span className={cn(layout.titleText, warningStyles.title)}>
                {msg.type?.replace("-", " ") || "System Message"}
              </span>
            </div>
            <div className={cn(layout.bodyText, warningStyles.accent)}>
              {msg.message}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Render file search results
  const renderFileSearchResult = (text: string) => {
    const lines = text.trim().split("\n");
    const headerLine = lines[0];
    const filePaths = lines.slice(1).filter((line) => line.trim().length > 0);
    const infoStyles = getVariantStyles("info");

    return (
      <div className="space-y-2">
        {/* Header */}
        <div className={cn("flex items-center mb-1 p-2 border", layout.iconSpacing, layout.rounded, infoStyles.container)}>
          <Folder className={cn(layout.iconSize, infoStyles.icon)} />
          <span className={cn(layout.bodyText, infoStyles.accent)}>{headerLine}</span>
        </div>

        {/* File list */}
        <div className="space-y-1">
          {filePaths.map((filePath, idx) => {
            const { directory, fileName } = parseFilePath(filePath);

            return (
              <div
                key={idx}
                className={cn("flex items-center p-2 bg-card border border-border", layout.iconSpacing, layout.rounded)}
              >
                <File className={cn(layout.iconSize, "text-muted-foreground")} />
                <div className="flex-1 min-w-0">
                  <div className={cn("font-mono text-foreground/80", layout.bodyText)}>
                    {fileName}
                  </div>
                  {directory && (
                    <div className={cn("font-mono text-muted-foreground", layout.smallText)}>
                      {directory}
                    </div>
                  )}
                </div>
                {renderCopyButton(filePath, `file-path-${idx}`, t("toolResult.copyPath"))}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // === Numbered File Content ===
  if (typeof content === "string" && hasNumberedLines(content)) {
    const { content: cleanContent, reminders } = parseSystemReminders(content);
    const { code, description, language } = extractCodeFromNumberedLines(cleanContent);

    return (
      <Renderer className={styles.container} hasError={isError}>
        <Renderer.Header
          title={t("toolResult.fileContent")}
          icon={<FileText className={cn(layout.iconSize, styles.icon)} />}
          titleClassName={styles.title}
          rightContent={
            <div className={cn("flex items-center", layout.iconSpacing)}>
              {renderCopyButton(code, `tool-result-code-${index}`, t("toolResult.copyCode"))}
              {toolUseId && (
                <code className={cn(layout.smallText, "px-1 bg-secondary text-foreground/80", layout.rounded)}>
                  {renderToolUseId(toolUseId)}
                </code>
              )}
            </div>
          }
        />
        <Renderer.Content>
          {/* Description */}
          {description && (
            <div className={cn("p-2 bg-secondary border border-border mb-2", layout.rounded)}>
              <div className="text-foreground/80">{description}</div>
            </div>
          )}

          {/* Code block */}
          <div className={cn("overflow-hidden", layout.rounded)}>
            <div className={cn("flex justify-between items-center px-3 py-1 bg-secondary border-b border-border", layout.bodyText)}>
              <span className="text-foreground/80">{language}</span>
              <span className="text-muted-foreground">
                {code.split("\n").length} {t("toolResult.lines")}
              </span>
            </div>
            <Highlight theme={isDarkMode ? themes.vsDark : themes.vsLight} code={code} language={language}>
              {({ className, style, tokens, getLineProps, getTokenProps }) => (
                <pre
                  className={className}
                  style={getPreStyles(isDarkMode, style, {
                    fontSize: "0.9375rem",
                    lineHeight: codeTheme.lineHeight,
                    maxHeight: "32rem",
                    overflow: "auto",
                    padding: "1rem",
                  })}
                >
                  {tokens.map((line, i) => {
                    const lineProps = getLineProps({ line });
                    return (
                      <div key={i} {...lineProps} style={getLineStyles(lineProps.style)}>
                        <span style={getInlineLineNumberStyles()}>
                          {i + 1}
                        </span>
                        {line.map((token, key) => {
                          const tokenProps = getTokenProps({ token });
                          return (
                            <span
                              key={key}
                              {...tokenProps}
                              style={getTokenStyles(isDarkMode, tokenProps.style)}
                            />
                          );
                        })}
                      </div>
                    );
                  })}
                </pre>
              )}
            </Highlight>
          </div>

          {renderSystemMessages(reminders)}
        </Renderer.Content>
      </Renderer>
    );
  }

  // === File Search Results ===
  if (typeof content === "string" && isFileSearchResult(content)) {
    const { content: cleanContent, reminders } = parseSystemReminders(content);

    return (
      <Renderer className={styles.container} hasError={isError}>
        <Renderer.Header
          title={t("toolResult.fileSearchResult")}
          icon={<Folder className={cn(layout.iconSize, styles.icon)} />}
          titleClassName={styles.title}
          rightContent={
            <div className={cn("flex items-center", layout.iconSpacing)}>
              {renderCopyButton(cleanContent, `file-search-result-${index}`, t("toolResult.copyResult"))}
              {toolUseId && (
                <code className={cn(layout.smallText, "px-1 bg-secondary text-foreground/80", layout.rounded)}>
                  {renderToolUseId(toolUseId)}
                </code>
              )}
            </div>
          }
        />
        <Renderer.Content>
          {renderFileSearchResult(cleanContent)}
          {renderSystemMessages(reminders)}
        </Renderer.Content>
      </Renderer>
    );
  }

  // === Default Result Renderer ===
  return (
    <Renderer className={styles.container} hasError={isError}>
      <Renderer.Header
        title={t("toolResult.toolExecutionResult")}
        icon={<Check className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={
          toolUseId && (
            <code className={cn(layout.smallText, isError ? "text-destructive" : styles.accent)}>
              {renderToolUseId(toolUseId)}
            </code>
          )
        }
      />
      <Renderer.Content>
        <div className={layout.bodyText}>
          {typeof content === "string" ? (
            <div className={layout.prose}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
              </ReactMarkdown>
            </div>
          ) : Array.isArray(content) ? (
            <div className="space-y-2">
              {content.map((item: unknown, idx: number) => {
                if (item && typeof item === "object") {
                  const contentItem = item as Record<string, unknown>;

                  // Text type
                  if (contentItem.type === "text" && typeof contentItem.text === "string") {
                    return (
                      <div key={idx} className={layout.prose}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {contentItem.text}
                        </ReactMarkdown>
                      </div>
                    );
                  }

                  // Other object
                  return (
                    <pre
                      key={idx}
                      className={cn("p-2 bg-secondary text-foreground/80 overflow-x-auto", layout.rounded, layout.smallText)}
                    >
                      {safeStringify(item)}
                    </pre>
                  );
                }

                // Simple value
                return (
                  <div key={idx} className="text-foreground/80">
                    {String(item)}
                  </div>
                );
              })}
            </div>
          ) : (
            <pre className={cn("p-2 bg-secondary text-foreground/80 overflow-x-auto", layout.rounded, layout.smallText)}>
              {safeStringify(content)}
            </pre>
          )}
        </div>
      </Renderer.Content>
    </Renderer>
  );
});
