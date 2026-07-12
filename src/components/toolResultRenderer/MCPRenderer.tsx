"use client";

import { Globe, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Renderer } from "../../shared/RendererHeader";
import { cn } from "@/lib/utils";
import { layout } from "@/components/renderers";
import { useCaptureExpandState } from "@/contexts/CaptureExpandContext";
import { HighlightedText } from "../common/HighlightedText";
import { safeStringify } from "@/utils/jsonUtils";
import { TruncatedPre } from "@/components/common/TruncatedPre";

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
  const { t } = useTranslation();
  const server = mcpData.server || "unknown";
  const method = mcpData.method || "unknown";
  const params = mcpData.params || {};
  const result = mcpData.result || {};
  const error = mcpData.error;

  // Build a stable unique suffix from MCP data (server.method or function name)
  const mcpId = `${String(server)}.${String(method)}`;

  const [showParams, setShowParams] = useCaptureExpandState(`mcp-${mcpId}:params`, false);
  const [showResult, setShowResult] = useCaptureExpandState(`mcp-${mcpId}:result`, false);

  return (
    <Renderer className="bg-tool-mcp/10 border-tool-mcp/30" expandKey={`mcp-renderer-${mcpId}`}>
      <Renderer.Header
        title={t('mcpRenderer.mcpToolCall')}
        icon={<Globe className={cn(layout.iconSize, "text-tool-mcp")} />}
        titleClassName="text-foreground"
        rightContent={
          <div className={`${layout.smallText} text-tool-mcp`}>
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
              onClick={() => setShowParams(prev => !prev)}
              className={cn("flex items-center font-medium cursor-pointer text-tool-mcp", layout.iconSpacing, layout.bodyText)}
            >
              <ChevronRight className={cn(layout.iconSizeSmall, "transition-transform", showParams && "rotate-90")} />
              <span>{t('mcpRenderer.parameters')}</span>
            </button>
            {showParams && (
              <TruncatedPre
                content={safeStringify(params, 2)}
                className={`mt-1 p-2 rounded ${layout.monoText} overflow-auto bg-tool-mcp/20 text-foreground`}
              />
            )}
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
                    text={String(error)}
                    searchQuery={searchQuery}
                    isCurrentMatch={isCurrentMatch}
                    currentMatchIndex={currentMatchIndex}
                  />
                ) : (
                  String(error)
                )}
              </div>
            </div>
          ) : (
            <div>
              <button
                type="button"
                onClick={() => setShowResult(prev => !prev)}
                className={cn("flex items-center font-medium cursor-pointer text-tool-mcp", layout.iconSpacing, layout.bodyText)}
              >
                <ChevronRight className={cn(layout.iconSizeSmall, "transition-transform", showResult && "rotate-90")} />
                <span>{t('mcpRenderer.executionResult')}</span>
              </button>
              {showResult && (
                <TruncatedPre
                  content={safeStringify(result, 2)}
                  className={`mt-1 p-2 rounded ${layout.monoText} overflow-auto bg-muted text-foreground`}
                />
              )}
            </div>
          )}
        </div>
      </Renderer.Content>
    </Renderer>
  );
};
