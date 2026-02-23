import React from "react";
import { useTranslation } from "react-i18next";
import { Activity } from "lucide-react";
import { SectionCard } from "./SectionCard";
import { formatNumber, formatCurrency } from "../utils";

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
  const hasConversationTokenData = conversationTokens !== null;
  const conversationTokenValue = conversationTokens ?? 0;
  const nonConversationTokenValue = Math.max(0, billingTokens - conversationTokenValue);
  const conversationTokenRatio =
    billingTokens > 0 ? (conversationTokenValue / billingTokens) * 100 : 0;
  const nonConversationTokenRatio =
    billingTokens > 0 ? (nonConversationTokenValue / billingTokens) * 100 : 0;

  const hasCostData = billingCost !== null;
  const safeBillingCost = billingCost ?? 0;
  const hasConversationCostData = conversationCost !== null;
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
        <p className="text-[12px] text-muted-foreground">
          {`${t("analytics.billingTotal", "Billing Total")} = ${t("analytics.conversationOnly", "Conversation Only")} + ${t("analytics.nonConversation", "Non-conversation")}`}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {t(
            "analytics.billingBreakdownHelp",
            "Conversation includes user/assistant turns. Non-conversation includes tool or system billed traffic."
          )}
        </p>
        {showProviderLimitHelp && (
          <p className="text-[11px] text-amber-700 dark:text-amber-300">
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
            <p className="text-[11px] text-muted-foreground">{t("analytics.billingTotal", "Billing Total")}</p>
            <p className="font-mono text-[14px] font-semibold text-foreground">
              {formatNumber(billingTokens)}
            </p>
            {hasCostData && (
              <p className="font-mono text-[11px] text-muted-foreground">
                {formatCurrency(safeBillingCost)}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground">100%</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/30">
            <p className="text-[11px] text-muted-foreground">{t("analytics.conversationOnly", "Conversation Only")}</p>
            <p className="font-mono text-[14px] font-semibold text-foreground">
              {hasConversationTokenData ? formatNumber(conversationTokenValue) : "—"}
            </p>
            {hasCostData && (
              <p className="font-mono text-[11px] text-muted-foreground">
                {hasConversationCostData ? formatCurrency(conversationCostValue) : "—"}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground">
              {hasConversationTokenData
                ? `${conversationTokenRatio.toFixed(1)}%`
                : t("analytics.calculating", "Calculating")}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-muted/30">
            <p className="text-[11px] text-muted-foreground">{t("analytics.nonConversation", "Non-conversation")}</p>
            <p className="font-mono text-[14px] font-semibold text-foreground">
              {hasConversationTokenData ? formatNumber(nonConversationTokenValue) : "—"}
            </p>
            {hasCostData && (
              <p className="font-mono text-[11px] text-muted-foreground">
                {hasConversationCostData ? formatCurrency(nonConversationCostValue) : "—"}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground">
              {hasConversationTokenData
                ? `${nonConversationTokenRatio.toFixed(1)}%`
                : t("analytics.calculating", "Calculating")}
            </p>
          </div>
        </div>
      </div>
    </SectionCard>
  );
};

BillingBreakdownCard.displayName = "BillingBreakdownCard";
