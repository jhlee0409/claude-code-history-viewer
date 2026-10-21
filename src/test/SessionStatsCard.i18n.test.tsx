/**
 * The token-stats session card speaks the UI language: its total reads
 * "토큰", not a hard-coded "tokens", its duration uses the localized short
 * units ("17시간 35분", not "17h 35m"), and the reasoning row has a real label.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import i18n from "@/i18n";
import { SessionStatsCard } from "@/components/SessionStatsCard";
import type { SessionTokenStats } from "@/types";

const stats = {
  session_id: "s-1",
  project_name: "p",
  total_input_tokens: 17_600,
  total_output_tokens: 501_300,
  total_cache_creation_tokens: 2_200_000,
  total_cache_read_tokens: 39_800_000,
  total_reasoning_tokens: 1_200,
  total_tokens: 42_520_100,
  message_count: 1369,
  first_message_time: "2026-06-29T06:00:00Z",
  last_message_time: "2026-06-29T23:35:00Z",
  summary: undefined,
  most_used_tools: [],
} as unknown as SessionTokenStats;

describe("SessionStatsCard in Korean", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("ko");
  });
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("labels the total, the duration and reasoning in Korean", () => {
    const { container } = render(<SessionStatsCard stats={stats} />);
    const text = container.textContent ?? "";
    expect(text).toContain("토큰");
    expect(text).not.toMatch(/tokens/i);
    expect(text).toContain("17시간 35분");
    expect(text).not.toMatch(/\d+h \d+m/);
    expect(screen.getByText("추론")).toBeInTheDocument();
    expect(text).not.toMatch(/Reasoning/i);
  });

  it("renders each compact numeral joined to its 만 suffix (U+2060, no break between them)", () => {
    const { container } = render(<SessionStatsCard stats={stats} />);
    const text = container.textContent ?? "";
    for (const value of ["1.8", "50.1", "220", "3980"]) {
      expect(text).toContain(`${value}\u2060만`);
    }
    expect(text).not.toMatch(/\d만/);
  });
});

describe("SessionStatsCard in Japanese", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("ja");
  });
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("renders each compact numeral joined to its 万 suffix (U+2060, no break between them)", () => {
    const { container } = render(<SessionStatsCard stats={stats} />);
    const text = container.textContent ?? "";
    for (const value of ["1.8", "50.1", "220", "3980"]) {
      expect(text).toContain(`${value}\u2060万`);
    }
    expect(text).not.toMatch(/\d万/);
  });
});
