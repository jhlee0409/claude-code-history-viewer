/**
 * The session laid out as the API requests Claude Code sent
 * (`load_session_api_view`, src-tauri/src/commands/session/api_view).
 */

export interface ApiView {
  /** False when requests were inferred from responses (pre-2.1.301 transcripts). */
  recorded: boolean;
  line_count: number;
  shapes: ApiShape[];
  requests: ApiRequest[];
  /** Lines tied to no request, in file order. */
  unattributed: SourceLine[];
}

export interface ApiShape {
  hash: string;
  line: number;
  shape: unknown;
}

export interface ApiRequest {
  id: string;
  line: number | null;
  timestamp: string | null;
  query_source: string | null;
  shape_hash: string | null;
  base: string | null;
  params: unknown;
  cache_control: unknown;
  keep: number;
  total_messages: number;
  new_messages: ApiMessage[];
  response: ApiResponse | null;
  inputs: SourceLine[];
}

export type MessageSource =
  | { kind: "blob"; line: number }
  | { kind: "lines"; lines: number[] }
  | { kind: "unresolved"; hash: string };

export interface ApiMessage {
  index: number;
  role: string;
  content: unknown;
  source: MessageSource;
}

export interface ApiResponse {
  request_id: string | null;
  message_ids: string[];
  lines: number[];
  uuids: string[];
  timestamp: string | null;
  model: string | null;
  stop_reason: string | null;
  usage: unknown;
  content: unknown[];
}

export interface SourceLine {
  line: number;
  uuid: string | null;
  kind: string;
  label: string | null;
  timestamp: string | null;
  /** Short text for a one-line summary. */
  preview: string;
  /** Everything the line says: a message content, attachment text, or the record. */
  content: unknown;
  /** `content` is the whole record: the line put no text into the context. */
  record: boolean;
  /** The tool call the line answers (tool result) or ran around (hook). */
  tool_use_id: string | null;
  /** Whether the line's text appears in the request; null when unchecked. */
  in_request: boolean | null;
  /** Index of the message the line's text was found in. */
  found_in: number | null;
}
