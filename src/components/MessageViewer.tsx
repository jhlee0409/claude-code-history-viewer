/**
 * MessageViewer Re-export
 *
 * This file re-exports from the MessageViewer module for backward compatibility.
 * The actual implementation is in the MessageViewer/ folder.
 */

export { MessageViewer } from "./MessageViewer/MessageViewer";
export type {
  MessageViewerProps,
  MessageNodeProps,
  MessageHeaderProps,
  SummaryMessageProps,
  AgentProgressEntry,
  AgentProgressGroup,
} from "./MessageViewer/types";
