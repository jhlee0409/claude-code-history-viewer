/**
 * Usage-breakdown wire contract (ADR 0002).
 *
 * Chain of checks: `tsc` ties USAGE_BREAKDOWN_WIRE_KEYS to the TS types; this
 * test ties the key list to the shared fixture; the Rust test
 * (`usage_breakdown::tests::contract_fixture_*`) round-trips the same fixture
 * through the Rust types. The adapter test shows Tauri and WebUI carry the
 * same arguments.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/usageBreakdown.contract.json";
import {
  USAGE_BREAKDOWN_COMMAND,
  USAGE_BREAKDOWN_WIRE_KEYS,
  usageBreakdownArgs,
  type UsageBreakdownRequest,
} from "@/types/usageBreakdown";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const sortedKeys = (value: unknown): string[] => Object.keys(value as object).sort();
const manifest = (keys: Record<string, true>): string[] => Object.keys(keys).sort();

describe("wire keys match the shared fixture", () => {
  const [projectRequest, allRequest] = fixture.requests;
  const { response } = fixture;
  const K = USAGE_BREAKDOWN_WIRE_KEYS;

  it("requests", () => {
    for (const request of fixture.requests) {
      expect(sortedKeys(request)).toEqual(manifest(K.request));
      for (const interval of request.intervals) {
        expect(sortedKeys(interval)).toEqual(manifest(K.interval));
      }
    }
    expect(sortedKeys(projectRequest!.scope)).toEqual(manifest(K.projectScope));
    expect(sortedKeys(allRequest!.scope)).toEqual(manifest(K.allScope));
    const custom = (allRequest!.scope as { custom_claude_paths: unknown[] }).custom_claude_paths;
    for (const path of custom) {
      expect(sortedKeys(path)).toEqual(manifest(K.customClaudePath));
    }
  });

  it("response", () => {
    expect(sortedKeys(response)).toEqual(manifest(K.response));
    for (const interval of response.intervals) {
      expect(sortedKeys(interval)).toEqual(manifest(K.intervalUsage));
      for (const bucket of interval.models) {
        expect(sortedKeys(bucket)).toEqual(manifest(K.pricedModelStats));
      }
    }
    for (const session of response.sessions) {
      expect(sortedKeys(session)).toEqual(manifest(K.sessionUsage));
      expect(sortedKeys(session.ref)).toEqual(manifest(K.sessionRef));
    }
    expect(sortedKeys(response.coverage)).toEqual(manifest(K.coverage));
    for (const provider of response.coverage.providers) {
      expect(sortedKeys(provider)).toEqual(manifest(K.providerCoverage));
    }
  });

  it("an estimate bucket carries no cost, a source bucket does", () => {
    const [sourceBucket, estimateBucket] = response.intervals[0]!.models;
    expect(sourceBucket).toMatchObject({ pricing_source: "source", stats: { cost_usd: 1 } });
    expect(estimateBucket!.pricing_source).toBe("estimate");
    expect("cost_usd" in estimateBucket!.stats).toBe(false);
  });
});

describe("Tauri and WebUI send the same arguments", () => {
  const request = fixture.requests[0] as unknown as UsageBreakdownRequest;
  type TauriWindow = typeof window & { __TAURI_INTERNALS__?: unknown };

  afterEach(() => {
    delete (window as TauriWindow).__TAURI_INTERNALS__;
    vi.unstubAllGlobals();
    invokeMock.mockReset();
  });

  it("one `request` object under the same command name", async () => {
    const { api } = await import("@/services/api");
    const args = usageBreakdownArgs(request);

    (window as TauriWindow).__TAURI_INTERNALS__ = {};
    invokeMock.mockResolvedValue(fixture.response);
    await api(USAGE_BREAKDOWN_COMMAND, args);
    expect(invokeMock).toHaveBeenCalledWith("get_usage_breakdown", { request });

    delete (window as TauriWindow).__TAURI_INTERNALS__;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(fixture.response), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await api(USAGE_BREAKDOWN_COMMAND, args);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith("/api/get_usage_breakdown")).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual(invokeMock.mock.calls[0]![1]);
  });
});

describe("reconciliation against the new command (AN0b turns these on)", () => {
  it.todo("AN0b: interval sum = range counted once = session sum, tokens and cost (bucket policy)");
  it.todo("AN0b: mixed source cost by day → summarizeBucketCost = $4 (1 exact + 3 estimated); old summary = $1");
  it.todo("AN0b: mixed source cost by turn in one day → two buckets, $4");
  it.todo("AN0b: localDayIntervals(Kolkata) request puts 18:20Z and 18:40Z rows on different days");
  it.todo("AN0b: Apia 2011-12-30 zero-length interval is returned with zero usage");
  it.todo("AN0b: undated rows only change coverage.undated_rows");
});
