"use client";
import { useId } from "react";
import { Button } from "@/components/ui/button";

import { Globe, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RecordedResult } from "@/components/transcript/RecordedResult";
import { CodeTarget, TargetWell } from "@/components/transcript/ToolRow";
import { cn } from "@/lib/utils";
import { layout } from "@/components/renderers";
import { useCaptureExpandState } from "@/contexts/CaptureExpandContext";
import { HighlightedText } from "../common/HighlightedText";
import { safeStringify } from "@/utils/jsonUtils";
import { TruncatedPre } from "@/components/common/TruncatedPre";
import { OutputBlock } from "@/components/transcript/OutputBlock";

type Props = {
  mcpData: Record<string, unknown>;
  searchQuery?: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
};

export const MCPRenderer = ({
  mcpData,
  searchQuery,
  isCurrentMatch = false,
  currentMatchIndex = 0,
}: Props) => {
  const showParamsContentId = useId();
  const showResultContentId = useId();
  const { t } = useTranslation();
  const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0;
  const server = identifier(mcpData.server) ? mcpData.server : t("common.unknown");
  const methodKey = identifier(mcpData.method) ? "method" : identifier(mcpData.function) ? "function" : undefined;
  const method = methodKey ? mcpData[methodKey] : t("common.unknown");
  const params = Object.hasOwn(mcpData, "params") ? mcpData.params : {};
  const result = Object.hasOwn(mcpData, "result") ? mcpData.result : {};
  const error = mcpData.error;
  // Keep false/null/zero/empty error values and every unrendered field as data.
  // A result beside an error is independent content, not consumed by that error.
  const rest = Object.fromEntries(Object.entries(mcpData).filter(([key]) =>
    !(key === "type" && mcpData.type === "mcp_tool_call") &&
    !(key === "server" && identifier(mcpData.server)) && key !== methodKey && key !== "params" &&
    !(key === "result" && !error) && !(key === "error" && !!error)));
  const errorText = typeof error === "string" ? error : safeStringify(error, 2);

  // Build a stable unique suffix from MCP data (server.method or function name)
  const mcpId = `${String(server)}.${String(method)}`;

  const [showParams, setShowParams] = useCaptureExpandState(`mcp-${mcpId}:params`, false);
  const [showResult, setShowResult] = useCaptureExpandState(`mcp-${mcpId}:result`, false);

  return (
    <RecordedResult title={t('mcpRenderer.mcpToolCall')}
        icon={<Globe className="w-4 h-4" />}
        target={<CodeTarget text={mcpId} highlight={searchQuery?.trim() ? { searchQuery, isCurrentMatch, currentMatchIndex } : undefined} />}
        meta={
          <div className={`${layout.smallText} text-tool-mcp`}>
            {String(server)}.{String(method)}
          </div>
        } record={mcpData} expandKey={`mcp-renderer-${mcpId}`} searchQuery={searchQuery}>
        <TargetWell text={mcpId} highlight={searchQuery?.trim() ? { searchQuery, isCurrentMatch, currentMatchIndex } : undefined} />
        <div className="space-y-2">
          {/* 매개변수 */}
          <div>
            <Button aria-expanded={showParams} aria-controls={showParamsContentId} variant="ghost" size="sm"
              type="button"
              onClick={() => setShowParams(prev => !prev)}
              className={cn("h-auto whitespace-normal justify-start font-normal", cn("flex items-center font-medium cursor-pointer text-tool-mcp", layout.iconSpacing, layout.bodyText))}
            >
              <ChevronRight className={cn(layout.iconSizeSmall, "transition-transform", showParams && "rotate-90")} />
              <span>{t('mcpRenderer.parameters')}</span>
            </Button>
            <div id={showParamsContentId} hidden={!showParams}>{showParams && (
              <TruncatedPre
                content={safeStringify(params, 2)}
                className={`mt-1 p-2 rounded ${layout.monoText} overflow-auto bg-tool-mcp/20 text-foreground`}
              />
            )}</div>
          </div>

          {/* 결과 */}
          {error ? (
            <div className="p-2 rounded border bg-destructive/10 border-destructive/30">
              <div className={`${layout.smallText} font-medium mb-1 text-destructive`}>
                {t('mcpRenderer.error')}
              </div>
              <div className={`${layout.bodyText} text-destructive`}>
                {searchQuery ? (
                  <HighlightedText
                    text={errorText}
                    searchQuery={searchQuery}
                    isCurrentMatch={isCurrentMatch}
                    currentMatchIndex={currentMatchIndex}
                  />
                ) : (
                  errorText
                )}
              </div>
            </div>
          ) : (
            <div>
              <Button aria-expanded={showResult} aria-controls={showResultContentId} variant="ghost" size="sm"
                type="button"
                onClick={() => setShowResult(prev => !prev)}
                className={cn("h-auto whitespace-normal justify-start font-normal", cn("flex items-center font-medium cursor-pointer text-tool-mcp", layout.iconSpacing, layout.bodyText))}
              >
                <ChevronRight className={cn(layout.iconSizeSmall, "transition-transform", showResult && "rotate-90")} />
                <span>{t('mcpRenderer.executionResult')}</span>
              </Button>
              <div id={showResultContentId} hidden={!showResult}>{showResult && (
                <TruncatedPre
                  content={safeStringify(result, 2)}
                  className={`mt-1 p-2 rounded ${layout.monoText} overflow-auto bg-muted text-foreground`}
                />
              )}</div>
            </div>
          )}
        </div>
        {Object.keys(rest).length > 0 && <OutputBlock json text={safeStringify(rest, 2)} source="file" expandKey={`mcp-${mcpId}-recorded`} searchQuery={searchQuery} highlight={{ isCurrentMatch, currentMatchIndex }} />}
      </RecordedResult>
  );
};
