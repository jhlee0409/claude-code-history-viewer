import { useState } from "react";
import { Terminal, CheckCircle, AlertCircle, Info, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../../utils/cn";
import { COLORS } from "../../constants/colors";

type Props = {
  text: string;
};

interface CommandGroup {
  name?: string;
  message?: string;
  args?: string;
}

interface OutputTag {
  type: "stdout" | "stderr" | "other";
  name: string;
  content: string;
}

interface CaveatBlock {
  content: string;
}

export const CommandRenderer = ({ text }: Props) => {
  const { t } = useTranslation("components");

  // Command 그룹 (name, message, args) 추출
  const commandNameRegex = /<command-name>\s*(.*?)\s*<\/command-name>/gs;
  const commandMessageRegex =
    /<command-message>\s*(.*?)\s*<\/command-message>/gs;
  const commandArgsRegex = /<command-args>\s*(.*?)\s*<\/command-args>/gs;

  const nameMatch = text.match(commandNameRegex);
  const messageMatch = text.match(commandMessageRegex);
  const argsMatch = text.match(commandArgsRegex);

  const extractedName = nameMatch?.[0]
    ?.replace(/<\/?command-name>/g, "")
    .trim();
  const extractedMessage = messageMatch?.[0]
    ?.replace(/<\/?command-message>/g, "")
    .trim();
  const extractedArgs = argsMatch?.[0]
    ?.replace(/<\/?command-args>/g, "")
    .trim();

  const commandGroup: CommandGroup = {
    name: extractedName && extractedName.length > 0 ? extractedName : undefined,
    message:
      extractedMessage && extractedMessage.length > 0
        ? extractedMessage
        : undefined,
    args: extractedArgs && extractedArgs.length > 0 ? extractedArgs : undefined,
  };

  // 출력 태그들 (stdout, stderr 등) 추출 - 더 포괄적인 패턴 사용
  const outputTags: OutputTag[] = [];

  // stdout 계열: stdout, output이 포함된 모든 태그
  const stdoutRegex = /<([^>]*(?:stdout|output)[^>]*)\s*>\s*(.*?)\s*<\/\1>/gs;
  // stderr 계열: stderr, error가 포함된 모든 태그
  const stderrRegex = /<([^>]*(?:stderr|error)[^>]*)\s*>\s*(.*?)\s*<\/\1>/gs;

  let match;

  // stdout 계열 태그들
  while ((match = stdoutRegex.exec(text)) !== null) {
    const [, tagName, content] = match;
    if (content && content.trim()) {
      outputTags.push({
        type: "stdout",
        name: tagName ?? "",
        content: content.trim(),
      });
    }
  }

  // stderr 계열 태그들
  while ((match = stderrRegex.exec(text)) !== null) {
    const [, tagName, content] = match;
    if (content && content.trim()) {
      outputTags.push({
        type: "stderr",
        name: tagName ?? "",
        content: content.trim(),
      });
    }
  }

  // Extract local-command-caveat tags
  const caveatRegex = /<local-command-caveat>\s*(.*?)\s*<\/local-command-caveat>/gs;
  const caveats: CaveatBlock[] = [];
  let caveatMatch;
  while ((caveatMatch = caveatRegex.exec(text)) !== null) {
    const [, content] = caveatMatch;
    if (content && content.trim()) {
      caveats.push({ content: content.trim() });
    }
  }

  // Remove all tags
  const withoutCommands = text
    .replace(commandNameRegex, "")
    .replace(commandMessageRegex, "")
    .replace(commandArgsRegex, "")
    .replace(stdoutRegex, "")
    .replace(stderrRegex, "")
    .replace(caveatRegex, "")
    .replace(/^\s*\n/gm, "")
    .trim();

  const hasCommandGroup =
    commandGroup.name || commandGroup.message || commandGroup.args;
  const hasOutputs = outputTags.length > 0;
  const hasCaveats = caveats.length > 0;

  if (!hasCommandGroup && !hasOutputs && !hasCaveats && !withoutCommands) {
    return null;
  }

  return (
    <div className="space-y-2">
      {/* Command Group */}
      {hasCommandGroup && (
        <div className={cn("rounded-lg p-3 border", COLORS.tools.system.bg, COLORS.tools.system.border)}>
          <div className="flex items-center space-x-2 mb-2">
            <Terminal className={cn("w-4 h-4", COLORS.tools.system.icon)} />
            <span className={cn("text-xs font-medium", COLORS.tools.system.text)}>
              {t("commandRenderer.commandExecution")}
            </span>
          </div>

          <div className="space-y-2">
            {commandGroup.name && (
              <div className="flex items-start space-x-2">
                <span className={cn("text-xs font-medium mt-0.5 min-w-[40px]", COLORS.tools.system.text)}>
                  {t("commandRenderer.command")}
                </span>
                <code className={cn("px-2 py-1 rounded text-xs font-mono", COLORS.tools.system.bgDark, COLORS.tools.system.text)}>
                  {commandGroup.name}
                </code>
              </div>
            )}

            {commandGroup.args && (
              <div className="flex items-start space-x-2">
                <span className={cn("text-xs font-medium mt-0.5 min-w-[40px]", COLORS.tools.system.text)}>
                  {t("commandRenderer.arguments")}
                </span>
                <code className={cn("px-2 py-1 rounded text-xs font-mono whitespace-pre-wrap", COLORS.tools.search.bgDark, COLORS.tools.search.text)}>
                  {commandGroup.args}
                </code>
              </div>
            )}

            {commandGroup.message && (
              <div className="flex items-start space-x-2">
                <span className={cn("text-xs font-medium mt-0.5 min-w-[40px]", COLORS.tools.system.text)}>
                  {t("commandRenderer.status")}
                </span>
                <span className={cn("text-sm italic", COLORS.tools.system.icon)}>
                  {commandGroup.message}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Output Tags */}
      {outputTags.map((output, index) => {
        const isError = output.type === "stderr";
        const colors = isError ? COLORS.semantic.error : COLORS.semantic.success;
        const Icon = isError ? AlertCircle : CheckCircle;
        const label = isError
          ? t("commandRenderer.errorOutput")
          : t("commandRenderer.executionResult");

        return (
          <div
            key={index}
            className={cn("rounded-lg p-3 border", colors.bg, colors.border)}
          >
            <div className="flex items-center space-x-2 mb-2">
              <Icon className={cn("w-4 h-4", colors.icon)} />
              <span className={cn("text-xs font-medium", colors.textDark)}>
                {label} ({output.name})
              </span>
            </div>

            <div
              className={cn(
                "p-2 rounded max-h-80 overflow-y-auto text-sm",
                colors.bgDark,
                colors.text
              )}
            >
              <Markdown remarkPlugins={[remarkGfm]}>{output.content}</Markdown>
            </div>
          </div>
        );
      })}

      {/* Caveats - collapsible info blocks */}
      {caveats.map((caveat, index) => (
        <CaveatRenderer key={index} content={caveat.content} />
      ))}

      {/* Remaining Text */}
      {withoutCommands && (
        <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-gray-900 dark:prose-headings:text-gray-100 prose-p:text-gray-700 dark:prose-p:text-gray-300 prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-code:text-red-600 dark:prose-code:text-red-400 prose-code:bg-gray-100 dark:prose-code:bg-gray-800">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {withoutCommands}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
};

const CaveatRenderer = ({ content }: { content: string }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { t } = useTranslation("components");

  return (
    <div className={cn("rounded-lg border", COLORS.semantic.info.bg, COLORS.semantic.info.border)}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-left",
          "hover:bg-blue-100/50 dark:hover:bg-blue-900/30 transition-colors rounded-lg"
        )}
      >
        <ChevronRight
          className={cn(
            "w-4 h-4 transition-transform",
            COLORS.semantic.info.icon,
            isExpanded && "rotate-90"
          )}
        />
        <Info className={cn("w-4 h-4", COLORS.semantic.info.icon)} />
        <span className={cn("text-xs font-medium", COLORS.semantic.info.text)}>
          {t("commandRenderer.systemNote")}
        </span>
      </button>

      {isExpanded && (
        <div className={cn("px-3 pb-3 text-xs", COLORS.semantic.info.text)}>
          {content}
        </div>
      )}
    </div>
  );
};
