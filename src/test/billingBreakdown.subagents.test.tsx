import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import i18n from "@/i18n";
import { BillingBreakdownCard } from "@/components/AnalyticsDashboard/components/BillingBreakdownCard";
import type { SessionTokenStats, SubagentTokenStats } from "@/types";

const subagents: SubagentTokenStats = {
  session_count: 2,
  message_count: 3,
  total_input_tokens: 100,
  total_output_tokens: 50,
  total_cache_creation_tokens: 0,
  total_cache_read_tokens: 0,
  total_reasoning_tokens: 0,
  total_tokens: 150,
  model_distribution: [],
};
const stats = (subagent_stats?: SubagentTokenStats) =>
  ({ token_usage_recording: "recorded", subagent_stats } as SessionTokenStats);

afterEach(cleanup);

it("states the subagent share of the billing total with its run count (#577)", async () => {
  await i18n.changeLanguage("en");
  render(<BillingBreakdownCard billingTokens={400} conversationTokens={250} billingStats={stats(subagents)} />);
  expect(screen.getByText(/^Of which subagents: .*150.* \(2 runs\)$/)).toBeInTheDocument();
});

it("has no subagent line when the session spawned none", async () => {
  await i18n.changeLanguage("en");
  render(<BillingBreakdownCard billingTokens={400} conversationTokens={250} billingStats={stats()} />);
  expect(screen.queryByText(/Of which subagents/)).not.toBeInTheDocument();
});
