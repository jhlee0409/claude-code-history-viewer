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
  DefaultCard,
} from "./unifiedCards";
import type { Props } from "./unifiedCards";

export type { Props as UnifiedToolExecutionRendererProps };

export const UnifiedToolExecutionRenderer = memo(function UnifiedToolExecutionRenderer({
  toolUse,
  toolResults,
  onViewSubagent,
}: Props) {
  const toolName = (toolUse.name as string) || "";

  switch (toolName) {
    case "Bash":      return <BashCard toolUse={toolUse} toolResults={toolResults} />;
    case "Read":      return <ReadCard toolUse={toolUse} toolResults={toolResults} />;
    case "Edit":
    case "MultiEdit": return <EditCard toolUse={toolUse} toolResults={toolResults} />;
    case "Write":     return <WriteCard toolUse={toolUse} toolResults={toolResults} />;
    case "Grep":      return <GrepCard toolUse={toolUse} toolResults={toolResults} />;
    case "Glob":      return <GlobCard toolUse={toolUse} toolResults={toolResults} />;
    case "WebSearch":
    case "web_search":return <WebSearchCard toolUse={toolUse} toolResults={toolResults} />;
    case "WebFetch":  return <WebFetchCard toolUse={toolUse} toolResults={toolResults} />;
    case "Agent":
    case "Task":      return <AgentCard toolUse={toolUse} toolResults={toolResults} onViewSubagent={onViewSubagent} />;
    default:          return <DefaultCard toolUse={toolUse} toolResults={toolResults} />;
  }
});
