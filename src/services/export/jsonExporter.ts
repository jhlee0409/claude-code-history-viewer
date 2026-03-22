/**
 * JSON Exporter
 *
 * Converts ClaudeMessage[] to a structured JSON string.
 */

import type { ClaudeMessage } from "@/types";
import { extractBlocks, filterBlocksByContentType, blocksToPlainText, isExportable } from "./contentExtractor";
import type { MessageFilterContentTypes } from "@/store/slices/filterSlice";

interface ExportedMessage {
  role: "user" | "assistant";
  timestamp: string;
  content: string;
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  costUSD?: number;
}


export function exportToJson(messages: ClaudeMessage[], sessionName: string, contentTypeFilter?: MessageFilterContentTypes): string {
  const filtered = messages.filter(isExportable);

  const exportedMessages: ExportedMessage[] = filtered.map((msg) => {
    const base: ExportedMessage = {
      role: msg.type === "user" ? "user" : "assistant",
      timestamp: msg.timestamp,
      content: blocksToPlainText(
        contentTypeFilter && msg.type === "assistant"
          ? filterBlocksByContentType(extractBlocks(msg.content), contentTypeFilter)
          : extractBlocks(msg.content)
      ),
    };

    if (msg.type === "assistant") {
      if ("model" in msg && msg.model) base.model = msg.model;
      if ("usage" in msg && msg.usage) {
        base.usage = {
          input_tokens: msg.usage.input_tokens,
          output_tokens: msg.usage.output_tokens,
        };
      }
      if ("costUSD" in msg && msg.costUSD != null) base.costUSD = msg.costUSD;
    }

    return base;
  });

  const firstTs = filtered[0]?.timestamp;
  const lastTs = filtered[filtered.length - 1]?.timestamp;

  const result = {
    session: sessionName,
    exportedAt: new Date().toISOString(),
    dateRange: firstTs && lastTs ? { start: firstTs, end: lastTs } : undefined,
    messageCount: {
      total: filtered.length,
      user: filtered.filter((m) => m.type === "user").length,
      assistant: filtered.filter((m) => m.type === "assistant").length,
    },
    messages: exportedMessages,
  };

  return JSON.stringify(result, null, 2);
}
