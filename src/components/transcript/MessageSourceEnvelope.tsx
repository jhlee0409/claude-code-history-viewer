import type { MessageNodeProps } from "../MessageViewer/types";
import { MessageContentDisplay, ClaudeToolUseDisplay, ToolExecutionResultRouter } from "../messageRenderer";
import { CodexUnassignedFileChanges } from "./CodexFileChanges";
import { extractClaudeMessageContent } from "@/utils/messageUtils";
import { legacyOwnership } from "./sourceEnvelope";
import { useAppStore } from "@/store/useAppStore";

type Props = Pick<MessageNodeProps, "message" | "searchQuery" | "isCurrentMatch" | "currentMatchIndex">;
export function MessageSourcePrefix({ message, searchQuery, isCurrentMatch, currentMatchIndex }: Props) {
  const messageFilter = useAppStore(s => s.messageFilter);
  return <>
              {(message.type !== "assistant" ||
                messageFilter.contentTypes.text) && (
                <MessageContentDisplay
                  content={extractClaudeMessageContent(message)}
                  messageType={message.type}
                  searchQuery={searchQuery}
                  isCurrentMatch={isCurrentMatch}
                  currentMatchIndex={currentMatchIndex}
                />
              )}
  </>;
}
export function MessageSourceExtras({ message, searchQuery, isCurrentMatch, currentMatchIndex }: Props) {
  const messageFilter = useAppStore(s => s.messageFilter);
  const ownership = legacyOwnership(message);
  return <>
              <CodexUnassignedFileChanges message={message} />

              {messageFilter.contentTypes.toolCalls &&
                message.type === "assistant" &&
                message.toolUse && ownership.call && <ClaudeToolUseDisplay toolUse={message.toolUse} />}

              {(message.type !== "assistant" ||
                messageFilter.contentTypes.toolCalls) &&
                ownership.result && (
                  <ToolExecutionResultRouter
                    toolResult={ownership.value!}
                    searchQuery={searchQuery}
                    isCurrentMatch={isCurrentMatch}
                    currentMatchIndex={currentMatchIndex}
                  />
                )}
  </>;
}
