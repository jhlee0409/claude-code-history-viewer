import { memo, useMemo } from "react";
import { Brain } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";

type Props = {
  text?: string;
  content?: string;
};

// Escape HTML tags outside of code blocks to prevent ReactMarkdown from stripping them
function escapeHtmlOutsideCode(text: string): string {
  // Split by code blocks (``` and `) to preserve code content
  const parts: string[] = [];
  let remaining = text;

  // Handle fenced code blocks first
  const fencedRegex = /(```[\s\S]*?```)/g;
  let lastIndex = 0;
  let match;

  while ((match = fencedRegex.exec(text)) !== null) {
    // Text before code block - escape HTML
    const before = text.slice(lastIndex, match.index);
    parts.push(escapeHtmlInText(before));
    // Code block - keep as is
    parts.push(match[1]);
    lastIndex = match.index + match[1].length;
  }

  if (lastIndex < text.length) {
    remaining = text.slice(lastIndex);
  } else {
    return parts.join('');
  }

  // Handle inline code in remaining text
  const inlineResult = escapeHtmlPreservingInlineCode(remaining);
  parts.push(inlineResult);

  return parts.join('');
}

function escapeHtmlInText(text: string): string {
  // Only escape < and > that look like HTML tags (not operators like < or >)
  return text.replace(/<([a-zA-Z/][^>]*)>/g, '&lt;$1&gt;');
}

function escapeHtmlPreservingInlineCode(text: string): string {
  // Split by inline code backticks
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, i) => {
    // Odd indices are code spans (preserved), even indices are regular text (escape HTML)
    if (i % 2 === 1) {
      return part; // Keep code as-is
    }
    return escapeHtmlInText(part);
  }).join('');
}

function ThinkingRendererComponent({ text, content }: Props) {
  const { t } = useTranslation('components');
  const textContent = text || content || "";

  // Memoize the escaped content
  const escapedContent = useMemo(() => {
    if (!textContent) return "";
    return escapeHtmlOutsideCode(textContent);
  }, [textContent]);

  if (!textContent) return null;

  // Check for <thinking> tags (legacy/inline format) - check on original, not escaped
  const thinkingRegex = /<thinking>(.*?)<\/thinking>/gs;
  const matches = textContent.match(thinkingRegex);
  const withoutThinking = textContent.replace(thinkingRegex, "").trim();

  // If no <thinking> tags found, treat entire content as thinking (from type: "thinking" content blocks)
  const hasThinkingTags = matches && matches.length > 0;

  if (!hasThinkingTags && textContent.trim()) {
    // Render as pure thinking content block (no tags needed)
    return (
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
        <div className="flex items-center space-x-2 mb-2">
          <Brain className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <span className="text-xs font-medium text-amber-800 dark:text-amber-200">
            {t('thinkingRenderer.title')}
          </span>
        </div>
        <div className="text-sm text-amber-700 dark:text-amber-300 italic prose prose-sm max-w-none prose-amber dark:prose-invert prose-p:my-1 prose-code:text-amber-800 dark:prose-code:text-amber-200 prose-code:bg-amber-100 dark:prose-code:bg-amber-900/50 prose-pre:bg-amber-100 dark:prose-pre:bg-amber-900/50">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {escapedContent}
          </ReactMarkdown>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {matches &&
        matches.map((match, idx) => {
          const thinkingContent = match.replace(/<\/?thinking>/g, "").trim();
          const escapedThinking = escapeHtmlOutsideCode(thinkingContent);
          return (
            <div
              key={idx}
              className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3"
            >
              <div className="flex items-center space-x-2 mb-2">
                <Brain className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span className="text-xs font-medium text-amber-800 dark:text-amber-200">
                  {t('thinkingRenderer.title')}
                </span>
              </div>
              <div className="text-sm text-amber-700 dark:text-amber-300 italic prose prose-sm max-w-none prose-amber dark:prose-invert prose-p:my-1 prose-code:text-amber-800 dark:prose-code:text-amber-200 prose-code:bg-amber-100 dark:prose-code:bg-amber-900/50 prose-pre:bg-amber-100 dark:prose-pre:bg-amber-900/50">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {escapedThinking}
                </ReactMarkdown>
              </div>
            </div>
          );
        })}

      {withoutThinking && (
        <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-gray-900 dark:prose-headings:text-gray-100 prose-p:text-gray-700 dark:prose-p:text-gray-300 prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-code:text-red-600 dark:prose-code:text-red-400 prose-code:bg-gray-100 dark:prose-code:bg-gray-800">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {escapeHtmlOutsideCode(withoutThinking)}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

export const ThinkingRenderer = memo(ThinkingRendererComponent);
