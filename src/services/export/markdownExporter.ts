/**
 * Markdown Exporter
 *
 * Converts ClaudeMessage[] to a clean Markdown string.
 */

import type { ClaudeMessage } from "@/types";
import { extractBlocks, filterBlocksByContentType, isExportable, type ExtractedBlock } from "./contentExtractor";
import type { MessageFilterContentTypes } from "@/store/slices/filterSlice";

function formatTimestamp(timestamp: string): { date: string; time: string } {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return { date: timestamp, time: timestamp };
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return {
    date: `${y}-${m}-${day}`,
    time: d.toLocaleTimeString("en-US", { hour12: false }),
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

export function exportToMarkdown(messages: ClaudeMessage[], sessionName: string, contentTypeFilter?: MessageFilterContentTypes): string {
  const filtered = messages.filter(isExportable);

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
      if (u.input_tokens != null) parts.push(`in: ${u.input_tokens.toLocaleString()}`);
      if (u.output_tokens != null) parts.push(`out: ${u.output_tokens.toLocaleString()}`);
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
