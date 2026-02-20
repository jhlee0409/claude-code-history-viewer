"use client";

import { memo } from "react";

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
import { useTheme } from "@/contexts/theme";
import { FileEditRenderer } from "../toolResultRenderer/FileEditRenderer";
import { HighlightedText } from "../common";
import { MCPToolUseRenderer } from "./MCPToolUseRenderer";
import { getToolVariant } from "@/utils/toolIconUtils";
import {
  type BaseRendererProps,
  getVariantStyles,
  getLanguageFromPath,
  codeTheme,
  layout,
} from "../renderers";
import { getPreStyles, getLineStyles, getTokenStyles } from "@/utils/prismStyles";
import {
  ReadToolRenderer,
  BashToolRenderer,
  GlobToolRenderer,
  GrepToolRenderer,
  WebFetchToolRenderer,
  WebSearchToolRenderer,
  MultiEditToolRenderer,
  TodoWriteToolRenderer,
  NotebookEditToolRenderer,
  TaskCreateToolRenderer,
  TaskUpdateToolRenderer,
  TaskOutputToolRenderer,
  TaskToolRenderer,
  ApplyPatchToolRenderer,
  UpdatePlanToolRenderer,
} from "./toolUseRenderers";

interface ToolUseRendererProps extends BaseRendererProps {
  toolUse: Record<string, unknown>;
}

export const ToolUseRenderer = memo(function ToolUseRenderer({
  toolUse,
  searchQuery = "",
  isCurrentMatch = false,
  currentMatchIndex = 0,
}: ToolUseRendererProps) {
  const { t } = useTranslation();
  const { isDarkMode } = useTheme();

  const toolName = (toolUse.name as string) || "Unknown Tool";
  const toolId = (toolUse.id as string) || "";
  const toolInput = (toolUse.input as Record<string, unknown>) ?? {};

  const parseMcpTool = (name: string) => {
    if (!name.startsWith("mcp__")) {
      return null;
    }
    const rest = name.slice(5);
    const separatorIndex = rest.indexOf("__");
    if (separatorIndex < 0) {
      return { serverName: "mcp", toolName: rest };
    }
    return {
      serverName: rest.slice(0, separatorIndex),
      toolName: rest.slice(separatorIndex + 2),
    };
  };

  // Get variant styles based on tool type
  const variant = getToolVariant(toolName);
  const styles = getVariantStyles(variant);

  // Tool ID with search highlighting
  const renderToolId = (id: string) => {
    if (!id) return null;
    const label = `${t("common.id")}: ${id}`;
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

  // === Named Tool Renderers ===
  switch (toolName) {
    case "Read":
      return <ReadToolRenderer toolId={toolId} input={toolInput} />;
    case "Bash":
      return <BashToolRenderer toolId={toolId} input={toolInput} />;
    case "Glob":
      return <GlobToolRenderer toolId={toolId} input={toolInput} />;
    case "Grep":
      return <GrepToolRenderer toolId={toolId} input={toolInput} />;
    case "WebFetch":
      return <WebFetchToolRenderer toolId={toolId} input={toolInput} />;
    case "WebSearch":
      return <WebSearchToolRenderer toolId={toolId} input={toolInput} />;
    case "MultiEdit":
      return <MultiEditToolRenderer toolId={toolId} input={toolInput} />;
    case "TodoWrite":
      return <TodoWriteToolRenderer toolId={toolId} input={toolInput} />;
    case "NotebookEdit":
      return <NotebookEditToolRenderer toolId={toolId} input={toolInput} />;
    case "TaskCreate":
      return <TaskCreateToolRenderer toolId={toolId} input={toolInput} />;
    case "TaskUpdate":
      return <TaskUpdateToolRenderer toolId={toolId} input={toolInput} />;
    case "TaskOutput":
      return <TaskOutputToolRenderer toolId={toolId} input={toolInput} />;
    case "Task":
      return <TaskToolRenderer toolId={toolId} input={toolInput} />;
    case "apply_patch":
      return <ApplyPatchToolRenderer toolId={toolId} input={toolInput} />;
    case "update_plan":
      return <UpdatePlanToolRenderer toolId={toolId} input={toolInput} />;
  }

  const mcpTool = parseMcpTool(toolName);
  if (mcpTool) {
    return (
      <MCPToolUseRenderer
        id={toolId}
        serverName={mcpTool.serverName}
        toolName={mcpTool.toolName}
        input={toolInput}
      />
    );
  }

  // Helper to check if toolInput is a non-null object
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

  // Check tool types (fallback for input-shape detection)
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
            <div className={cn(layout.rounded, "overflow-auto", layout.contentMaxHeight)}>
              <Highlight
                theme={isDarkMode ? themes.vsDark : themes.vsLight}
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
                    style={getPreStyles(isDarkMode, style, {
                      fontSize: codeTheme.fontSize,
                      padding: codeTheme.padding,
                    })}
                  >
                    {tokens.map((line, i) => {
                      const lineProps = getLineProps({ line });
                      return (
                        <div key={i} {...lineProps} style={getLineStyles(lineProps.style)}>
                          {line.map((token, j) => {
                            const tokenProps = getTokenProps({ token });
                            return (
                              <span
                                key={j}
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
        <div className={cn(layout.titleText, "mb-2 text-muted-foreground")}>
          {t("toolUseRenderer.toolInputParameters")}
        </div>
        <div className={cn(layout.rounded, "overflow-auto", layout.contentMaxHeight)}>
          <Highlight
            theme={isDarkMode ? themes.vsDark : themes.vsLight}
            code={JSON.stringify(toolInput, null, 2)}
            language="json"
          >
            {({ className, style, tokens, getLineProps, getTokenProps }) => (
              <pre
                className={className}
                style={getPreStyles(isDarkMode, style, {
                  fontSize: codeTheme.fontSize,
                  padding: codeTheme.padding,
                })}
              >
                {tokens.map((line, i) => {
                  const lineProps = getLineProps({ line });
                  return (
                    <div key={i} {...lineProps} style={getLineStyles(lineProps.style)}>
                      {line.map((token, j) => {
                        const tokenProps = getTokenProps({ token });
                        return (
                          <span
                            key={j}
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
      </Renderer.Content>
    </Renderer>
  );
});
