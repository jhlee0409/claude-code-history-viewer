/** Raw #749 fixtures normalized by the pinned, source-parity-verified HTTP server.
 * public-results.json is observed command output, not a fabricated API response.
 * Uncovered dispatcher IDs stay explicit gaps (never aliases or fake samples).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import publicResults from './fixtures/tr1c/public-results.json';
import { normalizeResult, toolOutcome } from '@/components/transcript/toolOutcome';
const samples = publicResults as unknown as Record<string, { load_provider_messages: Record<string, unknown>[]; load_provider_messages_paginated: { messages: Record<string, unknown>[] } }>;
const results = (provider: string) => samples[provider]!.load_provider_messages.flatMap(m => Array.isArray(m.content) ? m.content.filter((b): b is Record<string, unknown> => b?.type === 'tool_result') : []);
const dispatcher = readFileSync('src-tauri/src/commands/multi_provider.rs', 'utf8').split('fn load_non_claude_messages(')[1]!.split('/// Load messages')[0]!;
const ids = ['claude', ...[...dispatcher.matchAll(/"([\w-]+)" => providers::/g)].map(m => m[1]!)].sort();

describe('TR1c current public provider dispatcher and source fixtures', () => {
  it('enumerates every actual ID; uncovered source routes are explicit gaps', () => {
    expect(ids).toHaveLength(31);
    expect(ids.filter(id => !Object.hasOwn(samples, id))).toEqual([
      'aider', 'amazonq', 'antigravity', 'cline', 'codebuddy', 'continue', 'copilot', 'crush', 'cursor', 'cursor-agent', 'forgecode', 'gemini', 'goose', 'grok', 'kimi', 'kiro', 'llm', 'pearai', 'qwen', 'trae', 'vibe', 'zcode', 'zed',
    ]);
    expect(ids.map(id => ({ id, fallback: Object.hasOwn(samples, id) ? 'source fixture → shared row' : 'unverified source → retained shared/JSON fallback' }))).toMatchSnapshot();
  });
  for (const provider of Object.keys(samples)) {
    it(`${provider}: nonempty real normalized results, full/paginated identity, adapter does not mutate`, () => {
      const before = JSON.stringify(samples[provider]);
      expect(results(provider).length).toBeGreaterThan(0);
      expect(samples[provider]!.load_provider_messages_paginated.messages).toEqual(samples[provider]!.load_provider_messages);
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
      expect(toolOutcome(null, [r[0]!], 'process', provider).verdict).toBe('succeeded');
      expect(toolOutcome(null, [r[1]!], 'process', provider).lifecycle).toBe('interrupted');
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
