/**
 * Markdown Exporter
 *
 * Converts ClaudeMessage[] to a clean Markdown string.
 */

import type { ClaudeMessage } from "@/types";
import { extractBlocks, filterBlocksByContentType, isExportable, type ExtractedBlock, type ExportOptions } from "./contentExtractor";
import type { MessageFilterContentTypes } from "@/store/slices/filterSlice";
import { localDayKey, localTimeOfDay } from "@/lib/format/localDay";
import { formatCount } from "@/lib/format/number";

/** Exports are language-neutral: local `YYYY-MM-DD` and 24-hour `HH:MM:SS`. */
function formatTimestamp(timestamp: string): { date: string; time: string } {
  return {
    date: localDayKey(timestamp) ?? timestamp,
    time: localTimeOfDay(timestamp) ?? timestamp,
  };
}

function blockToMarkdown(block: ExtractedBlock): string {
  switch (block.kind) {
    case "thinking":
      return `<details>\n<summary>Thinking</summary>\n\n${block.text}\n\n</details>`;
    case "tool":
      return `> **Tool:** \`${block.text}\``;
    case "result":
      return `> ${block.text}`;
    case "code":
      return `\`\`\`\n${block.text}\n\`\`\``;
    case "media":
    case "search":
      return `*${block.text}*`;
    case "text":
    default:
      return block.text;
  }
}

export function exportToMarkdown(messages: ClaudeMessage[], sessionName: string, contentTypeFilter?: MessageFilterContentTypes, options?: ExportOptions): string {
  const filtered = messages.filter((m) => isExportable(m, options));

  const firstTimestamp = filtered[0]?.timestamp;
  const lastTimestamp = filtered[filtered.length - 1]?.timestamp;
  const start = firstTimestamp ? formatTimestamp(firstTimestamp) : null;
  const end = lastTimestamp ? formatTimestamp(lastTimestamp) : null;
  const dateRange = start
    ? end && end.date !== start.date
      ? `${start.date} ${start.time} ~ ${end.date} ${end.time}`
      : `${start.date}${end ? ` ~ ${end.time}` : ""}`
    : "";
  const userCount = filtered.filter((m) => m.type === "user").length;
  const assistantCount = filtered.filter((m) => m.type === "assistant").length;

  const lines: string[] = [
    `# Session: ${sessionName}`,
    "",
    `- **Date**: ${dateRange}`,
    `- **Messages**: ${userCount} user / ${assistantCount} assistant`,
    "",
  ];

  for (const msg of filtered) {
    lines.push("---", "");

    const role = msg.type === "user" ? "User" : "Assistant";
    const time = formatTimestamp(msg.timestamp).time;
    const model = msg.type === "assistant" && "model" in msg && msg.model
      ? ` (${msg.model})`
      : "";
    lines.push(`**${role}** ${time}${model}`, "");

    let blocks = extractBlocks(msg.content);
    if (contentTypeFilter && msg.type === "assistant") blocks = filterBlocksByContentType(blocks, contentTypeFilter);
    for (const block of blocks) {
      lines.push(blockToMarkdown(block), "");
    }

    // Token usage for assistant
    if (msg.type === "assistant" && "usage" in msg && msg.usage) {
      const u = msg.usage;
      const parts: string[] = [];
      if (u.input_tokens != null) parts.push(`in: ${formatCount(u.input_tokens, "en")}`);
      if (u.output_tokens != null) parts.push(`out: ${formatCount(u.output_tokens, "en")}`);
      if (parts.length > 0) {
        const cost = "costUSD" in msg && msg.costUSD != null
          ? ` · $${msg.costUSD.toFixed(4)}`
          : "";
        lines.push(`*Tokens: ${parts.join(" / ")}${cost}*`, "");
      }
    }
  }

  lines.push("---", "");
  return lines.join("\n");
}
