import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import i18n from "../i18n";
import { SessionStatsView } from "../components/AnalyticsDashboard/views/SessionStatsView";
import type { SessionComparison, SessionTokenStats } from "../types";

const sessionStats: SessionTokenStats = {
  session_id: "s1",
  project_name: "p",
  total_input_tokens: 120000,
  total_output_tokens: 35000,
  total_cache_creation_tokens: 0,
  total_cache_read_tokens: 0,
  total_reasoning_tokens: 0,
  total_tokens: 155000,
  message_count: 42,
  first_message_time: "2026-03-07T10:00:00Z",
  last_message_time: "2026-03-07T10:45:00Z",
  most_used_tools: [],
  model_distribution: [],
};

const sessionComparison: SessionComparison = {
  session_id: "s1",
  percentage_of_project_tokens: 12.3,
  percentage_of_project_messages: 10,
  rank_by_tokens: 2,
  rank_by_duration: 3,
  is_above_average: true,
};

// Layout itself can't be measured in jsdom, so this pins the contract that
// lets KPI captions wrap inside their narrow two-column cell (issue #719):
// the caption is allowed to shrink below its min-content width, a long word
// may break instead of overflowing, and the icon keeps its size.
describe("SessionStatsView KPI captions", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("lets every KPI caption wrap within its grid cell", () => {
    render(
      <SessionStatsView
        sessionStats={sessionStats}
        sessionComparison={sessionComparison}
        totalProjectSessions={10}
      />
    );

    for (const key of [
      "analytics.projectShare",
      "analytics.tokensPerMessage",
      "analytics.sessionTime",
      "analytics.percentile",
    ] as const) {
      const caption = screen.getByText(i18n.t(key));
      expect(caption).toHaveClass("min-w-0", "break-words");
      expect(caption.previousElementSibling).toHaveClass("shrink-0");
    }
  });

  it("gives the English Tokens/Message caption a word-break opportunity", () => {
    expect(i18n.t("analytics.tokensPerMessage")).toMatch(/\s/);
  });
});
