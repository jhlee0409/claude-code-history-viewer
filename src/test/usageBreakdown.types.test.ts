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
  MAX_USAGE_INTERVALS,
  MAX_USAGE_SESSIONS,
  PROVIDER_SCAN_STATUSES,
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
    expect(sortedKeys(response.session_remainder)).toEqual(manifest(K.sessionRemainder));
    expect(response.session_remainder.models.length).toBeGreaterThan(0);
    for (const bucket of response.session_remainder.models) {
      expect(sortedKeys(bucket)).toEqual(manifest(K.pricedModelStats));
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

  it("limits match the backend's (the Rust contract test reads the same values)", () => {
    expect(fixture.limits).toEqual({
      max_intervals: MAX_USAGE_INTERVALS,
      max_sessions: MAX_USAGE_SESSIONS,
    });
  });

  it("coverage statuses match the backend's, not_found included (ADR 0003 §7)", () => {
    expect([...PROVIDER_SCAN_STATUSES]).toEqual(fixture.provider_scan_statuses);
    const statuses = response.coverage.providers.map((provider) => provider.status);
    expect(statuses).toContain("not_found");
    for (const status of statuses) {
      expect(PROVIDER_SCAN_STATUSES).toContain(status);
    }
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

// Reconciliation against the real command: usageBreakdown.reconciliation.test.ts.
