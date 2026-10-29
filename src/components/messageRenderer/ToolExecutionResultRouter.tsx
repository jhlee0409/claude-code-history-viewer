import { LegacyExecutionResult } from "../transcript/LegacyExecutionResult";
import React from "react";
import { useTranslation } from "react-i18next";
import {
  ClaudeSessionHistoryRenderer,
  CodebaseContextRenderer,
  ErrorRenderer,
  GitWorkflowRenderer,
  MCPRenderer,
  StringRenderer,
  StructuredPatchRenderer,
  TerminalStreamRenderer,
  TodoUpdateRenderer,
  WebSearchRenderer,
  FileEditRenderer,
  ContentArrayRenderer,
  FileListRenderer,
  FallbackRenderer,
  TaskResultRenderer,
} from "../toolResultRenderer";
import { FileContent } from "../FileContent";

interface ToolExecutionResultRouterProps {
  toolResult: Record<string, unknown> | string | unknown[];
  searchQuery?: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
}

export const ToolExecutionResultRouter: React.FC<
  ToolExecutionResultRouterProps
> = ({
  toolResult,
  searchQuery,
  isCurrentMatch = false,
  currentMatchIndex = 0,
}) => {
  const { t } = useTranslation();
  // Helper function to check if content is JSONL Claude session history
  const isClaudeSessionHistory = (content: string): boolean => {
    try {
      const lines = content
        .trim()
        .split("\n")
        .filter((line) => line.trim());

      // Need at least 2 lines to be considered chat history
      if (lines.length < 2) return false;

      let validChatMessages = 0;
      let totalValidJson = 0;

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          totalValidJson++;

          // Check if it looks like a Claude message
          if (
            parsed &&
            typeof parsed === "object" &&
            (parsed.type === "user" || parsed.type === "assistant") &&
            (parsed.message || parsed.content)
          ) {
            validChatMessages++;
          }
        } catch {
          // If we encounter non-JSON lines, it's probably not JSONL chat history
          return false;
        }
      }

      // Consider it chat history if:
      // 1. All lines are valid JSON
      // 2. At least 50% are valid chat messages
      // 3. Have at least 2 valid chat messages
      return (
        totalValidJson === lines.length &&
        validChatMessages >= 2 &&
        validChatMessages / totalValidJson >= 0.5
      );
    } catch {
      return false;
    }
  };

  // Handle array toolUseResult (e.g., [{type: "text", text: "..."}])
  if (Array.isArray(toolResult)) {
    return <ContentArrayRenderer toolResult={{ content: toolResult }} searchQuery={searchQuery} />;
  }

  // Handle string toolUseResult first (like file trees, directory listings, errors)
  if (typeof toolResult === "string") {
    // Check if it's an error message
    if (toolResult.startsWith("Error: ")) {
      return (
        <ErrorRenderer
          error={toolResult}
          searchQuery={searchQuery}
          isCurrentMatch={isCurrentMatch}
          currentMatchIndex={currentMatchIndex}
        />
      );
    }

    // Check if string content is JSONL Claude session history
    if (isClaudeSessionHistory(toolResult)) {
      return <ClaudeSessionHistoryRenderer content={toolResult} />;
    }

    return <StringRenderer result={toolResult} searchQuery={searchQuery} />;
  }

  // Handle Claude Code specific formats first

  // Handle MCP tool results
  if (
    (toolResult.type === "mcp_tool_call" || toolResult.server) &&
    (toolResult.method || toolResult.function)
  ) {
    return (
      <MCPRenderer
        mcpData={toolResult}
        searchQuery={searchQuery}
        isCurrentMatch={isCurrentMatch}
        currentMatchIndex={currentMatchIndex}
      />
    );
  }

  // Handle codebase context
  if (
    toolResult.type === "codebase_context" ||
    toolResult.files_analyzed !== undefined ||
    toolResult.filesAnalyzed !== undefined ||
    toolResult.context_window !== undefined ||
    toolResult.contextWindow !== undefined
  ) {
    return (
      <CodebaseContextRenderer
        contextData={toolResult}
        searchQuery={searchQuery}
        isCurrentMatch={isCurrentMatch}
        currentMatchIndex={currentMatchIndex}
      />
    );
  }

  // Handle terminal stream output
  if (
    toolResult.type === "terminal_stream" ||
    (toolResult.command &&
      toolResult.output &&
      (toolResult.stream || toolResult.stdout || toolResult.stderr))
  ) {
    return (
      <TerminalStreamRenderer
        command={toolResult.command as string}
        stream={toolResult.stream as string}
        output={toolResult.output as string}
        timestamp={toolResult.timestamp as string}
        exitCode={toolResult.exitCode as number}
        searchQuery={searchQuery}
        isCurrentMatch={isCurrentMatch}
        currentMatchIndex={currentMatchIndex}
      />
    );
  }

  // Handle Git workflow results. A bare `status` key is not Git evidence
  // (amendment 10, TR1b): no provider records a Git result that way, and it
  // sent Claude's async Agent completions ({agentId, status}) and BashOutput
  // results ({shellId, command, status, stdout}) to this card.
  if (
    toolResult.type === "git_workflow" ||
    (toolResult.command &&
      typeof toolResult.command === "string" &&
      (String(toolResult.command).startsWith("git ") ||
        toolResult.git_command)) ||
    toolResult.diff ||
    toolResult.commit
  ) {
    return (
      <GitWorkflowRenderer
        gitData={toolResult}
        searchQuery={searchQuery}
        isCurrentMatch={isCurrentMatch}
        currentMatchIndex={currentMatchIndex}
      />
    );
  }

  // Handle web search results
  if (
    toolResult.query &&
    typeof toolResult.query === "string" &&
    Array.isArray(toolResult.results) &&
    toolResult.results.length > 0
  ) {
    // Additional check: first result often starts with "I'll search"
    const firstResult = toolResult.results[0];
    if (
      typeof firstResult === "string" &&
      (firstResult.includes("I'll search") || firstResult.includes("search"))
    ) {
      return (
        <WebSearchRenderer
          searchData={toolResult}
          searchQuery={searchQuery}
          isCurrentMatch={isCurrentMatch}
          currentMatchIndex={currentMatchIndex}
        />
      );
    }
    // Even without "I'll search", if it has query + results structure, treat as web search
    return (
      <WebSearchRenderer
        searchData={toolResult}
        searchQuery={searchQuery}
        isCurrentMatch={isCurrentMatch}
        currentMatchIndex={currentMatchIndex}
      />
    );
  }

  // Handle todo updates
  if (toolResult.newTodos !== undefined || toolResult.oldTodos !== undefined) {
    return (
      <TodoUpdateRenderer
        todoData={toolResult}
        searchQuery={searchQuery}
        isCurrentMatch={isCurrentMatch}
        currentMatchIndex={currentMatchIndex}
      />
    );
  }

  // Handle task operation results: {task: {id, subject, ...}} or {tasks: [...]} or {success, taskId, ...}
  if (
    (toolResult.task != null && typeof toolResult.task === "object") ||
    (Array.isArray(toolResult.tasks) && toolResult.tasks.length > 0) ||
    (toolResult.success != null && typeof toolResult.taskId === "string")
  ) {
    return <TaskResultRenderer toolResult={toolResult} />;
  }

  // Handle file list results
  if (
    Array.isArray(toolResult.filenames) &&
    toolResult.filenames.length > 0 &&
    typeof toolResult.numFiles === "number"
  ) {
    return (
      <FileListRenderer
        toolResult={toolResult}
        searchQuery={searchQuery}
        isCurrentMatch={isCurrentMatch}
        currentMatchIndex={currentMatchIndex}
      />
    );
  }

  // Async agent task results are handled by MessageViewer's grouping logic
  // Return null here - ClaudeMessageNode handles rendering via agentTaskGroup prop
  // This includes both launch messages (isAsync: true) and completion messages (status: "completed")
  if (toolResult.agentId && typeof toolResult.agentId === "string") {
    // Launch message (isAsync: true) or completion message (status: "completed")
    if (toolResult.isAsync === true || toolResult.status === "completed") {
      return null;
    }
  }

  // Handle file object parsing
  if (toolResult.file && typeof toolResult.file === "object") {
    const fileData = toolResult.file as Record<string, unknown>;

    // Check if file content is JSONL Claude session history
    if (
      fileData.content &&
      typeof fileData.content === "string" &&
      isClaudeSessionHistory(fileData.content)
    ) {
      return <ClaudeSessionHistoryRenderer content={fileData.content} />;
    }

    return <FileContent fileData={fileData} title={t("toolResult.fileContent")} searchQuery={searchQuery} />;
  }

  // Handle file edit results
  if (
    toolResult.filePath &&
    typeof toolResult.filePath === "string" &&
    (toolResult.oldString || toolResult.newString || toolResult.originalFile)
  ) {
    return <FileEditRenderer toolResult={toolResult} searchQuery={searchQuery} />;
  }

  // Handle structured patch results
  if (
    toolResult.structuredPatch &&
    Array.isArray(toolResult.structuredPatch) &&
    toolResult.filePath &&
    typeof toolResult.filePath === "string"
  ) {
    return <StructuredPatchRenderer toolResult={toolResult} />;
  }

  // Handle direct content that might be JSONL Claude session history
  if (
    toolResult.content &&
    typeof toolResult.content === "string" &&
    isClaudeSessionHistory(toolResult.content)
  ) {
    return <ClaudeSessionHistoryRenderer content={toolResult.content} />;
  }

  // Handle content array with text objects (Claude API response)
  if (Array.isArray(toolResult.content) && toolResult.content.length > 0) {
    return <ContentArrayRenderer toolResult={toolResult} searchQuery={searchQuery} />;
  }

  // Handle direct content as string (non-chat history)
  if (
    toolResult.content &&
    typeof toolResult.content === "string" &&
    !toolResult.stdout &&
    !toolResult.stderr
  ) {
    return <StringRenderer result={toolResult.content} searchQuery={searchQuery} />;
  }

  // Unknown records stay JSON. Execution-shaped records use the shared adapter;
  // stderr alone never means failure and interrupted:false never means completed.
  if (!["stdout", "stderr", "interrupted", "isImage", "filePath", "exitCode", "exit_code", "return_code"].some(key => Object.hasOwn(toolResult, key))) {
    return <FallbackRenderer toolResult={toolResult} searchQuery={searchQuery} isCurrentMatch={isCurrentMatch} currentMatchIndex={currentMatchIndex} />;
  }
  return <LegacyExecutionResult record={toolResult} searchQuery={searchQuery} isCurrentMatch={isCurrentMatch} currentMatchIndex={currentMatchIndex} />;
};
