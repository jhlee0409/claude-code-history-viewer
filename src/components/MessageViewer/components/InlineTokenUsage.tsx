/**
 * InlineTokenUsage Component
 *
 * One assistant message's token usage, shown inline in its header when the
 * "Show token usage on messages" view setting is on (#570): input and output
 * always, cache read and cache write when the message used the cache.
 *
 * Missing values stay missing (#716/#718): a counter the source did not
 * record renders the no-value dash with a "Not recorded" title, never `0`.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { useFormat } from "@/lib/format/useFormat";
import { Num } from "@/lib/format/Num";
import { NO_VALUE } from "@/lib/format/locale";
import type { ClaudeAssistantMessage } from "../../../types";

type TokenUsage = NonNullable<ClaudeAssistantMessage["usage"]>;

const isRecorded = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

interface TokenCountProps {
  id: string;
  /** Short inline label (`in`, `out`, ...). */
  label: string;
  /** Full counter name for the title (`Input`, ...). */
  name: string;
  value: number | undefined;
}

const TokenCount: React.FC<TokenCountProps> = ({ id, label, name, value }) => {
  const { t } = useTranslation();
  const fmt = useFormat();
  const recorded = isRecorded(value);
  return (
    <span
      data-token={id}
      title={`${name}: ${recorded ? fmt.count(value) : t("common.missingValue.notRecorded")}`}
      className="whitespace-nowrap"
    >
      {label}{" "}
      <Num>{recorded ? fmt.tokens(value) : NO_VALUE}</Num>
    </span>
  );
};

export const InlineTokenUsage: React.FC<{ usage: TokenUsage }> = React.memo(({ usage }) => {
  const { t } = useTranslation();
  const cacheRead = usage.cache_read_input_tokens;
  const cacheWrite = usage.cache_creation_input_tokens;

  return (
    <span
      role="group"
      aria-label={t("messageViewer.inlineTokens.label")}
      data-testid="inline-token-usage"
      className="flex flex-wrap items-center justify-end gap-x-2 tabular-nums"
    >
      <TokenCount
        id="input"
        label={t("messageViewer.inlineTokens.input")}
        name={t("assistantMessageDetails.input")}
        value={usage.input_tokens}
      />
      <TokenCount
        id="output"
        label={t("messageViewer.inlineTokens.output")}
        name={t("assistantMessageDetails.output")}
        value={usage.output_tokens}
      />
      {isRecorded(cacheRead) && cacheRead > 0 && (
        <TokenCount
          id="cacheRead"
          label={t("messageViewer.inlineTokens.cacheRead")}
          name={t("assistantMessageDetails.cacheRead")}
          value={cacheRead}
        />
      )}
      {isRecorded(cacheWrite) && cacheWrite > 0 && (
        <TokenCount
          id="cacheWrite"
          label={t("messageViewer.inlineTokens.cacheWrite")}
          name={t("assistantMessageDetails.cacheCreation")}
          value={cacheWrite}
        />
      )}
    </span>
  );
});

InlineTokenUsage.displayName = "InlineTokenUsage";
