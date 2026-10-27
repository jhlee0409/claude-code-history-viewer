import { createContext, useContext } from "react";
import type { ApiView } from "@/types/apiView.types";

/** Where a request sits: its id and its number in the view. */
export interface RequestRef {
  requestId: string;
  number: number;
}

export interface ToolUseRef extends RequestRef {
  name: string;
}

export interface ToolResultRef extends RequestRef {
  line: number;
}

/** Cross references between requests, built once per view. */
export interface ApiLinks {
  /** tool_use id → the request whose response made the call. */
  toolUses: ReadonlyMap<string, ToolUseRef>;
  /** tool_use id → the request the result was sent in. */
  toolResults: ReadonlyMap<string, ToolResultRef>;
  /** First line of a response → the request it answers. */
  responses: ReadonlyMap<number, RequestRef>;
}

export const anchors = {
  request: (requestId: string) => `api-req-${requestId}`,
  message: (requestId: string, index: number) => `api-msg-${requestId}-${index}`,
  toolUse: (toolUseId: string) => `api-tool-${toolUseId}`,
  line: (requestId: string, line: number) => `api-line-${requestId}-${line}`,
};

function blocks(content: unknown): Record<string, unknown>[] {
  return Array.isArray(content) ? content.filter((b): b is Record<string, unknown> => b != null && typeof b === "object") : [];
}

export function buildLinks(view: ApiView): ApiLinks {
  const toolUses = new Map<string, ToolUseRef>();
  const toolResults = new Map<string, ToolResultRef>();
  const responses = new Map<number, RequestRef>();
  view.requests.forEach((request, i) => {
    const ref = { requestId: request.id, number: i + 1 };
    const response = request.response;
    if (response) {
      if (response.lines[0] != null) responses.set(response.lines[0], ref);
      for (const block of blocks(response.content)) {
        if (block.type === "tool_use" && typeof block.id === "string") {
          toolUses.set(block.id, { ...ref, name: String(block.name ?? "?") });
        }
      }
    }
    for (const input of request.inputs) {
      if (input.kind === "user:tool_result" && input.tool_use_id) {
        toolResults.set(input.tool_use_id, { ...ref, line: input.line });
      }
    }
  });
  return { toolUses, toolResults, responses };
}

export interface ApiNavigation {
  links: ApiLinks;
  /** Expand `requestId`, scroll to the element `anchor` and flash it. */
  reveal: (requestId: string, anchor: string) => void;
}

export const ApiNavContext = createContext<ApiNavigation | null>(null);

/** Cross references and navigation; `null` outside the API view. */
export function useApiNav(): ApiNavigation | null {
  return useContext(ApiNavContext);
}
