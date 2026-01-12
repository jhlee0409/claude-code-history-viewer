"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Highlight, themes } from "prism-react-renderer";
import { useCopyButton } from "../hooks/useCopyButton";
import { useTheme } from "@/contexts/theme";
import { useTranslation } from "react-i18next";
import { Renderer } from "../shared/RendererHeader";
import { cn } from "../utils/cn";
import { COLORS } from "../constants/colors";

export const FileContent = ({
  fileData,
  title,
}: {
  fileData: Record<string, unknown>;
  title: string;
}) => {
  const { t } = useTranslation("components");
  const { renderCopyButton } = useCopyButton();
  const { isDarkMode } = useTheme();
  const content = typeof fileData.content === "string" ? fileData.content : "";
  const filePath =
    typeof fileData.filePath === "string" ? fileData.filePath : "";
  const numLines =
    typeof fileData.numLines === "number" ? fileData.numLines : 0;
  const startLine =
    typeof fileData.startLine === "number" ? fileData.startLine : 1;
  const totalLines =
    typeof fileData.totalLines === "number" ? fileData.totalLines : 0;

  // 파일 확장자에 따른 언어 결정
  const getLanguageFromPath = (path: string) => {
    const ext = path.split(".").pop()?.toLowerCase();
    const fileName = path.split("/").pop()?.toLowerCase() || "";

    switch (ext) {
      case "rs":
        return "rust";
      case "ts":
        return "typescript";
      case "tsx":
        return "tsx"; // React TypeScript
      case "js":
        return "javascript";
      case "jsx":
        return "jsx"; // React JavaScript
      case "py":
        return "python";
      case "json":
        return "json";
      case "md":
      case "markdown":
        return "markdown";
      case "css":
        return "css";
      case "scss":
      case "sass":
        return "scss";
      case "html":
      case "htm":
        return "html";
      case "xml":
        return "xml";
      case "yaml":
      case "yml":
        return "yaml";
      case "mdx":
        return "markdown";
      case "sh":
      case "zsh":
      case "bash":
        return "bash";
      case "c":
        return "c";
      case "cpp":
      case "c++":
      case "cxx":
      case "cc":
        return "cpp";
      case "java":
        return "java";
      case "go":
        return "go";
      case "php":
        return "php";
      case "sql":
        return "sql";
      case "swift":
        return "swift";
      case "kotlin":
      case "kt":
        return "kotlin";
      case "scala":
        return "scala";
      case "rb":
        return "ruby";
      case "vue":
        return "vue";
      case "svelte":
        return "svelte";
      case "toml":
        return "toml";
      case "ini":
      case "conf":
      case "config":
        return "ini";
      case "dockerfile":
        return "dockerfile";
      case "txt":
      case "log":
        return "text";
      default:
        // 파일명으로 특수 케이스 처리
        if (fileName.includes("dockerfile")) return "dockerfile";
        if (fileName.includes("makefile")) return "makefile";
        if (fileName.includes("package.json")) return "json";
        if (fileName.includes("tsconfig")) return "json";
        if (fileName.includes("eslint")) return "json";
        return "text";
    }
  };

  const language = getLanguageFromPath(filePath);

  // Format path to show filename with up to 2 parent directories
  const formatShortPath = (path: string): string => {
    if (!path) return "";
    const parts = path.split('/').filter(Boolean);
    if (parts.length <= 3) return parts.join('/');
    return `…/${parts.slice(-3).join('/')}`;
  };

  // Format line info - simplified
  const formatLineInfo = (): string | null => {
    if (numLines <= 0 || totalLines <= 0) return null;
    const isPartial = startLine > 1 || numLines < totalLines;
    if (isPartial) {
      return `${startLine}-${startLine + numLines - 1} of ${totalLines}`;
    }
    return `${totalLines} lines`;
  };

  // 접기/펼치기 상태 관리
  const [isExpanded, setIsExpanded] = useState(false);
  const MAX_LINES = 20; // 최대 표시 줄 수
  const contentLines = content.split("\n");
  const shouldCollapse = contentLines.length > MAX_LINES;
  const displayContent =
    shouldCollapse && !isExpanded
      ? contentLines.slice(0, MAX_LINES).join("\n")
      : content;

  return (
    // <Renderer className="bg-blue-50 border-blue-200">
    <Renderer
      className={cn(COLORS.semantic.info.bg, COLORS.semantic.info.border)}
    >
      <Renderer.Header
        title={title}
        icon={<FileText className={cn("w-4 h-4", COLORS.semantic.info.icon)} />}
        titleClassName={cn(COLORS.semantic.info.text)}
        rightContent={
          <div className="flex items-center gap-2">
            <span className="text-xs text-blue-600 dark:text-blue-400 truncate max-w-[250px]" title={filePath}>
              {filePath && formatShortPath(filePath)}
              {formatLineInfo() && (
                <span className="ml-1.5">· {formatLineInfo()}</span>
              )}
            </span>
            {content &&
              renderCopyButton(
                content,
                `file-content-${filePath}`,
                t("fileContent.copyFileContent"),
                true
              )}
          </div>
        }
      />

      <Renderer.Content>
        {filePath && (
          <div className="mb-2">
            <div
              className={cn("text-xs font-medium", COLORS.semantic.info.text)}
            >
              {t("fileContent.filePath")}
            </div>
            <code
              className={cn(
                "text-sm bg-gray-100 px-2 py-1 rounded",
                COLORS.semantic.info.text
              )}
            >
              {filePath}
            </code>
          </div>
        )}

        {content && (
          <div className="mb-2">
            <div className="flex items-center justify-between mb-1">
              <div
                className={cn("text-xs font-medium", COLORS.semantic.info.text)}
              >
                {t("fileContent.content")}
              </div>
              {shouldCollapse && (
                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  className={cn(
                    "text-xs px-2 py-1 rounded transition-colors",
                    COLORS.semantic.info.bg,
                    COLORS.semantic.info.text
                  )}
                >
                  {isExpanded ? (
                    <>
                      <span>{t("fileContent.collapse")}</span>
                    </>
                  ) : (
                    <>
                      <span>
                        {t("fileContent.expand", {
                          count: contentLines.length,
                        })}
                      </span>
                    </>
                  )}
                </button>
              )}
            </div>
            <div className="rounded-lg overflow-hidden">
              <div
                className={cn(
                  "px-3 py-1 text-xs flex items-center justify-between",
                  COLORS.semantic.info.bg,
                  COLORS.semantic.info.text
                )}
              >
                <span>{language}</span>
                <div className="flex items-center space-x-2">
                  {startLine > 1 && (
                    <span className={cn(COLORS.semantic.info.text)}>
                      {t("fileContent.startLine", { line: startLine })}
                    </span>
                  )}
                  {shouldCollapse && !isExpanded && (
                    <span className={cn(COLORS.semantic.warning.text)}>
                      {t("fileContent.showingLines", {
                        current: MAX_LINES,
                        total: contentLines.length,
                      })}
                    </span>
                  )}
                </div>
              </div>
              {language === "markdown" ? (
                <div
                  className={cn(
                    "p-4 prose prose-sm max-w-none",
                    COLORS.semantic.info.bg,
                    COLORS.semantic.info.text
                  )}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {displayContent}
                  </ReactMarkdown>
                </div>
              ) : language === "text" ? (
                <div
                  className={cn(
                    "p-4",
                    COLORS.semantic.info.bg,
                    COLORS.semantic.info.text
                  )}
                >
                  <pre
                    className={cn(
                      "text-sm whitespace-pre-wrap font-mono",
                      COLORS.semantic.info.text
                    )}
                  >
                    {displayContent}
                  </pre>
                </div>
              ) : (
                <Highlight
                  theme={isDarkMode ? themes.vsDark : themes.vsLight}
                  code={displayContent}
                  language={
                    language === "tsx"
                      ? "typescript"
                      : language === "jsx"
                      ? "javascript"
                      : language
                  }
                >
                  {({
                    className,
                    style,
                    tokens,
                    getLineProps,
                    getTokenProps,
                  }) => (
                    <pre
                      className={className}
                      style={{
                        ...style,
                        margin: 0,
                        fontSize: "0.875rem",
                        lineHeight: "1.25rem",
                        maxHeight: "24rem",
                        overflow: "auto",
                        padding: "1rem",
                      }}
                    >
                      {tokens.map((line, i) => (
                        <div
                          key={i}
                          {...getLineProps({ line, key: i })}
                          style={{ display: "table-row" }}
                        >
                          <span
                            style={{
                              display: "table-cell",
                              textAlign: "right",
                              paddingRight: "1em",
                              userSelect: "none",
                              opacity: 0.5,
                            }}
                          >
                            {startLine + i}
                          </span>
                          <span style={{ display: "table-cell" }}>
                            {line.map((token, key) => (
                              <span
                                key={key}
                                {...getTokenProps({ token, key })}
                              />
                            ))}
                          </span>
                        </div>
                      ))}
                    </pre>
                  )}
                </Highlight>
              )}
              {shouldCollapse &&
                !isExpanded &&
                (language === "markdown" || language === "text") && (
                  <div
                    className={cn(
                      "px-4 py-3 border-t",
                      COLORS.semantic.info.bg,
                      COLORS.semantic.info.border
                    )}
                  >
                    <button
                      onClick={() => setIsExpanded(true)}
                      className={cn(
                        "text-xs font-medium transition-colors",
                        COLORS.semantic.info.text
                      )}
                    >
                      <FileText className="w-3 h-3 inline mr-1" />
                      {t("fileContent.showMoreLines", {
                        count: contentLines.length - MAX_LINES,
                      })}
                    </button>
                  </div>
                )}
              {shouldCollapse &&
                !isExpanded &&
                language !== "markdown" &&
                language !== "text" && (
                  <div
                    className={cn(
                      "px-3 py-2 border-t",
                      COLORS.semantic.info.bg,
                      COLORS.semantic.info.border
                    )}
                  >
                    <button
                      onClick={() => setIsExpanded(true)}
                      className={cn(
                        "text-xs transition-colors",
                        COLORS.semantic.info.text
                      )}
                    >
                      <FileText className="w-3 h-3 inline mr-1" />
                      {t("fileContent.showMoreLines", {
                        count: contentLines.length - MAX_LINES,
                      })}
                    </button>
                  </div>
                )}
            </div>
          </div>
        )}
      </Renderer.Content>
    </Renderer>
  );
};
