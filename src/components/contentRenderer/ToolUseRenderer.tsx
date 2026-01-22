"use client";

/**
 * ToolUseRenderer - Renders Claude tool use content
 *
 * Handles different tool types:
 * - Write: File creation with syntax highlighting
 * - Edit: File modification (delegates to FileEditRenderer)
 * - Task: Assistant prompts with description/instructions
 * - Default: Generic tool input display
 */

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
import { cn } from "@/lib/utils";
import { FileEditRenderer } from "../toolResultRenderer/FileEditRenderer";
import { HighlightedText } from "../common";
import {
  type BaseRendererProps,
  getToolVariant,
  getVariantStyles,
  getLanguageFromPath,
  codeTheme,
  layout,
} from "../renderers";

interface ToolUseRendererProps extends BaseRendererProps {
  toolUse: Record<string, unknown>;
}

export const ToolUseRenderer = ({
  toolUse,
  searchQuery = "",
  isCurrentMatch = false,
  currentMatchIndex = 0,
}: ToolUseRendererProps) => {
  const { t } = useTranslation("components");

  const toolName = (toolUse.name as string) || "Unknown Tool";
  const toolId = (toolUse.id as string) || "";
  const toolInput = (toolUse.input as Record<string, unknown>) ?? {};

  // Get variant styles based on tool type
  const variant = getToolVariant(toolName);
  const styles = getVariantStyles(variant);

  // Tool ID with search highlighting
  const renderToolId = (id: string) => {
    if (!id) return null;
    return searchQuery ? (
      <HighlightedText
        text={`ID: ${id}`}
        searchQuery={searchQuery}
        isCurrentMatch={isCurrentMatch}
        currentMatchIndex={currentMatchIndex}
      />
    ) : (
      <>ID: {id}</>
    );
  };

  // Helper to check if toolInput is a non-null object
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

  // Check tool types
  const isWriteTool =
    toolName === "Write" ||
    (isObject(toolInput) && "file_path" in toolInput && "content" in toolInput);

  const isEditTool =
    toolName === "Edit" ||
    (isObject(toolInput) &&
      "file_path" in toolInput &&
      "old_string" in toolInput &&
      "new_string" in toolInput);

  const isAssistantPrompt =
    isObject(toolInput) &&
    "description" in toolInput &&
    "prompt" in toolInput &&
    typeof toolInput.description === "string" &&
    typeof toolInput.prompt === "string";

  // === Write Tool Renderer ===
  if (isWriteTool) {
    const filePath = typeof toolInput.file_path === "string" ? toolInput.file_path : "";
    const content = typeof toolInput.content === "string" ? toolInput.content : "";
    const language = getLanguageFromPath(filePath);
    const writeStyles = getVariantStyles("success");

    return (
      <Renderer className={writeStyles.container}>
        <Renderer.Header
          title={t("toolUseRenderer.fileCreation")}
          icon={<FilePlus className={cn(layout.iconSize, writeStyles.icon)} />}
          titleClassName={writeStyles.title}
          rightContent={
            toolId && (
              <code
                className={cn(
                  layout.monoText,
                  "px-2 py-1",
                  layout.rounded,
                  writeStyles.badge,
                  writeStyles.badgeText
                )}
              >
                {renderToolId(toolId)}
              </code>
            )
          }
        />
        <Renderer.Content>
          {/* File path */}
          <div className={cn("mb-3 p-2 border bg-info/10 border-info/30", layout.rounded)}>
            <div className={cn("flex items-center", layout.iconSpacing)}>
              <FileText className={cn(layout.iconSizeSmall, "text-info")} />
              <code className={cn(layout.bodyText, "font-mono text-info")}>{filePath}</code>
            </div>
          </div>

          {/* File content */}
          <div>
            <div className={cn(layout.titleText, "mb-2 flex items-center space-x-1 text-success")}>
              <CheckCircle className={layout.iconSize} />
              <span>{t("toolUseRenderer.createdContent")}</span>
            </div>
            <div className={cn(layout.rounded, "overflow-hidden", layout.contentMaxHeight, "overflow-y-auto")}>
              <Highlight
                theme={themes.vsDark}
                code={content}
                language={language}
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
                      fontSize: codeTheme.fontSize,
                      padding: codeTheme.padding,
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

  // === Edit Tool Renderer ===
  if (isEditTool) {
    const filePath = typeof toolInput.file_path === "string" ? toolInput.file_path : "";
    const oldString = typeof toolInput.old_string === "string" ? toolInput.old_string : "";
    const newString = typeof toolInput.new_string === "string" ? toolInput.new_string : "";
    const replaceAll = (toolInput.replace_all as boolean) || false;

    return (
      <FileEditRenderer
        toolResult={{
          filePath,
          oldString,
          newString,
          replaceAll,
          originalFile: "",
          userModified: false,
        }}
      />
    );
  }

  // === Assistant Prompt Renderer ===
  if (isAssistantPrompt) {
    const promptInput = toolInput as { description: string; prompt: string };
    const infoStyles = getVariantStyles("info");

    return (
      <Renderer className={infoStyles.container}>
        <Renderer.Header
          title={t("toolUseRenderer.task")}
          icon={<MessageSquare className={cn(layout.iconSize, infoStyles.icon)} />}
          titleClassName={cn("font-bold", infoStyles.title)}
          rightContent={
            toolId && (
              <div className={cn("flex items-center", layout.iconSpacing, layout.bodyText)}>
                <Hash className={cn(layout.iconSizeSmall, infoStyles.icon)} />
                <span className={cn("font-mono", infoStyles.accent)}>
                  {renderToolId(toolId)}
                </span>
              </div>
            )
          }
        />
        <Renderer.Content>
          <div className="mb-4">
            <div className={cn(layout.bodyText, "font-semibold mb-2 text-foreground")}>
              {t("toolUseRenderer.taskDescription")}
            </div>
            <div className={cn(layout.containerPadding, layout.rounded, "bg-info/20 border border-info/30 text-foreground")}>
              {promptInput.description}
            </div>
          </div>

          <div>
            <div className={cn(layout.bodyText, "font-semibold mb-2 text-foreground")}>
              {t("toolUseRenderer.detailedInstructions")}
            </div>
            <div className={cn(layout.containerPadding, layout.rounded, "bg-info/20 border border-info/30 text-foreground")}>
              <div className={cn("whitespace-pre-wrap", layout.bodyText, "leading-relaxed")}>
                {promptInput.prompt}
              </div>
            </div>
          </div>
        </Renderer.Content>
      </Renderer>
    );
  }

  // === Default Tool Renderer ===
  return (
    <Renderer className={styles.container}>
      <Renderer.Header
        title={toolName}
        icon={<ToolIcon toolName={toolName} className={styles.icon} />}
        titleClassName="text-foreground"
        rightContent={
          toolId && (
            <code
              className={cn(
                layout.monoText,
                "px-2 py-1",
                layout.rounded,
                styles.badge,
                styles.badgeText
              )}
            >
              {renderToolId(toolId)}
            </code>
          )
        }
      />

      <Renderer.Content>
        <div className={cn(layout.rounded, "overflow-hidden", layout.contentMaxHeight, "overflow-y-auto")}>
          <div className={cn("px-3 py-1", layout.smallText, "bg-card text-muted-foreground border-b border-border")}>
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
                  fontSize: codeTheme.fontSize,
                  padding: codeTheme.padding,
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
