"use client";

import { Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Renderer } from "../../shared/RendererHeader";
import { layout } from "@/components/renderers";
import { cn } from "@/lib/utils";
import { HighlightedText } from "../common/HighlightedText";
import { AnsiText } from "@/components/common/AnsiText";
import { stripAnsiCodes } from "@/utils/ansiToHtml";

type Props = {
  command: string;
  stream: string;
  output: string;
  timestamp: string;
  exitCode: number;
  searchQuery?: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
};

export const TerminalStreamRenderer = ({
  command,
  stream,
  output,
  timestamp,
  exitCode,
  searchQuery,
  isCurrentMatch = false,
  currentMatchIndex = 0,
}: Props) => {
  const { t } = useTranslation();

  return (
    <Renderer className="bg-tool-terminal/10 border-tool-terminal/30">
      <Renderer.Header
        title={t('terminalStreamRenderer.title')}
        icon={<Terminal className={cn(layout.iconSize, "text-tool-terminal")} />}
        titleClassName="text-foreground"
        rightContent={
          <div className={cn("flex items-center", layout.iconSpacing)}>
            {command && (
              <code className={`${layout.monoText} bg-tool-terminal/20 px-2 py-1 rounded text-tool-terminal`}>
                {String(command)}
              </code>
            )}
            {timestamp && (
              <span className={`${layout.smallText} text-muted-foreground`}>
                {new Date(String(timestamp)).toLocaleTimeString()}
              </span>
            )}
          </div>
        }
      />
      <Renderer.Content>
        <div className="relative">
          {/* 스트림 타입 표시 */}
          <div className={cn("flex items-center mb-2", layout.iconSpacing)}>
            <span
              className={cn(
                layout.smallText,
                "px-2 py-1 rounded",
                stream === "stderr"
                  ? "bg-destructive/20 text-destructive"
                  : "bg-tool-terminal/20 text-tool-terminal"
              )}
            >
              {String(stream)}
            </span>
            {exitCode !== undefined && (
              <span
                className={cn(
                  layout.smallText,
                  "px-2 py-1 rounded",
                  Number(exitCode) === 0
                    ? "bg-success/20 text-success"
                    : "bg-destructive/20 text-destructive"
                )}
              >
                {t('terminalStreamRenderer.exitCode')}: {String(exitCode)}
              </span>
            )}
          </div>

          {/* 출력 내용 */}
          <pre className={cn(layout.monoText, "text-foreground whitespace-pre-wrap bg-muted p-2 rounded overflow-auto max-h-80")}>
            {searchQuery ? (
              <HighlightedText
                text={stripAnsiCodes(String(output))}
                searchQuery={searchQuery}
                isCurrentMatch={isCurrentMatch}
                currentMatchIndex={currentMatchIndex}
              />
            ) : (
              <AnsiText text={String(output)} />
            )}
          </pre>
        </div>
      </Renderer.Content>
    </Renderer>
  );
};
