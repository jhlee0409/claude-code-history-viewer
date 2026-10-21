import React from "react";
import { useTranslation } from "react-i18next";
import { Activity } from "lucide-react";
import { SectionCard } from "./SectionCard";
import { useFormat } from "@/lib/format/useFormat";
import { Num } from "@/lib/format/Num";

interface BillingBreakdownCardProps {
  billingTokens: number;
  conversationTokens: number | null;
  billingCost?: number | null;
  conversationCost?: number | null;
  showProviderLimitHelp?: boolean;
  className?: string;
}

export const BillingBreakdownCard: React.FC<BillingBreakdownCardProps> = ({
  billingTokens,
  conversationTokens,
  billingCost = null,
  conversationCost = null,
  showProviderLimitHelp = false,
  className,
}) => {
  const { t } = useTranslation();
  const fmt = useFormat();
  const hasConversationTokenData = conversationTokens != null;
  const conversationTokenValue = conversationTokens ?? 0;
  const nonConversationTokenValue = Math.max(0, billingTokens - conversationTokenValue);
  const conversationTokenRatio =
    billingTokens > 0 ? (conversationTokenValue / billingTokens) * 100 : 0;
  const nonConversationTokenRatio =
    billingTokens > 0 ? (nonConversationTokenValue / billingTokens) * 100 : 0;

  const hasCostData = billingCost != null;
  const safeBillingCost = billingCost ?? 0;
  const hasConversationCostData = conversationCost != null;
  const conversationCostValue = conversationCost ?? 0;
  const nonConversationCostValue = Math.max(0, safeBillingCost - conversationCostValue);

  return (
    <SectionCard
      title={t("analytics.billingBreakdown", "Billing Breakdown")}
      icon={Activity}
      colorVariant="blue"
      className={className}
    >
      <div className="space-y-3">
        <p className="text-caption text-muted-foreground">
          {`${t("analytics.billingTotal", "Billing Total")} = ${t("analytics.conversationOnly", "Conversation Only")} + ${t("analytics.nonConversation", "Non-conversation")}`}
        </p>
        <p className="text-caption text-muted-foreground">
          {t(
            "analytics.billingBreakdownHelp",
            "Conversation includes user/assistant turns. Non-conversation includes tool or system billed traffic."
          )}
        </p>
        {showProviderLimitHelp && (
          <p className="text-caption text-amber-700 dark:text-amber-300">
            {t(
              "analytics.billingBreakdownProviderLimitHelp",
              "For some providers, conversation-only and billing totals can match because sidechain metadata is unavailable."
            )}
          </p>
        )}

        <div className="h-2 w-full rounded-full bg-muted/30 overflow-hidden flex">
          <div
            className="h-full bg-metric-green transition-all duration-300"
            style={{ width: hasConversationTokenData ? `${conversationTokenRatio}%` : "0%" }}
          />
          <div
            className="h-full bg-metric-amber transition-all duration-300"
            style={{ width: hasConversationTokenData ? `${nonConversationTokenRatio}%` : "0%" }}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-3 rounded-lg bg-muted/30">
            <p className="text-caption text-muted-foreground">{t("analytics.billingTotal", "Billing Total")}</p>
            <p className="font-mono text-body font-semibold text-foreground">
              <Num>{fmt.tokens(billingTokens)}</Num>
            </p>
            {hasCostData && (
              <p className="font-mono text-caption text-muted-foreground">
                <Num>{fmt.cost(safeBillingCost)}</Num>
              </p>
            )}
            <p className="text-caption text-muted-foreground">
              {t("analytics.oneHundredPercent", "100%")}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-muted/30">
            <p className="text-caption text-muted-foreground">{t("analytics.conversationOnly", "Conversation Only")}</p>
            <p className="font-mono text-body font-semibold text-foreground">
              <Num>{hasConversationTokenData
                ? fmt.tokens(conversationTokenValue)
                : t("common.dash", "—")}</Num>
            </p>
            {hasCostData && (
              <p className="font-mono text-caption text-muted-foreground">
                <Num>{hasConversationCostData
                  ? fmt.cost(conversationCostValue)
                  : t("common.dash", "—")}</Num>
              </p>
            )}
            <p className="text-caption text-muted-foreground">
              <Num>{hasConversationTokenData
                ? fmt.percent(conversationTokenRatio / 100)
                : t("analytics.calculating", "Calculating")}</Num>
            </p>
          </div>
          <div className="p-3 rounded-lg bg-muted/30">
            <p className="text-caption text-muted-foreground">{t("analytics.nonConversation", "Non-conversation")}</p>
            <p className="font-mono text-body font-semibold text-foreground">
              <Num>{hasConversationTokenData
                ? fmt.tokens(nonConversationTokenValue)
                : t("common.dash", "—")}</Num>
            </p>
            {hasCostData && (
              <p className="font-mono text-caption text-muted-foreground">
                <Num>{hasConversationCostData
                  ? fmt.cost(nonConversationCostValue)
                  : t("common.dash", "—")}</Num>
              </p>
            )}
            <p className="text-caption text-muted-foreground">
              <Num>{hasConversationTokenData
                ? fmt.percent(nonConversationTokenRatio / 100)
                : t("analytics.calculating", "Calculating")}</Num>
            </p>
          </div>
        </div>
      </div>
    </SectionCard>
  );
};

BillingBreakdownCard.displayName = "BillingBreakdownCard";
