/**
 * The inspector's Tokens tab formats shares with the shared `formatPercent`
 * (ADR 0002 §2, plan D15): a small share reads `<1%`, not `0%` — even for a
 * helper that used to round to a whole percent by hand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ClaudeProject, ClaudeSession, SessionTokenStats } from "@/types";

vi.mock("@/utils/clipboard", () => ({ copyTextToClipboard: vi.fn(async () => {}) }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import i18n from "@/i18n";
import { useAppStore } from "@/store/useAppStore";
import { InspectorTokensTab } from "./InspectorTokensTab";

const PROJECT: ClaudeProject = {
  name: "alpha",
  path: "/p/alpha",
  actual_path: "/home/me/alpha",
  session_count: 1,
  message_count: 10,
  last_modified: "2026-01-02T00:00:00.000Z",
  provider: "claude",
};
const SESSION: ClaudeSession = {
  session_id: "s1",
  actual_session_id: "uuid-1",
  file_path: "/p/alpha/s1.jsonl",
  project_name: "alpha",
  message_count: 42,
  first_message_time: "2026-01-01T10:00:00.000Z",
  last_message_time: "2026-01-01T11:30:00.000Z",
  last_modified: "2026-01-01T11:30:00.000Z",
  has_tool_use: false,
  has_errors: false,
  provider: "claude",
};

/** 1 input token out of 1,000: a 0.1% share, `<1%` — never a rounded `0%`. */
const tinyStats: SessionTokenStats = {
  session_id: "uuid-1",
  project_name: "alpha",
  total_input_tokens: 1,
  total_output_tokens: 999,
  total_cache_creation_tokens: 0,
  total_cache_read_tokens: 0,
  total_reasoning_tokens: 0,
  total_tokens: 1_000,
  message_count: 3,
  first_message_time: "2026-01-01T10:00:00.000Z",
  last_message_time: "2026-01-01T11:30:00.000Z",
  most_used_tools: [],
  model_distribution: [
    {
      model_name: "claude-opus-4",
      message_count: 2,
      token_count: 1,
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      reasoning_tokens: 0,
    },
    {
      model_name: "claude-haiku-4",
      message_count: 1,
      token_count: 999,
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      reasoning_tokens: 0,
    },
  ],
};

const rows = (region: string): Array<[string, string | undefined]> =>
  Array.from(
    screen.getByRole("region", { name: region }).querySelectorAll("dt"),
  ).map((dt) => [dt.textContent ?? "", dt.nextElementSibling?.textContent]);

describe("InspectorTokensTab shares", () => {
  beforeEach(async () => {
    localStorage.clear();
    useAppStore.setState(useAppStore.getState(), true);
    useAppStore.setState({
      selectedProject: PROJECT,
      selectedSession: SESSION,
      inspectorTab: "tokens",
      sessionTokenStats: tinyStats,
      sessionTokenStatsOwner: SESSION.file_path,
    });
    await i18n.changeLanguage("en");
  });

  afterEach(() => {
    cleanup();
  });

  it("uses the shared percent formatter in the breakdown", async () => {
    render(<InspectorTokensTab />);
    await waitFor(() => expect(screen.getByRole("region", { name: "Total Tokens" })).toBeTruthy());
    expect(rows("Breakdown")).toEqual([
      ["Input Tokens", "1<1%"],
      ["Output Tokens", "999>99%"],
    ]);
  });

  it("uses the shared percent formatter in the per-model rows", async () => {
    render(<InspectorTokensTab />);
    await waitFor(() => expect(screen.getByRole("region", { name: "By model" })).toBeTruthy());
    // Rows are ordered by usage, largest first.
    expect(rows("By model")).toEqual([
      ["claude-haiku-4", "999>99%"],
      ["claude-opus-4", "1<1%"],
    ]);
  });
});
