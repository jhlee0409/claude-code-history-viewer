/**
 * HTML Exporter
 *
 * Converts ClaudeMessage[] to a standalone HTML string with inline styles.
 */

import { Marked } from "marked";
import type { ClaudeMessage } from "@/types";
import { extractBlocks, filterBlocksByContentType, isExportable, type ExtractedBlock } from "./contentExtractor";
import type { MessageFilterContentTypes } from "@/store/slices/filterSlice";

const CSS = `
body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; background: #fff; color: #1a1a1a; line-height: 1.6; }
h1 { border-bottom: 2px solid #e5e5e5; padding-bottom: 0.5rem; }
.meta { color: #6b7280; font-size: 0.85em; margin-bottom: 1.5rem; }
.meta span { margin-right: 1.5rem; }
.message { border-bottom: 1px solid #e5e5e5; padding: 1rem 0; }
.role { font-weight: 700; }
.role.user { color: #2563eb; }
.role.assistant { color: #059669; }
.model { color: #9ca3af; font-size: 0.8em; margin-left: 0.5rem; }
.timestamp { color: #9ca3af; font-size: 0.85em; margin-left: 0.5rem; }
.content { margin-top: 0.5rem; word-wrap: break-word; }
.content h1, .content h2, .content h3, .content h4, .content h5, .content h6 { margin: 0.75rem 0 0.25rem; font-size: 1.1em; }
.content h1 { font-size: 1.3em; } .content h2 { font-size: 1.15em; }
.content p { margin: 0.4rem 0; }
.content ul, .content ol { margin: 0.4rem 0; padding-left: 1.5rem; }
.content li { margin: 0.15rem 0; }
.content code { background: #f3f4f6; padding: 0.15rem 0.35rem; border-radius: 3px; font-size: 0.9em; }
.content pre { background: #1e1e1e; color: #d4d4d4; padding: 1rem; border-radius: 6px; overflow-x: auto; margin: 0.5rem 0; }
.content pre code { background: none; padding: 0; color: inherit; }
.content blockquote { margin: 0.5rem 0; padding: 0.5rem 1rem; border-left: 3px solid #d1d5db; background: #f9fafb; color: #4b5563; }
.content blockquote p { margin: 0.2rem 0; }
.content a { color: #2563eb; text-decoration: underline; }
.content hr { border: none; border-top: 1px solid #e5e5e5; margin: 0.75rem 0; }
.content img { max-width: 100%; height: auto; border-radius: 4px; margin: 0.5rem 0; }
.content table { width: 100%; border-collapse: collapse; margin: 0.5rem 0; font-size: 0.9em; }
.content th, .content td { border: 1px solid #d1d5db; padding: 0.4rem 0.75rem; text-align: left; }
.content th { background: #f3f4f6; font-weight: 600; }
.content tr:nth-child(even) { background: #f9fafb; }
.tool { background: #f3f4f6; border-left: 3px solid #6366f1; padding: 0.5rem 0.75rem; margin: 0.5rem 0; font-size: 0.9em; font-family: ui-monospace, SFMono-Regular, monospace; }
.result { background: #f0fdf4; border-left: 3px solid #22c55e; padding: 0.5rem 0.75rem; margin: 0.5rem 0; font-size: 0.9em; white-space: pre-wrap; }
.thinking { color: #6b7280; font-style: italic; }
.code-block { background: #1e1e1e; color: #d4d4d4; padding: 1rem; border-radius: 4px; overflow-x: auto; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.9em; margin: 0.5rem 0; white-space: pre-wrap; }
.search { color: #6366f1; font-size: 0.9em; }
.media { color: #9ca3af; font-style: italic; }
.usage { color: #9ca3af; font-size: 0.8em; margin-top: 0.5rem; }
pre { background: #f5f5f5; padding: 1rem; border-radius: 4px; overflow-x: auto; }
code { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.9em; }
details { margin: 0.5rem 0; }
summary { cursor: pointer; color: #6b7280; font-style: italic; }
@media print { body { max-width: 100%; padding: 1rem; } .message { page-break-inside: avoid; } }
`.trim();

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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

function isSafeUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  return /^(https?:|mailto:|#|\/)/i.test(trimmed);
}

// XSS prevention strategy (no DOMPurify needed):
// 1. renderer.html() escapes all raw HTML tokens
// 2. renderer.link()/image() reject non-http/mailto protocols via isSafeUrl()
// 3. All non-text blocks use escapeHtml() before insertion
// Input is trusted conversation data, not user-submitted HTML.
const safeMarked = new Marked({ breaks: true });
safeMarked.use({
  renderer: {
    html({ text }: { text: string }) {
      return escapeHtml(text);
    },
    link({ href, text }: { href: string; text: string }) {
      if (!isSafeUrl(href)) return escapeHtml(text);
      return `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
    },
    image({ href, text }: { href: string; text: string }) {
      if (!isSafeUrl(href)) return escapeHtml(text ?? "");
      return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text ?? "")}" />`;
    },
  },
});

function renderMarkdown(text: string): string {
  return safeMarked.parse(text, { async: false }) as string;
}

function blockToHtml(block: ExtractedBlock): string {
  const escaped = escapeHtml(block.text);
  switch (block.kind) {
    case "thinking":
      return `<details><summary class="thinking">Thinking</summary><p class="thinking">${escaped}</p></details>`;
    case "tool":
      return `<div class="tool">${escaped}</div>`;
    case "result":
      return `<div class="result">${escaped}</div>`;
    case "code":
      return `<div class="code-block">${escaped}</div>`;
    case "search":
      return `<p class="search">${escaped}</p>`;
    case "media":
      return `<p class="media">${escaped}</p>`;
    case "text":
      return renderMarkdown(block.text);
    default:
      return escaped;
  }
}

export function exportToHtml(messages: ClaudeMessage[], sessionName: string, contentTypeFilter?: MessageFilterContentTypes): string {
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

  const messageBlocks = filtered.map((msg) => {
    const role = msg.type === "user" ? "user" : "assistant";
    const roleLabel = msg.type === "user" ? "User" : "Assistant";
    const time = formatTimestamp(msg.timestamp).time;
    const model = msg.type === "assistant" && "model" in msg && msg.model
      ? `<span class="model">${escapeHtml(msg.model)}</span>`
      : "";

    let blocks = extractBlocks(msg.content);
    if (contentTypeFilter && msg.type === "assistant") blocks = filterBlocksByContentType(blocks, contentTypeFilter);
    const contentHtml = blocks.map(blockToHtml).join("\n");

    // Token usage
    let usageHtml = "";
    if (msg.type === "assistant" && "usage" in msg && msg.usage) {
      const u = msg.usage;
      const parts: string[] = [];
      if (u.input_tokens != null) parts.push(`in: ${u.input_tokens.toLocaleString()}`);
      if (u.output_tokens != null) parts.push(`out: ${u.output_tokens.toLocaleString()}`);
      if (parts.length > 0) {
        const cost = "costUSD" in msg && msg.costUSD != null
          ? ` · $${msg.costUSD.toFixed(4)}`
          : "";
        usageHtml = `<div class="usage">Tokens: ${parts.join(" / ")}${cost}</div>`;
      }
    }

    return `<div class="message">
<span class="role ${role}">${roleLabel}</span>${model}
<span class="timestamp">${time}</span>
<div class="content">${contentHtml}</div>
${usageHtml}
</div>`;
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Session: ${escapeHtml(sessionName)}</title>
<style>${CSS}</style>
</head>
<body>
<h1>Session: ${escapeHtml(sessionName)}</h1>
<div class="meta">
<span>${escapeHtml(dateRange)}</span>
<span>${userCount} user / ${assistantCount} assistant messages</span>
</div>
${messageBlocks.join("\n")}
</body>
</html>`;
}
