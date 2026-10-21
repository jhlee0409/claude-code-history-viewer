import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import i18n from "@/i18n";
import type { SessionTokenStats } from "@/types";
import { SessionStatsCard } from "@/components/SessionStatsCard";

const base: SessionTokenStats = {
  session_id: "fixture", project_name: "fixture", message_count: 1,
  total_tokens: 0, total_input_tokens: 0, total_output_tokens: 0,
  total_cache_creation_tokens: 0, total_cache_read_tokens: 0, total_reasoning_tokens: 0,
  first_message_time: "", last_message_time: "invalid",
  model_distribution: [], most_used_tools: [],
};
const labels = {
  en: "Not recorded", ko: "기록 없음", ja: "記録なし", "zh-CN": "未记录", "zh-TW": "未記錄",
};
afterEach(cleanup);
describe("missing values are not recorded zero", () => {
  for (const [locale, absent] of Object.entries(labels)) {
    it(`${locale}: absent total and invalid times have localized absence, not numeric zero`, async () => {
      await i18n.changeLanguage(locale);
      render(<SessionStatsCard stats={{ ...base, token_usage_recording: "absent" }} />);
      expect(screen.getAllByText(absent).length).toBeGreaterThanOrEqual(2);
      expect(screen.queryByText("invalid")).toBeNull();
      expect(screen.queryByText("NaN")).toBeNull();
    });
    it(`${locale}: recorded zero survives`, async () => {
      await i18n.changeLanguage(locale);
      render(<SessionStatsCard stats={{ ...base, token_usage_recording: "recorded" }} />);
      expect(screen.getByText("0")).toBeInTheDocument();
    });
  }
});
