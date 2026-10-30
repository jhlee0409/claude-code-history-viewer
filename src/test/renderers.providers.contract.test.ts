/** Raw #749 fixtures normalized by the pinned, source-parity-verified HTTP server.
 * public-results.json is observed command output, not a fabricated API response.
 * Uncovered dispatcher IDs stay explicit gaps (never aliases or fake samples).
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import inventory from './fixtures/tr1c/added-provider-inventory.json';
import { describe, expect, it } from 'vitest';
import publicResults from './fixtures/tr1c/public-results.json';
import { normalizeResult, toolOutcome } from '@/components/transcript/toolOutcome';
const samples = publicResults as unknown as Record<string, { load_provider_messages: Record<string, unknown>[]; load_provider_messages_paginated: { messages: Record<string, unknown>[] } }>;
const results = (provider: string) => samples[provider]!.load_provider_messages.flatMap(m => Array.isArray(m.content) ? m.content.filter((b): b is Record<string, unknown> => b?.type === 'tool_result') : []);
const dispatcher = readFileSync('src-tauri/src/commands/multi_provider.rs', 'utf8').split('fn load_non_claude_messages(')[1]!.split('/// Load messages')[0]!;
const ids = ['claude', ...[...dispatcher.matchAll(/"([\w-]+)" => providers::/g)].map(m => m[1]!)].sort();

const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, v]) => [key, canonical(v)])) : value;

describe('TR1c current public provider dispatcher and source fixtures', () => {
  it('pins the added inventory, exact public values, explicit fallback reasons and pagination totals', () => {
    expect(inventory).toHaveLength(23);
    expect(new Set(inventory.map(row => row.id)).size).toBe(23);
    expect(inventory.filter(row => row.toolResultPositive)).toHaveLength(16);
    for (const row of inventory) {
      const sample = samples[row.id]!;
      expect(sample.load_provider_messages).toHaveLength(row.messageCount);
      expect(results(row.id)).toHaveLength(row.resultCount);
      expect(row.toolResultPositive).toBe(row.resultCount > 0);
      expect(row.sourceProvenance.length).toBeGreaterThan(0);
      expect(createHash('sha256').update(JSON.stringify(canonical(sample))).digest('hex')).toBe(row.responseSha256);
      expect(sample.load_provider_messages_paginated).toMatchObject({ total_count: row.messageCount, next_offset: row.messageCount, has_more: false });
      expect(sample.load_provider_messages.every(m => m.provider === row.id)).toBe(true);
      if (!row.toolResultPositive) {
        expect(row.remainingReason?.length).toBeGreaterThan(20);
        expect(row.fallback).toBe('observed text / no-result call only');
      }
    }
  });
  it('has observed public messages for every dispatcher ID, without claiming results for text-only controls', () => {
    expect(ids).toHaveLength(31);
    expect(Object.keys(samples).sort()).toEqual(ids);
    expect(ids.filter(id => results(id).length === 0)).toEqual([
      'aider', 'antigravity', 'continue', 'cursor-agent', 'llm', 'pearai', 'trae',
    ]);
    expect(ids.reduce((count, id) => count + results(id).length, 0)).toBe(78);
  });
  for (const provider of Object.keys(samples)) {
    it(`${provider}: nonempty real normalized results, full/paginated identity, adapter does not mutate`, () => {
      const before = JSON.stringify(samples[provider]);
      const full = samples[provider]!.load_provider_messages;
      const page = samples[provider]!.load_provider_messages_paginated.messages;
      expect(full.length).toBeGreaterThan(0);
      if (provider === 'codebuddy') {
        // Raw orphan toolu_y has no timestamp; only that message receives Utc::now().
        // Preserve both exact responses and pin the sole observed difference.
        const differences = full.flatMap((m, index) => [...new Set([...Object.keys(m), ...Object.keys(page[index]!)])]
          .filter(key => JSON.stringify(m[key]) !== JSON.stringify(page[index]![key]))
          .map(key => ({ index, uuid: m.uuid, key, full: m[key], paginated: page[index]![key] })));
        expect(differences).toEqual([{ index: 1, uuid: 'codebuddy-fcr-3', key: 'timestamp', full: '2026-10-29T13:36:11.398384+00:00', paginated: '2026-10-29T13:36:11.399743+00:00' }]);
      } else expect(page).toEqual(full);
      for (const result of results(provider)) expect(toolOutcome(null, [result], 'process', provider).verdict).toMatch(/^(succeeded|failed|unknown)$/);
      expect(JSON.stringify(samples[provider])).toBe(before);
    });
  }
  for (const provider of ['codex', 'openinterpreter', 'openhands']) {
    it(`${provider}: reads source-owned nested metadata exit zero`, () => {
      const result = results(provider)[0]!;
      expect(normalizeResult(result, { provider }).exitCode).toBe(0);
      expect(toolOutcome(null, [result], 'process', provider)).toMatchObject({ verdict: 'succeeded', exitCode: 0 });
    });
  }
  for (const provider of ['codex', 'openinterpreter']) {
    it(`${provider}: replay result keeps own nonzero exit and interruption`, () => {
      const result = results(provider)[2]!;
      expect(toolOutcome(null, [result], 'process', provider)).toMatchObject({ lifecycle: 'interrupted', verdict: 'failed', exitCode: 2 });
    });
  }
  for (const provider of ['opencode', 'kilo']) {
    it(`${provider}: exact tool state, not an invented exit code`, () => {
      const r = results(provider);
      expect(toolOutcome(null, [r[0]!], 'process', provider).verdict).toBe('unknown');
      expect(toolOutcome(null, [r[1]!], 'process', provider).lifecycle).toBe('completed');
      expect(toolOutcome(null, [r[2]!], 'process', provider).verdict).toBe('failed');
      expect(normalizeResult(r[0]!, { provider }).exitCode).toBeUndefined();
    });
  }
  it('another provider never reinterprets the same metadata keys', () => {
    for (const provider of ['pi', 'ompi', 'cursor', 'copilot', 'opencode', 'kilo']) {
      expect(normalizeResult(results('codex')[0]!, { provider }).exitCode).toBeUndefined();
    }
  });
  for (const provider of ['pi', 'ompi']) {
    it(`${provider}: opaque details never establish process success; local execution stays separate`, () => {
      for (const result of results(provider)) expect(normalizeResult(result, { provider }).exitCode).toBeUndefined();
      expect(toolOutcome(null, [results(provider)[0]!], 'process', provider).verdict).toBe('unknown');
      const local = samples[provider]!.load_provider_messages.filter(m => m.subtype === 'bash_execution');
      expect(local).toHaveLength(6);
      for (const m of local) { expect(m.type).toBe('system'); expect(typeof m.content).toBe('string'); expect(m.sourceExecution).toBeDefined(); expect(m.toolUseResult).toBeNull(); }
    });
  }
});
