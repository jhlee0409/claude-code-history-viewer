import { memo } from "react";
import { messageContentVisibility } from "../contentRenderer/contentVisibility";
import { ContentEntryRenderer, type ContentEntryOptions } from "../contentRenderer/ContentEntryRenderer";
import { ClaudeMessageNode } from "../MessageViewer/components/ClaudeMessageNode";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { ResultProviderContext, useResultProvider } from "./resultProvider";
import { extractClaudeMessageContent } from "@/utils/messageUtils";
import { useAppStore } from "@/store/useAppStore";
import { legacyOwnership } from "./sourceEnvelope";
import { MessageSourcePrefix, MessageSourceExtras } from "./MessageSourceEnvelope";
import type { TranscriptBlock } from "./transcriptItems";
import type { MessageNodeProps } from "../MessageViewer/types";

/** Body bridge only. The current production virtualizer remains message-based.
 * A dedicated source envelope owns one whole special-message surface; array
 * entries own only their original entry plus the once-only prefix/suffix.
 */
export const TranscriptBlockRenderer = memo(({ block, ...options }: { block: TranscriptBlock } & ContentEntryOptions & Pick<MessageNodeProps, "isMatch">) => {
  const messageFilter = useAppStore(s => s.messageFilter);
  const inheritedProvider = useResultProvider();
  const { source, render } = block;
  const { message } = source;
  if (render.kind === "source") return <ClaudeMessageNode
    {...options} message={message} depth={source.depth}
    agentTaskGroup={source.agentTaskGroup} isAgentTaskGroupMember={source.isGroupMember}
    agentProgressGroup={source.agentProgressGroup} isAgentProgressGroupMember={source.isProgressGroupMember}
    taskOperationGroup={source.taskOperationGroup} isTaskOperationGroupMember={source.isTaskOperationGroupMember}
    taskRegistry={source.taskRegistry} hideHeader={source.isContinuation}
  />;
  const content = Array.isArray(message.content) ? message.content : [];
  const firstTextIndex = content.findIndex(item => item !== null && typeof item === "object" && item.type === "text");

  return <ResultProviderContext.Provider value={message.provider ?? inheritedProvider}>
    <ExpandKeyProvider value={message.uuid}>
      {render.first && <MessageSourcePrefix message={message} {...options} />}
      <ContentEntryRenderer {...options} provider={message.provider} entry={render.entry}
        firstTextIndex={firstTextIndex} skipFirstText={!!extractClaudeMessageContent(message)}
        skipToolResults={legacyOwnership(message).result}
        {...messageContentVisibility(message, messageFilter.contentTypes)} />
      {render.last && <MessageSourceExtras message={message} {...options} />}
    </ExpandKeyProvider>
  </ResultProviderContext.Provider>;
});
TranscriptBlockRenderer.displayName = "TranscriptBlockRenderer";
