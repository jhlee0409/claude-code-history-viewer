"use client";

import { Highlight, themes } from "prism-react-renderer";
import { useTranslation } from "react-i18next";
import {
  FileText,
  MessageSquare,
  Hash,
  CheckCircle,
  FilePlus,
} from "lucide-react";
import { ToolIcon } from "../ToolIcon";
import { Renderer } from "../../shared/RendererHeader";
import { cn } from "../../utils/cn";
import { COLORS } from "../../constants/colors";
import { FileEditRenderer } from "../toolResultRenderer/FileEditRenderer";
import { HighlightedText } from "../common";

type Props = {
  toolUse: Record<string, unknown>;
  searchQuery?: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number; // 메시지 내에서 현재 활성화된 매치 인덱스
};

export const ToolUseRenderer = ({
  toolUse,
  searchQuery = "",
  isCurrentMatch = false,
  currentMatchIndex = 0,
}: Props) => {
  const { t } = useTranslation("components");
  const toolName = toolUse.name || "Unknown Tool";
  const toolId = toolUse.id || "";
  const toolInput = toolUse.input || {};

  // Tool ID 렌더링 헬퍼 (검색 하이라이팅 지원)
  const renderToolId = (id: string) => {
    if (!id) return null;
    const idString = String(id);
    return searchQuery ? (
      <HighlightedText
        text={`ID: ${idString}`}
        searchQuery={searchQuery}
        isCurrentMatch={isCurrentMatch}
        currentMatchIndex={currentMatchIndex}
      />
    ) : (
      <>ID: {idString}</>
    );
  };

  // 파일 확장자로 언어 감지 - Write 도구에서만 사용
  const getLanguageFromPath = (path: string): string => {
    const ext = path.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "ts":
        return "typescript";
      case "tsx":
        return "typescript";
      case "js":
        return "javascript";
      case "jsx":
        return "javascript";
      case "py":
        return "python";
      case "java":
        return "java";
      case "rs":
        return "rust";
      case "go":
        return "go";
      case "php":
        return "php";
      case "rb":
        return "ruby";
      default:
        return "text";
    }
  };

  // Claude Assistant 프롬프트 형태인지 확인
  const isAssistantPrompt = (input: unknown): boolean => {
    if (typeof input !== "object" || input === null) return false;
    const obj = input as Record<string, unknown>;
    return (
      "description" in obj &&
      "prompt" in obj &&
      typeof obj.description === "string" &&
      typeof obj.prompt === "string"
    );
  };

  // Write 도구인지 확인
  const isWriteTool =
    toolName === "Write" ||
    (typeof toolInput === "object" &&
      toolInput !== null &&
      "file_path" in toolInput &&
      "content" in toolInput);

  // Edit 도구인지 확인
  const isEditTool =
    toolName === "Edit" ||
    (typeof toolInput === "object" &&
      toolInput !== null &&
      "file_path" in toolInput &&
      "old_string" in toolInput &&
      "new_string" in toolInput);

  // Write 도구 전용 렌더링
  if (isWriteTool && typeof toolInput === "object" && toolInput !== null) {
    const writeToolInput = toolInput as Record<string, unknown>;
    const filePath = (writeToolInput.file_path as string) || "";
    const content = (writeToolInput.content as string) || "";
    const language = getLanguageFromPath(filePath);

    return (
      <Renderer
        className={cn(COLORS.semantic.success.bg, COLORS.semantic.success.border)}
      >
        <Renderer.Header
          title={t("toolUseRenderer.fileCreation")}
          icon={<FilePlus className={cn("w-4 h-4", COLORS.semantic.success.icon)} />}
          titleClassName={COLORS.semantic.success.text}
          rightContent={
            toolId && (
              <code
                className={cn(
                  "text-xs px-2 py-1 rounded",
                  "bg-green-100 dark:bg-green-900/30",
                  COLORS.semantic.success.text
                )}
              >
                {renderToolId(toolId as string)}
              </code>
            )
          }
        />
        <Renderer.Content>
          {/* 파일 경로 */}
          <div
            className={cn(
              "mb-3 p-2 rounded border",
              "bg-blue-50 dark:bg-blue-900/20",
              "border-blue-200 dark:border-blue-800"
            )}
          >
            <div className="flex items-center space-x-2">
              <FileText className={cn("w-3 h-3", COLORS.semantic.info.icon)} />
              <code
                className={cn("text-sm font-mono", COLORS.semantic.info.text)}
              >
                {filePath}
              </code>
            </div>
          </div>

          {/* 파일 내용 */}
          <div>
            <div
              className={cn(
                "text-xs font-medium mb-2 flex items-center space-x-1",
                COLORS.semantic.success.text
              )}
            >
              <CheckCircle
                className={cn("w-4 h-4", COLORS.semantic.success.icon)}
              />
              <span>{t("toolUseRenderer.createdContent")}</span>
            </div>
            <div
              className={cn(
                "rounded overflow-hidden max-h-96 overflow-y-auto"
              )}
            >
              <Highlight
                theme={themes.vsDark}
                code={content}
                language={language}
              >
                {({ className, style, tokens, getLineProps, getTokenProps }) => (
                  <pre
                    className={className}
                    style={{
                      ...style,
                      margin: 0,
                      fontSize: "0.75rem",
                      padding: "0.5rem",
                    }}
                  >
                    {tokens.map((line, i) => (
                      <div key={i} {...getLineProps({ line })}>
                        {line.map((token, j) => (
                          <span key={j} {...getTokenProps({ token })} />
                        ))}
                      </div>
                    ))}
                  </pre>
                )}
              </Highlight>
            </div>
          </div>
        </Renderer.Content>
      </Renderer>
    );
  }

  // Claude Assistant 프롬프트 전용 렌더링
  if (isAssistantPrompt(toolInput)) {
    const promptInput = toolInput as { description: string; prompt: string };

    return (
      <Renderer
        className={cn(COLORS.semantic.info.bg, COLORS.semantic.info.border)}
      >
        <Renderer.Header
          title={t("toolUseRenderer.task")}
          icon={<MessageSquare className={cn("w-4 h-4", COLORS.semantic.info.icon)} />}
          titleClassName={cn("font-bold", COLORS.semantic.info.text)}
          rightContent={
            toolId && (
              <div
                className={cn(
                  "flex items-center space-x-2 text-sm",
                  COLORS.semantic.info.text
                )}
              >
                <Hash className={cn("w-3 h-3", COLORS.semantic.info.icon)} />
                <span className={cn("font-mono", COLORS.semantic.info.text)}>
                  {renderToolId(toolId as string)}
                </span>
              </div>
            )
          }
        />
        <Renderer.Content>
          <div className="mb-4">
            <div
              className={cn(
                "text-sm font-semibold mb-2",
                COLORS.semantic.info.text
              )}
            >
              {t("toolUseRenderer.taskDescription")}
            </div>
            <div
              className={cn(
                "p-3 rounded-lg",
                "bg-blue-100/50 dark:bg-blue-900/30",
                "border border-blue-200 dark:border-blue-800",
                COLORS.semantic.info.text
              )}
            >
              {promptInput.description}
            </div>
          </div>

          {/* 프롬프트 섹션 */}
          <div>
            <div
              className={cn(
                "text-sm font-semibold mb-2",
                COLORS.semantic.info.text
              )}
            >
              {t("toolUseRenderer.detailedInstructions")}
            </div>
            <div
              className={cn(
                "p-3 rounded-lg",
                "bg-blue-100/50 dark:bg-blue-900/30",
                "border border-blue-200 dark:border-blue-800",
                COLORS.semantic.info.text
              )}
            >
              <div
                className={cn(
                  "whitespace-pre-wrap text-sm leading-relaxed",
                  COLORS.semantic.info.text
                )}
              >
                {promptInput.prompt}
              </div>
            </div>
          </div>
        </Renderer.Content>
      </Renderer>
    );
  }

  // Edit 도구 전용 렌더링 - FileEditRenderer 사용
  if (isEditTool && typeof toolInput === "object" && toolInput !== null) {
    const editToolInput = toolInput as Record<string, unknown>;
    const filePath = (editToolInput.file_path as string) || "";
    const oldString = (editToolInput.old_string as string) || "";
    const newString = (editToolInput.new_string as string) || "";
    const replaceAll = (editToolInput.replace_all as boolean) || false;

    // FileEditRenderer가 기대하는 형식으로 데이터 변환
    const toolResult = {
      filePath,
      oldString,
      newString,
      replaceAll,
      originalFile: "", // 원본 파일 내용은 tool use에서는 제공되지 않음
      userModified: false, // tool use 단계에서는 아직 사용자 수정이 없음
    };

    return <FileEditRenderer toolResult={toolResult} />;
  }

  // 기본 도구 렌더링
  return (
    <Renderer
      className={cn(COLORS.semantic.info.bg, COLORS.semantic.info.border)}
    >
      <Renderer.Header
        title={toolName as string}
        icon={
          <ToolIcon
            toolName={toolName as string}
            className={COLORS.semantic.info.icon}
          />
        }
        titleClassName={cn(COLORS.semantic.info.text)}
        rightContent={
          toolId && (
            <code
              className={cn(
                "text-xs px-2 py-1 rounded",
                COLORS.semantic.info.bg,
                COLORS.semantic.info.text
              )}
            >
              {renderToolId(toolId as string)}
            </code>
          )
        }
      />

      <Renderer.Content>
        <div className="rounded overflow-hidden max-h-96 overflow-y-auto">
          <div
            className={cn(
              "px-3 py-1 text-xs",
              COLORS.ui.background.dark,
              COLORS.ui.text.inverse
            )}
          >
            {t("toolUseRenderer.toolInputParameters")}
          </div>
          <Highlight
            theme={themes.vsDark}
            code={JSON.stringify(toolInput, null, 2)}
            language="json"
          >
            {({ className, style, tokens, getLineProps, getTokenProps }) => (
              <pre
                className={className}
                style={{
                  ...style,
                  margin: 0,
                  fontSize: "0.75rem",
                  padding: "0.5rem",
                }}
              >
                {tokens.map((line, i) => (
                  <div key={i} {...getLineProps({ line })}>
                    {line.map((token, j) => (
                      <span key={j} {...getTokenProps({ token })} />
                    ))}
                  </div>
                ))}
              </pre>
            )}
          </Highlight>
        </div>
      </Renderer.Content>
    </Renderer>
  );
};
