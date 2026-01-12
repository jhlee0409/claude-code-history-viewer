"use client";

import { Globe, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Renderer } from "../../shared/RendererHeader";
import { cn } from "../../utils/cn";
import { COLORS } from "../../constants/colors";

type Props = {
  mcpData: Record<string, unknown>;
};

export const MCPRenderer = ({ mcpData }: Props) => {
  const { t } = useTranslation('components');
  const server = mcpData.server || "unknown";
  const method = mcpData.method || "unknown";
  const params = mcpData.params || {};
  const result = mcpData.result || {};
  const error = mcpData.error;

  const [showParams, setShowParams] = useState(false);
  const [showResult, setShowResult] = useState(false);

  return (
    <Renderer
      className={cn(
        "bg-purple-50 dark:bg-purple-900/20",
        "border-purple-200 dark:border-purple-800"
      )}
    >
      <Renderer.Header
        title={t('mcpRenderer.mcpToolCall')}
        icon={<Globe className={cn("w-4 h-4", COLORS.tools.search.icon)} />}
        titleClassName={COLORS.tools.search.text}
        rightContent={
          <div className={cn("text-xs", COLORS.tools.search.text)}>
            {String(server)}.{String(method)}
          </div>
        }
      />
      <Renderer.Content>
        <div className="space-y-2">
          {/* 매개변수 */}
          <div>
            <button
              type="button"
              onClick={() => setShowParams(!showParams)}
              className={cn(
                "flex items-center space-x-1 text-sm font-medium cursor-pointer",
                COLORS.tools.search.text
              )}
            >
              <ChevronRight className={cn("w-3 h-3 transition-transform", showParams && "rotate-90")} />
              <span>{t('mcpRenderer.parameters')}</span>
            </button>
            {showParams && (
              <pre className={cn(
                "mt-1 p-2 rounded text-xs overflow-auto",
                "bg-purple-100 dark:bg-purple-900/40",
                COLORS.ui.text.primary
              )}>
                {JSON.stringify(params, null, 2)}
              </pre>
            )}
          </div>

          {/* 결과 */}
          {error ? (
            <div className={cn(
              "p-2 rounded border",
              "bg-red-100 dark:bg-red-900/30",
              "border-red-200 dark:border-red-800"
            )}>
              <div className={cn("text-xs font-medium mb-1", COLORS.semantic.error.text)}>
                {t('mcpRenderer.error')}
              </div>
              <div className={cn("text-sm", COLORS.semantic.error.text)}>
                {String(error)}
              </div>
            </div>
          ) : (
            <div>
              <button
                type="button"
                onClick={() => setShowResult(!showResult)}
                className={cn(
                  "flex items-center space-x-1 text-sm font-medium cursor-pointer",
                  COLORS.tools.search.text
                )}
              >
                <ChevronRight className={cn("w-3 h-3 transition-transform", showResult && "rotate-90")} />
                <span>{t('mcpRenderer.executionResult')}</span>
              </button>
              {showResult && (
                <pre className={cn(
                  "mt-1 p-2 rounded text-xs overflow-auto",
                  "bg-gray-100 dark:bg-gray-800",
                  COLORS.ui.text.primary
                )}>
                  {JSON.stringify(result, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      </Renderer.Content>
    </Renderer>
  );
};
