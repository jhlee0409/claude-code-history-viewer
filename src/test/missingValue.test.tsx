import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18n from "@/i18n";
import type { SessionTokenStats } from "@/types";
import { SessionStatsView } from "@/components/AnalyticsDashboard/views/SessionStatsView";
import { recordedDuration, recordedTime, tokenRecordingNote } from "@/lib/format/missingValue";
import { NO_VALUE } from "@/lib/format/locale";
import { SessionStatsCard } from "@/components/SessionStatsCard";

import { InspectorInfoTab } from "@/components/Inspector/InspectorInfoTab";
import { InspectorTokensTab } from "@/components/Inspector/InspectorTokensTab";
import { SessionMeta } from "@/components/SessionItem/components/SessionMeta";
import { useAppStore } from "@/store/useAppStore";
import type { ClaudeSession } from "@/types";

const initial = useAppStore.getState();
const load = vi.fn(async () => {});
const session: ClaudeSession = { session_id: "fixture", actual_session_id: "fixture", file_path: "/fixture.jsonl",
  project_name: "fixture", message_count: 1, first_message_time: "", last_message_time: "invalid", last_modified: "",
  has_tool_use: false, has_errors: false, provider: "claude" };
beforeEach(() => {
  useAppStore.setState({ ...initial, selectedSession: session, loadSessionTokenStats: load }, true);
  load.mockClear();
});
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
  it("shared adapters preserve duration zero and real epoch, reject missing/invalid/reversed intervals", () => {
    const time = "1970-01-01T00:00:00.000Z";
    const format = vi.fn(String);
    expect(recordedTime(time, format)).toBe(time);
    expect(recordedDuration(time, time, format)).toBe("0");
    expect(format).toHaveBeenCalledWith(0);
    format.mockClear();
    for (const invalid of ["", " ", "invalid"]) {
      expect(recordedTime(invalid, format)).toBe(NO_VALUE);
      expect(recordedDuration(invalid, time, format)).toBe(NO_VALUE);
    }
    expect(recordedDuration("2026-01-01T00:00:00Z", time, format)).toBe(NO_VALUE);
    expect(format).not.toHaveBeenCalled();
    expect(tokenRecordingNote({ ...base, token_usage_recording: "future" as SessionTokenStats["token_usage_recording"] })).toBe("common.missingValue.unknownTokens");
  });
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


describe("session-owned missing-value matrix", () => {
  for (const [locale, absent] of Object.entries(labels)) {
    for (const recording of ["absent", "recorded", "partial", "unknown", undefined] as const) {
      for (const total of [0, 20]) {
        if (recording === "absent" && total > 0) continue;
        it(`${locale}: ${recording ?? "old response"} ${total} retains truthful total context`, async () => {
          await i18n.changeLanguage(locale);
          useAppStore.setState({ sessionTokenStatsOwner: session.file_path,
            sessionTokenStats: { ...base, token_usage_recording: recording, total_tokens: total } });
          render(<InspectorTokensTab />);
          const region = screen.getByRole("region", { name: i18n.t("analytics.totalTokens") });
          if (recording === "absent") expect(region).toHaveTextContent(absent);
          else expect(region).toHaveTextContent(String(total));
          if (recording === "partial") expect(region).toHaveTextContent(i18n.t("common.missingValue.partialTokens"));
          if (recording === "unknown" || recording === undefined) expect(region).toHaveTextContent(i18n.t("common.missingValue.unknownTokens"));
        });
      }
    }
    it(`${locale}: model pending/error/no-record stay distinct without transcript inference`, async () => {
      await i18n.changeLanguage(locale);
      const view = render(<InspectorInfoTab />);
      expect(screen.getByText(i18n.t("common.loading"))).toBeInTheDocument();
      expect(load).toHaveBeenCalledTimes(1);
      act(() => useAppStore.setState({ sessionTokenStatsErrorOwner: session.file_path, sessionTokenStatsError: "failed" }));
      expect(screen.getByText(i18n.t("common.inspector.info.modelsUnavailable"))).toBeInTheDocument();
      act(() => useAppStore.setState({ sessionTokenStatsOwner: session.file_path, sessionTokenStats: base,
        sessionTokenStatsError: null }));
      expect(screen.getByText(i18n.t("common.inspector.info.noModels"))).toBeInTheDocument();
      expect(view.container.querySelector("time")).toBeNull();
      expect(screen.getAllByText(absent).length).toBe(2);
    });
    it(`${locale}: list timestamp adapter never formats missing data`, async () => {
      await i18n.changeLanguage(locale);
      const format = vi.fn(() => "invented date");
      render(<SessionMeta session={session} isSelected={false} formatTimeAgo={format} />);
      expect(screen.getByText(absent)).toBeInTheDocument();
      expect(format).not.toHaveBeenCalled();
    });
  }
  it("session analytics does not print NaN or zero for absent records", async () => {
    await i18n.changeLanguage("en");
    const view = render(<SessionStatsView sessionStats={{ ...base, token_usage_recording: "absent" }}
      sessionComparison={{ session_id: "fixture", percentage_of_project_tokens: 0, percentage_of_project_messages: 0,
        rank_by_tokens: 1, rank_by_duration: 1, is_above_average: false }} />);
    expect(view.container).not.toHaveTextContent("NaN");
    expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(3);
    expect(screen.queryByText("Below Average")).toBeNull();
    expect(screen.queryByText(i18n.t("analytics.rank", { rank: 1 }))).toBeNull();
  });
  for (const recording of ["absent", "recorded", "partial", "unknown", undefined, "future"] as const) {
    for (const above of [false, true]) {
      it(`performance colors: ${recording ?? "old response"} ${above ? "above" : "below"} preserves absence neutrality and observed status`, async () => {
        await i18n.changeLanguage("en");
        const absent = recording === "absent";
        const color = absent ? "var(--muted-foreground)" : above ? "var(--metric-green)" : "var(--metric-amber)";
        const view = render(<SessionStatsView sessionStats={{ ...base, token_usage_recording: recording as SessionTokenStats["token_usage_recording"] }}
          sessionComparison={{ session_id: "fixture", percentage_of_project_tokens: 0, percentage_of_project_messages: 0,
            rank_by_tokens: 3, rank_by_duration: 1, is_above_average: above }} />);
        const banner = view.container.firstElementChild!.firstElementChild!;
        const label = banner.querySelector("span.text-title") as HTMLElement;
        const rank = banner.querySelector("div.text-xl") as HTMLElement;
        const badge = rank.parentElement!;
        expect(label.style.color).toBe(color);
        expect(rank.style.color).toBe(color);
        expect(badge.style.background).toBe(`color-mix(in oklch, ${color} 10%, transparent)`);
        expect(label).toHaveTextContent(absent ? "Not recorded" : i18n.t(above ? "analytics.aboveAverage" : "analytics.belowAverage"));
        expect(rank).toHaveTextContent(absent ? "Not recorded" : "#3");
        expect(banner.querySelectorAll("svg.lucide-trending-down, svg.lucide-trending-up").length).toBe(absent ? 1 : 2);
      });
    }
  }
  it("valid zero duration keeps its duration rank", async () => {
    await i18n.changeLanguage("en");
    const time = "2026-01-01T00:00:00Z";
    render(<SessionStatsView sessionStats={{ ...base, token_usage_recording: "recorded", first_message_time: time, last_message_time: time }}
      sessionComparison={{ session_id: "fixture", percentage_of_project_tokens: 0, percentage_of_project_messages: 0,
        rank_by_tokens: 1, rank_by_duration: 37, is_above_average: false }} />);
    expect(screen.getByText(i18n.t("analytics.rank", { rank: 37 }))).toBeInTheDocument();
  });
  it("a settled null response is unavailable, not recorded absence, and is not re-requested", async () => {
    await i18n.changeLanguage("en");
    useAppStore.setState({ sessionTokenStatsOwner: session.file_path, sessionTokenStats: null });
    render(<><InspectorTokensTab /><InspectorInfoTab /></>);
    expect(screen.getByText(i18n.t("analytics.noTokenData"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("common.inspector.info.modelsUnavailable"))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("common.inspector.info.noModels"))).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });
  it("refresh preserves existing numeric zero and model data", async () => {
    await i18n.changeLanguage("en");
    const owned = { ...base, token_usage_recording: "partial" as const,
      model_distribution: [{ model_name: "observed-model", message_count: 1, token_count: 0,
        input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, reasoning_tokens: 0 }] };
    useAppStore.setState({ sessionTokenStatsOwner: session.file_path, sessionTokenStats: owned });
    render(<><InspectorTokensTab /><InspectorInfoTab /></>);
    act(() => useAppStore.setState({ isLoadingTokenStats: true }));
    expect(screen.getByText("observed-model")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Total Tokens" })).toHaveTextContent("0");
    expect(load).not.toHaveBeenCalled();
  });
});
