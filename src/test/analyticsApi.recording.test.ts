import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/services/api";
import { fetchProjectTokenStats, fetchSessionTokenStats } from "@/services/analyticsApi";

vi.mock("@/services/api", () => ({ api: vi.fn() }));

const base = {
  session_id: "synthetic", project_name: "fixture", total_input_tokens: 13,
  total_output_tokens: 7, total_cache_creation_tokens: 0, total_cache_read_tokens: 0,
  total_reasoning_tokens: 0, total_tokens: 20, message_count: 1,
  first_message_time: "2025-01-01T12:00:00Z", last_message_time: "2025-01-01T12:00:00Z",
  most_used_tools: [],
};

beforeEach(() => vi.clearAllMocks());

describe("recording metadata compatibility at the API boundary", () => {
  for (const mode of ["billing_total", "conversation_only"] as const) {
    it.each([
      [undefined, "unknown"], ["future-value", "unknown"], [null, "unknown"],
      ["absent", "absent"], ["recorded", "recorded"],
      ["partial", "partial"], ["unknown", "unknown"],
    ])(`${mode}: %s becomes %s without changing numbers`, async (input, expected) => {
      vi.mocked(api).mockResolvedValue({ ...base, token_usage_recording: input });
      const result = await fetchSessionTokenStats("synthetic.jsonl", mode, { start_date: "2025-01-01" });
      expect(result).toEqual({ ...base, token_usage_recording: expected });
      expect(api).toHaveBeenCalledWith("get_session_token_stats", {
        sessionPath: "synthetic.jsonl", statsMode: mode,
        startDate: "2025-01-01", endDate: undefined,
      });
    });
  }

  it("normalizes each paginated session independently, preserving pagination and zero", async () => {
    const page = { items: [{ ...base, total_tokens: 0 }, { ...base, token_usage_recording: "partial" }],
      total_count: 2, offset: 0, limit: 20, has_more: false };
    vi.mocked(api).mockResolvedValue(page);
    const result = await fetchProjectTokenStats("fixture", { stats_mode: "billing_total" });
    expect(result).toEqual({ ...page, items: [
      { ...page.items[0], token_usage_recording: "unknown" }, page.items[1],
    ] });
  });

  it("keeps request errors as errors, not absent or zero responses", async () => {
    vi.mocked(api).mockRejectedValue(new Error("No valid messages found in session"));
    await expect(fetchSessionTokenStats("empty.jsonl", "billing_total"))
      .rejects.toThrow("No valid messages found in session");
  });
});
