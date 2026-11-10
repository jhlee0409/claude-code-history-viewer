import type { ClaudeMessage } from "@/types";
import type { FlattenedMessageItem } from "../MessageViewer/types";
import { isEmptyMessage } from "../MessageViewer/helpers/messageHelpers";
import { sourceRoute } from "./sourceEnvelope";
import type { MessageFilterContentTypes } from "@/store/slices/filterSlice";
import { contentEntryVisible, messageContentVisibility } from "../contentRenderer/contentVisibility";
import { legacyOwnership } from "./sourceEnvelope";
import type { TranscriptBlock } from "./transcriptItems";

/** Project only display entries. Never filter/reindex the source content array.
 * First text stays here: its bubble is rendered by the once-only source prefix.
 */
export function visibleTranscriptBlocks(blocks: readonly TranscriptBlock[], contentTypes?: MessageFilterContentTypes): readonly TranscriptBlock[] {
  const visible = blocks.filter(block => block.render.kind === "source" || contentEntryVisible(block.render.entry, {
    ...messageContentVisibility(block.source.message, contentTypes),
    skipToolResults: legacyOwnership(block.source.message).result,
  }));
  // Content entries can all disappear while source-owned FileChange/legacy
  // output still exists. Keep one source envelope, never resurrect hidden calls.
  if (visible.length === 0 && blocks.length > 0) {
    const first = blocks[0]!;
    const message = first.source.message;
    const legacy = legacyOwnership(message);
    const toolsVisible = message.type !== "assistant" || contentTypes?.toolCalls !== false;
    const extras = (message.provider === "codex" && !!message.codexEvidence?.fileChanges?.length)
      || (toolsVisible && (legacy.call || legacy.result));
    if (extras) return [{ ...first, kind: "fallback", foldable: false, outcome: undefined, file: undefined, sourceBlockIds: [first.id], render: { kind: "source", route: "default" } }];
  }
  return visible.map((block, position) => {
    if (block.render.kind === "source") return block;
    const first = position === 0, last = position === visible.length - 1;
    return block.render.first === first && block.render.last === last ? block : { ...block, render: { ...block.render, first, last } };
  });
}

/** The message renderer's early-return policy, shared with the data projection. */
export function sourceVisibility(message: ClaudeMessage, inSubagent: boolean, member: boolean): "visible" | "member" | "hidden" {
  if (message.isSidechain && !inSubagent) return "hidden";
  if (member) return "member";
  if (isEmptyMessage(message)) return "hidden";
  return "visible";
}

export function rowVisibility(row: FlattenedMessageItem, inSubagent = false) {
  if (sourceRoute(row) === "snapshot" && row.message.type === "file-history-snapshot" && !row.message.snapshot) return "hidden";
  return sourceVisibility(row.message, inSubagent, row.isGroupMember || row.isProgressGroupMember || row.isTaskOperationGroupMember);
}
