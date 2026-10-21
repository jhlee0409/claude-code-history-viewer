import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import i18n from "@/i18n";
import { BillingBreakdownCard } from "@/components/AnalyticsDashboard/components/BillingBreakdownCard";
import type { SessionTokenStats } from "@/types";
const stats = (recording: "absent" | "partial" | "recorded" | "unknown") => ({ token_usage_recording: recording } as SessionTokenStats);
afterEach(cleanup);
it("qualifies billing and conversation independently without claiming absent totals are zero", async () => {
  await i18n.changeLanguage("en");
  render(<BillingBreakdownCard billingTokens={0} conversationTokens={0}
    billingStats={stats("partial")} conversationStats={stats("absent")} />);
  expect(screen.getByText(i18n.t("common.missingValue.partialTokens"))).toBeInTheDocument();
  expect(screen.getAllByText("Not recorded").length).toBeGreaterThanOrEqual(2);
  expect(screen.getAllByText("0").length).toBe(1);
});
