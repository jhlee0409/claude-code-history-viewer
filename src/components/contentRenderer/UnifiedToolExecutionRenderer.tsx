/**
 * UnifiedToolExecutionRenderer — tool_use + tool_result를 하나의 카드로 통합 렌더링
 *
 * 각 도구가 "동사 + 대상 + 결과"라는 스토리를 가지므로,
 * 도구별로 이 스토리를 가장 잘 전달하는 레이아웃을 사용한다.
 *
 * - Bash: command + description → stdout/stderr
 * - Read: file_path (range) → file content
 * - Edit: file_path + diff(old→new) → 성공/실패 메시지
 * - Write: file_path → 성공/실패 메시지
 * - Grep: pattern + path → search results
 * - Glob: pattern + path → file list
 * - Agent: subagent_type + description + prompt(md) → result(md)
 * - Default: primary field → result text
 */

import { memo } from "react";
import {
  BashCard,
  ReadCard,
  EditCard,
  WriteCard,
  GrepCard,
  GlobCard,
  WebSearchCard,
  WebFetchCard,
  AgentCard,
  WorkflowCard,
  AskUserQuestionCard,
  DefaultCard,
} from "./unifiedCards";
import type { Props } from "./unifiedCards";

export type { Props as UnifiedToolExecutionRendererProps };

/**
 * Canonical card for a tool name. Claude Code uses PascalCase names; other
 * providers (oh-my-pi, Codex, OpenCode, Gemini) emit lowercase or snake_case
 * variants for the same primitives. Only names whose input shape matches the
 * target card are aliased; everything else keeps the generic DefaultCard.
 */
const TOOL_ALIASES: Record<string, string> = {
  bash: "Bash",
  shell: "Bash",
  read: "Read",
  read_file: "Read",
  write: "Write",
  write_file: "Write",
  grep: "Grep",
  glob: "Glob",
  websearch: "WebSearch",
  web_search: "WebSearch",
  webfetch: "WebFetch",
  web_fetch: "WebFetch",
};

const canonicalToolName = (name: string): string =>
  TOOL_ALIASES[name.toLowerCase()] ?? name;

export const UnifiedToolExecutionRenderer = memo(function UnifiedToolExecutionRenderer({
  toolUse,
  toolResults,
  onViewSubagent,
  searchQuery,
  isCurrentMatch,
  currentMatchIndex,
}: Props) {
  const toolName = canonicalToolName((toolUse.name as string) || "");

  switch (toolName) {
    case "Bash":      return <BashCard toolUse={toolUse} toolResults={toolResults} />;
    case "Read":      return <ReadCard toolUse={toolUse} toolResults={toolResults} />;
    case "Edit":      return <EditCard toolUse={toolUse} toolResults={toolResults} />;
    case "Write":     return <WriteCard toolUse={toolUse} toolResults={toolResults} />;
    case "Grep":      return <GrepCard toolUse={toolUse} toolResults={toolResults} />;
    case "Glob":      return <GlobCard toolUse={toolUse} toolResults={toolResults} />;
    case "WebSearch": return <WebSearchCard toolUse={toolUse} toolResults={toolResults} />;
    case "WebFetch":  return <WebFetchCard toolUse={toolUse} toolResults={toolResults} />;
    case "Agent":     return <AgentCard toolUse={toolUse} toolResults={toolResults} onViewSubagent={onViewSubagent} />;
    case "Workflow":  return <WorkflowCard toolUse={toolUse} toolResults={toolResults} />;
    case "AskUserQuestion":
      return (
        <AskUserQuestionCard
          toolUse={toolUse}
          toolResults={toolResults}
          searchQuery={searchQuery}
          isCurrentMatch={isCurrentMatch}
          currentMatchIndex={currentMatchIndex}
        />
      );
    default:          return (
      <DefaultCard
        toolUse={toolUse}
        toolResults={toolResults}
        searchQuery={searchQuery}
        isCurrentMatch={isCurrentMatch}
        currentMatchIndex={currentMatchIndex}
      />
    );
  }
});
