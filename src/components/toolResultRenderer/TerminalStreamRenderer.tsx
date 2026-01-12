"use client";

import { Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Renderer } from "../../shared/RendererHeader";
import { cn } from "../../utils/cn";
import { COLORS } from "../../constants/colors";

type Props = {
  command: string;
  stream: string;
  output: string;
  timestamp: string;
  exitCode: number;
};

export const TerminalStreamRenderer = ({
  command,
  stream,
  output,
  timestamp,
  exitCode,
}: Props) => {
  const { t } = useTranslation('components');

  return (
    <Renderer
      className={cn(
        "bg-gray-900 dark:bg-gray-950",
        "border-gray-700 dark:border-gray-800"
      )}
    >
      <Renderer.Header
        title={t('terminalStreamRenderer.title')}
        icon={<Terminal className="w-4 h-4 text-green-400" />}
        titleClassName="text-green-400"
        rightContent={
          <div className="flex items-center space-x-2">
            {command && (
              <code className="text-xs bg-gray-800 px-2 py-1 rounded text-green-300">
                {String(command)}
              </code>
            )}
            {timestamp && (
              <span className="text-xs text-gray-400">
                {new Date(String(timestamp)).toLocaleTimeString()}
              </span>
            )}
          </div>
        }
      />
      <Renderer.Content>
        <div className="relative">
          {/* 스트림 타입 표시 */}
          <div className="flex items-center space-x-2 mb-2">
            <span
              className={cn(
                "text-xs px-2 py-1 rounded",
                stream === "stderr"
                  ? "bg-red-800 text-red-200"
                  : "bg-gray-800 text-gray-300"
              )}
            >
              {String(stream)}
            </span>
            {exitCode !== undefined && (
              <span
                className={cn(
                  "text-xs px-2 py-1 rounded",
                  Number(exitCode) === 0
                    ? "bg-green-800 text-green-200"
                    : "bg-red-800 text-red-200"
                )}
              >
                {t('terminalStreamRenderer.exitCode')}: {String(exitCode)}
              </span>
            )}
          </div>

          {/* 출력 내용 */}
          <pre className="text-sm text-gray-100 whitespace-pre-wrap bg-gray-800 p-2 rounded overflow-auto max-h-80">
            {String(output)}
          </pre>
        </div>
      </Renderer.Content>
    </Renderer>
  );
};
