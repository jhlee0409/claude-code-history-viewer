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
 * - Workflow: name + description + script → result, the run's agents
 * - AskUserQuestion: questions + options → answer
 * - Default: the D-R1 name → body table (toolBodies.tsx), else honest JSON
 *
 * Every card is a ToolRow (TR0, TR1a) whose outcome comes from toolOutcome.
 */

import { memo, useMemo } from "react";
import { resultSearchText } from "../transcript/resultSearchText";
import { ResultSearchContext, useResultProvider } from "../transcript/resultProvider";
import { searchHits } from "./unifiedCards/shared";
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
import { canonicalToolName } from "./toolNames";

export type { Props as UnifiedToolExecutionRendererProps };

export const UnifiedToolExecutionRenderer = memo(function UnifiedToolExecutionRenderer(props: Props) {
  const provider = useResultProvider();
  const active = provider !== undefined && provider !== "claude";
  const query = props.searchQuery?.trim() ?? "";
  const hit = useMemo(() => active && query !== "" && searchHits(query, resultSearchText(props.toolUse), resultSearchText(props.toolResults)), [active, query, props.toolUse, props.toolResults]);
  return <ResultSearchContext.Provider value={active ? { searchQuery: props.searchQuery, revealFor: hit ? props.searchQuery : undefined, isCurrentMatch: props.isCurrentMatch, currentMatchIndex: props.currentMatchIndex } : {}}><CardDispatcher {...props} /></ResultSearchContext.Provider>;
});

function CardDispatcher({
  toolUse,
  toolResults,
  onViewSubagent,
  searchQuery,
  isCurrentMatch,
  currentMatchIndex,
}: Props) {
  // The canonical card for the recorded name (provider aliases: ./toolNames).
  const toolName = canonicalToolName((toolUse.name as string) || "");

  switch (toolName) {
    case "Bash":      return <BashCard toolUse={toolUse} toolResults={toolResults} searchQuery={searchQuery} isCurrentMatch={isCurrentMatch} currentMatchIndex={currentMatchIndex} />;
    case "Read":      return <ReadCard toolUse={toolUse} toolResults={toolResults} />;
    case "Edit":
    case "MultiEdit": return <EditCard toolUse={toolUse} toolResults={toolResults} />;
    case "Write":     return <WriteCard toolUse={toolUse} toolResults={toolResults} />;
    case "Grep":      return <GrepCard toolUse={toolUse} toolResults={toolResults} />;
    case "Glob":      return <GlobCard toolUse={toolUse} toolResults={toolResults} />;
    case "WebSearch": return <WebSearchCard toolUse={toolUse} toolResults={toolResults} />;
    case "WebFetch":  return <WebFetchCard toolUse={toolUse} toolResults={toolResults} />;
    case "Agent":
    case "Task":      return <AgentCard toolUse={toolUse} toolResults={toolResults} onViewSubagent={onViewSubagent} />;
    case "Workflow":
      return (
        <WorkflowCard
          toolUse={toolUse}
          toolResults={toolResults}
          searchQuery={searchQuery}
          isCurrentMatch={isCurrentMatch}
          currentMatchIndex={currentMatchIndex}
        />
      );
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
}
