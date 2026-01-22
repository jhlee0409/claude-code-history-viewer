import { MessageCircle, User, Bot, Wrench, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import { formatTime } from "../../utils/time";
import { layout } from "@/components/renderers";
import { cn } from "@/lib/utils";

type Props = {
  content: string;
};

export const ClaudeSessionHistoryRenderer = ({ content }: Props) => {
  const { t } = useTranslation('components');
  try {
    // Split by lines and filter out empty lines
    const lines = content.split("\n").filter((line) => line.trim());
    const parsedMessages: Record<string, unknown>[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        parsedMessages.push(parsed);
      } catch {
        // Skip invalid JSON lines
        continue;
      }
    }

    // Filter out summary messages and keep only user/assistant messages
    const chatMessages = parsedMessages.filter(
      (msg) => msg.type === "user" || msg.type === "assistant"
    );

    if (chatMessages.length === 0) {
      return (
        <div className={cn("mt-2 border", layout.containerPadding, layout.rounded, "bg-gray-50 border-gray-200")}>
          <div className={cn("flex items-center mb-2", layout.iconSpacing)}>
            <MessageCircle className={layout.iconSize} />
            <span className={cn(layout.titleText, "text-gray-800")}>{t('claudeSessionHistoryRenderer.title')}</span>
          </div>
          <p className={cn(layout.bodyText, "text-gray-600")}>
            {t('claudeSessionHistoryRenderer.noValidMessages')}
          </p>
        </div>
      );
    }

    return (
      <div className={cn("mt-2 border", layout.containerPadding, layout.rounded, "bg-purple-50 border-purple-200")}>
        <div className={cn("flex items-center mb-3", layout.iconSpacing)}>
          <MessageCircle className={layout.iconSize} />
          <span className={cn(layout.titleText, "text-purple-800")}>
            {t('claudeSessionHistoryRenderer.messageCount', { count: chatMessages.length })}
          </span>
        </div>
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {chatMessages.map((msg, index) => (
            <div
              key={index}
              className={cn(layout.containerPadding, layout.rounded, msg.type === "user"
                  ? "bg-blue-100 border-l-4 border-blue-400"
                  : "bg-green-100 border-l-4 border-green-400"
              )}
            >
              <div className={cn("flex items-center mb-2", layout.iconSpacing)}>
                {msg.type === "user" ? (
                  <User className={layout.iconSize} />
                ) : (
                  <Bot className={layout.iconSize} />
                )}
                <span className={cn(layout.titleText)}>
                  {msg.type === "user" ? t('claudeSessionHistoryRenderer.user') : t('claudeSessionHistoryRenderer.claude')}
                </span>
                {typeof msg.timestamp === "string" && (
                  <span className={cn(layout.smallText, "text-gray-500")}>
                    {formatTime(msg.timestamp)}
                  </span>
                )}
              </div>
              <div className={layout.bodyText}>
                {typeof msg.message === "object" &&
                msg.message !== null &&
                "content" in msg.message ? (
                  typeof msg.message.content === "string" ? (
                    <div className="prose prose-sm max-w-none prose-gray">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.message.content}
                      </ReactMarkdown>
                    </div>
                  ) : Array.isArray(msg.message.content) ? (
                    <div className="space-y-2">
                      {msg.message.content.map(
                        (item: Record<string, unknown>, idx: number) => (
                          <div key={idx}>
                            {item.type === "text" &&
                              typeof item.text === "string" && (
                                <div className="prose prose-sm max-w-none prose-gray">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {item.text}
                                  </ReactMarkdown>
                                </div>
                              )}
                            {item.type === "tool_use" && (
                              <div className={cn("bg-gray-100", layout.containerPadding, layout.rounded, layout.smallText)}>
                                <span className="font-medium">
                                  <Wrench className={cn(layout.iconSize, "inline mr-1")} />
                                  {typeof item.name === "string"
                                    ? item.name
                                    : "Unknown Tool"}
                                </span>
                                {item.input &&
                                typeof item.input === "object" &&
                                item.input !== null ? (
                                  <pre className={cn("mt-1 overflow-x-auto", layout.smallText)}>
                                    {JSON.stringify(item.input, null, 2)}
                                  </pre>
                                ) : null}
                              </div>
                            )}
                          </div>
                        )
                      )}
                    </div>
                  ) : msg.message.content ? (
                    <pre className={cn(layout.smallText, "overflow-x-auto")}>
                      {JSON.stringify(msg.message.content, null, 2)}
                    </pre>
                  ) : null
                ) : (
                  <span className={cn(layout.bodyText, "text-gray-500 italic")}>{t('claudeSessionHistoryRenderer.noContent')}</span>
                )}
              </div>
              {typeof msg.message === "object" &&
                msg.message !== null &&
                "usage" in msg.message &&
                typeof msg.message.usage === "object" &&
                msg.message.usage !== null && (
                  <div className={cn("mt-2 text-gray-600", layout.smallText)}>
                    <span>
                      {t('claudeSessionHistoryRenderer.tokenUsage')}:{" "}
                      {"input_tokens" in msg.message.usage &&
                      typeof msg.message.usage.input_tokens === "number"
                        ? msg.message.usage.input_tokens
                        : "?"}
                      →
                      {"output_tokens" in msg.message.usage &&
                      typeof msg.message.usage.output_tokens === "number"
                        ? msg.message.usage.output_tokens
                        : "?"}
                    </span>
                    {"model" in msg.message &&
                      typeof msg.message.model === "string" && (
                        <span className="ml-2">{t('claudeSessionHistoryRenderer.model')}: {msg.message.model}</span>
                      )}
                  </div>
                )}
            </div>
          ))}
        </div>
      </div>
    );
  } catch {
    return (
      <div className={cn("mt-2 border", layout.containerPadding, layout.rounded, "bg-red-50 border-red-200")}>
        <div className={cn("flex items-center mb-2", layout.iconSpacing)}>
          <X className={cn(layout.iconSize, "text-red-500")} />
          <span className={cn(layout.titleText, "text-red-800")}>{t('claudeSessionHistoryRenderer.parsingError')}</span>
        </div>
        <p className={cn(layout.bodyText, "text-red-600")}>
          {t('claudeSessionHistoryRenderer.parsingErrorDescription')}
        </p>
        <details className="mt-2">
          <summary className={cn(layout.bodyText, "cursor-pointer")}>{t('claudeSessionHistoryRenderer.viewOriginalData')}</summary>
          <pre className={cn("mt-2 bg-gray-100 overflow-x-auto", layout.containerPadding, layout.rounded, layout.smallText)}>
            {content}
          </pre>
        </details>
      </div>
    );
  }
};
