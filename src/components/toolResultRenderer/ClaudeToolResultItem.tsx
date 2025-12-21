"use client";

import { Check, FileText, AlertTriangle, Folder, File } from "lucide-react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Highlight, themes } from "prism-react-renderer";
import { useCopyButton } from "../../hooks/useCopyButton";
import { Renderer } from "../../shared/RendererHeader";
import { cn } from "../../utils/cn";
import { COLORS } from "../../constants/colors";
import { HighlightedText } from "../common";

type Props = {
  toolResult: Record<string, unknown>;
  index: number;
  searchQuery?: string;
  isCurrentMatch?: boolean;
};

export const ClaudeToolResultItem = ({
  toolResult,
  index,
  searchQuery = "",
  isCurrentMatch = false,
}: Props) => {
  const { t } = useTranslation("components");
  const { renderCopyButton } = useCopyButton();
  const toolUseId = toolResult.tool_use_id || "";
  const content = toolResult.content || "";
  const isError = toolResult.is_error === true;

  // Tool ID 렌더링 헬퍼 (검색 하이라이팅 지원)
  const renderToolUseId = (id: string) => {
    if (!id) return null;
    const idString = String(id);
    return searchQuery ? (
      <HighlightedText
        text={`Tool ID: ${idString}`}
        searchQuery={searchQuery}
        isCurrentMatch={isCurrentMatch}
      />
    ) : (
      <>Tool ID: {idString}</>
    );
  };

  // 줄 번호가 붙은 파일 내용인지 감지하는 함수
  const isNumberedFileContent = (text: string): boolean => {
    if (typeof text !== "string") return false;

    // 멀티라인에서 "숫자→" 패턴이 있는지 확인
    const hasNumberedLines = /^\s*\d+→/m.test(text);
    // 여러 줄이 있는지 확인
    const hasMultipleLines = text.split("\n").length > 1;
    // 최소 2개 이상의 줄 번호가 있는지 확인
    const numberedLineCount = (text.match(/^\s*\d+→/gm) || []).length;

    return hasNumberedLines && hasMultipleLines && numberedLineCount >= 2;
  };

  // system-reminder 태그와 기타 시스템 메시지를 분리하는 함수
  const separateSystemContent = (
    text: string
  ): {
    codeContent: string;
    systemMessages: Array<{ type: string; content: string }>;
  } => {
    if (typeof text !== "string")
      return { codeContent: text, systemMessages: [] };

    const systemMessages: Array<{ type: string; content: string }> = [];
    let codeContent = text;

    // system-reminder 태그 추출
    const systemReminderMatch = text.match(
      /<system-reminder>(.*?)<\/system-reminder>/s
    );
    if (
      systemReminderMatch &&
      systemReminderMatch[0] &&
      systemReminderMatch[1]
    ) {
      systemMessages.push({
        type: "system-reminder",
        content: systemReminderMatch[1].trim(),
      });
      codeContent = codeContent.replace(systemReminderMatch[0], "").trim();
    }

    return { codeContent, systemMessages };
  };

  // 줄 번호를 제거하고 원본 코드를 추출하는 함수
  const extractCodeFromNumberedLines = (
    text: string
  ): { code: string; language: string; description: string } => {
    const lines = text.split("\n");
    const codeLines: string[] = [];
    const descriptionLines: string[] = [];
    let detectedLanguage = "text"; // 기본값

    for (const line of lines) {
      const match = line.match(/^\s*\d+→(.*)$/);
      if (match && match[1] !== undefined) {
        codeLines.push(match[1]);
      } else if (line.trim()) {
        // 줄 번호가 없는 줄은 설명 텍스트로 분류
        descriptionLines.push(line.trim());
      }
    }

    const code = codeLines.join("\n");
    const description = descriptionLines.join(" ");

    // 코드 내용으로부터 언어 감지
    if (
      code.includes("import ") &&
      (code.includes("from ") || code.includes("require("))
    ) {
      if (
        code.includes("type ") ||
        code.includes("interface ") ||
        code.includes(": string") ||
        code.includes(": number")
      ) {
        detectedLanguage = "typescript";
      } else {
        detectedLanguage = "javascript";
      }
    } else if (
      (code.includes("use ") && code.includes("struct ")) ||
      code.includes("fn ") ||
      code.includes("let mut ")
    ) {
      detectedLanguage = "rust";
    } else if (code.includes("def ") && code.includes("import ")) {
      detectedLanguage = "python";
    } else if (code.includes("package ") && code.includes("public class ")) {
      detectedLanguage = "java";
    }

    return { code, language: detectedLanguage, description };
  };

  // 시스템 메시지를 렌더링하는 함수
  const renderSystemMessages = (
    messages: Array<{ type: string; content: string }>
  ) => {
    if (messages.length === 0) return null;

    return (
      <div className="mt-3 space-y-2">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={cn(
              COLORS.semantic.warning.bg,
              COLORS.semantic.warning.border
            )}
          >
            <div className="flex items-center space-x-2 mb-1">
              <AlertTriangle className={cn(COLORS.semantic.warning.icon)} />
              <span className={cn(COLORS.semantic.warning.text)}>
                {msg.type?.replace("-", " ") || "System Message"}
              </span>
            </div>
            <div className={cn(COLORS.semantic.warning.text)}>
              {msg.content}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // 파일 검색 결과인지 감지하는 함수
  const isFileSearchResult = (text: string): boolean => {
    if (typeof text !== "string") return false;

    const lines = text.trim().split("\n");
    if (lines.length < 2) return false;

    // "Found X files" 패턴이나 파일 경로들이 있는지 확인
    const hasFoundPattern = /^Found \d+ files?/i.test(lines[0] ?? "");
    const hasFilePaths = lines
      .slice(1)
      .some(
        (line) =>
          line.trim().length > 0 &&
          (line.includes("/") || line.includes("\\")) &&
          (line.includes(".ts") ||
            line.includes(".js") ||
            line.includes(".tsx") ||
            line.includes(".jsx") ||
            line.includes(".py") ||
            line.includes(".java") ||
            line.includes(".rs") ||
            line.includes(".go") ||
            line.includes(".php") ||
            line.includes(".rb") ||
            line.includes(".vue") ||
            line.includes(".svelte"))
      );

    return hasFoundPattern || (lines.length >= 3 && hasFilePaths);
  };

  // 파일 검색 결과를 렌더링하는 함수
  const renderFileSearchResult = (text: string) => {
    const lines = text.trim().split("\n");
    const headerLine = lines[0];
    const filePaths = lines.slice(1).filter((line) => line.trim().length > 0);

    return (
      <div className="space-y-2">
        {/* 헤더 */}
        <div
          className={cn(
            "flex items-center space-x-2 mb-1 p-2 rounded",
            COLORS.semantic.info.bg,
            COLORS.semantic.info.border
          )}
        >
          <Folder className={cn("w-4 h-4", COLORS.semantic.info.icon)} />
          <span className={cn(COLORS.semantic.info.text)}>{headerLine}</span>
        </div>

        {/* 파일 목록 */}
        <div className="space-y-1">
          {filePaths.map((filePath, idx) => {
            const pathParts = filePath.split("/");
            const lastPart = pathParts[pathParts.length - 1];
            const fileName: string = lastPart ? lastPart : filePath;
            const directory = filePath.substring(0, filePath.lastIndexOf("/"));

            return (
              <div
                key={idx}
                className={cn(
                  "flex items-center space-x-2 p-2 rounded",
                  COLORS.ui.background.primary,
                  COLORS.ui.border.medium
                )}
              >
                <File className={cn("w-4 h-4", COLORS.ui.text.muted)} />
                <div className="flex-1 min-w-0">
                  <div
                    className={cn(
                      "font-mono text-sm",
                      COLORS.ui.text.secondary
                    )}
                  >
                    {fileName}
                  </div>
                  {directory && (
                    <div
                      className={cn("font-mono text-xs", COLORS.ui.text.muted)}
                    >
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

  // content 처리
  // 줄 번호가 붙은 파일 내용 처리 (우선순위 높음)
  if (typeof content === "string" && isNumberedFileContent(content)) {
    const { codeContent, systemMessages } = separateSystemContent(content);
    const { code, language, description } =
      extractCodeFromNumberedLines(codeContent);

    return (
      <Renderer
        className={cn(
          COLORS.semantic.success.bg,
          COLORS.semantic.success.border
        )}
        hasError={isError}
      >
        <Renderer.Header
          title={t("toolResult.fileContent")}
          icon={
            <FileText className={cn("w-4 h-4", COLORS.semantic.success.icon)} />
          }
          titleClassName={cn(COLORS.semantic.success.text)}
          rightContent={
            <div className="flex items-center space-x-2">
              {renderCopyButton(code, `tool-result-code-${index}`, t("toolResult.copyCode"))}
              {toolUseId && (
                <code
                  className={cn(
                    "text-xs",
                    COLORS.ui.background.secondary,
                    COLORS.ui.text.secondary
                  )}
                >
                  {renderToolUseId(toolUseId as string)}
                </code>
              )}
            </div>
          }
        />
        <Renderer.Content>
          {/* 설명 텍스트 */}
          {description && (
            <div
              className={cn(
                COLORS.ui.background.secondary,
                COLORS.ui.border.medium
              )}
            >
              <div className={cn(COLORS.ui.text.secondary)}>{description}</div>
            </div>
          )}
          <div className="rounded-lg overflow-hidden">
            <div
              className={cn(
                COLORS.ui.background.secondary,
                COLORS.ui.border.medium
              )}
            >
              <span>{language}</span>
              <span className={cn(COLORS.ui.text.muted)}>
                {code.split("\n").length} {t("toolResult.lines")}
              </span>
            </div>
            <Highlight
              theme={themes.vsDark}
              code={code}
              language={language}
            >
              {({ className, style, tokens, getLineProps, getTokenProps }) => (
                <pre
                  className={className}
                  style={{
                    ...style,
                    margin: 0,
                    fontSize: "0.875rem",
                    lineHeight: "1.25rem",
                    maxHeight: "32rem",
                    overflow: "auto",
                    padding: "1rem",
                  }}
                >
                  {tokens.map((line, i) => (
                    <div key={i} {...getLineProps({ line })}>
                      <span
                        style={{
                          display: "inline-block",
                          width: "2em",
                          userSelect: "none",
                          opacity: 0.5,
                          marginRight: "1em",
                        }}
                      >
                        {i + 1}
                      </span>
                      {line.map((token, key) => (
                        <span key={key} {...getTokenProps({ token })} />
                      ))}
                    </div>
                  ))}
                </pre>
              )}
            </Highlight>
          </div>
          {/* 시스템 메시지들 렌더링 */}
          {renderSystemMessages(systemMessages)}
        </Renderer.Content>
      </Renderer>
    );
  }

  // 파일 검색 결과 처리 (줄 번호가 붙은 파일 내용 이후)
  if (typeof content === "string" && isFileSearchResult(content)) {
    const { codeContent: cleanContent, systemMessages } =
      separateSystemContent(content);

    return (
      <Renderer
        className={cn(
          COLORS.semantic.success.bg,
          COLORS.semantic.success.border
        )}
        hasError={isError}
      >
        <Renderer.Header
          title={t("toolResult.fileSearchResult")}
          icon={
            <Folder className={cn("w-4 h-4", COLORS.semantic.success.icon)} />
          }
          titleClassName={cn(COLORS.semantic.success.text)}
          rightContent={
            <div className="flex items-center space-x-2">
              {renderCopyButton(
                cleanContent,
                `file-search-result-${index}`,
                t("toolResult.copyResult")
              )}
              {toolUseId && (
                <code
                  className={cn(
                    "text-xs",
                    COLORS.ui.background.secondary,
                    COLORS.ui.text.secondary
                  )}
                >
                  {renderToolUseId(toolUseId as string)}
                </code>
              )}
            </div>
          }
        />
        <Renderer.Content>
          {renderFileSearchResult(cleanContent)}
          {renderSystemMessages(systemMessages)}
        </Renderer.Content>
      </Renderer>
    );
  }

  // 기본 처리 (기존 로직)
  return (
    <Renderer
      className={cn(COLORS.semantic.success.bg, COLORS.semantic.success.border)}
      hasError={isError}
    >
      <Renderer.Header
        title={t("toolResult.toolExecutionResult")}
        icon={<Check className={cn("w-4 h-4", COLORS.semantic.success.icon)} />}
        titleClassName={cn(COLORS.semantic.success.text)}
        rightContent={
          toolUseId && (
            <code
              className={cn(
                "text-xs",
                isError
                  ? COLORS.semantic.error.text
                  : COLORS.semantic.success.text
              )}
            >
              {renderToolUseId(toolUseId as string)}
            </code>
          )
        }
      />
      <Renderer.Content>
        <div className="text-sm">
          {typeof content === "string" ? (
            <div className="prose prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
              </ReactMarkdown>
            </div>
          ) : Array.isArray(content) ? (
            // 배열 내용을 처리
            <div className="space-y-2">
              {content.map((item: unknown, idx: number) => {
                if (item && typeof item === "object") {
                  const contentItem = item as Record<string, unknown>;

                  // text 타입 항목 처리
                  if (
                    contentItem.type === "text" &&
                    typeof contentItem.text === "string"
                  ) {
                    return (
                      <div key={idx} className="prose prose-sm max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {contentItem.text}
                        </ReactMarkdown>
                      </div>
                    );
                  }

                  // 기타 객체 항목 처리
                  return (
                    <pre
                      key={idx}
                      className={cn(
                        COLORS.ui.background.secondary,
                        COLORS.ui.border.medium
                      )}
                    >
                      {JSON.stringify(item, null, 2)}
                    </pre>
                  );
                }

                // 단순 값 처리
                return (
                  <div key={idx} className={cn(COLORS.ui.text.secondary)}>
                    {String(item)}
                  </div>
                );
              })}
            </div>
          ) : (
            <pre
              className={cn(
                COLORS.ui.background.secondary,
                COLORS.ui.border.medium
              )}
            >
              {JSON.stringify(content, null, 2)}
            </pre>
          )}
        </div>
      </Renderer.Content>
    </Renderer>
  );
};
