import { beforeAll, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@/contexts/theme';
import { ExpandKeyProvider } from '@/contexts/CaptureExpandContext';
import { ClaudeContentArrayRenderer } from '@/components/contentRenderer/ClaudeContentArrayRenderer';
import { isToolRunEligible, normalizeResult, toolFamily, toolOutcome } from '@/components/transcript/toolOutcome';
import i18n from '@/i18n';

beforeAll(async () => { await i18n.changeLanguage('en'); });

// Source-shaped, not private records. Pinned return branches and wrapper writers:
// docs/contracts/backend-outcome-evidence.md#stored-shapes-candidates-not-authentication
const tools = [
  ['read', 'Read', { preview: '' }],
  ['glob', 'Glob', { count: 0, truncated: false }],
  ['edit', 'Edit', { diagnostics: {}, diff: '', filediff: {} }],
  ['write', 'Write', { diagnostics: {}, filepath: '/fixture/a', exists: false }],
  ['webfetch', 'WebFetch', {}],
  ['list', 'list', { count: 0, truncated: false }],
  ['grep', 'Grep', { matches: 0, truncated: false }],
] as const;

function check(provider: string, rawToolName: string, name: string, state: Record<string, unknown>, expected: string, rawIdentity = true) {
  const use = { type: 'tool_use' as const, id: 'c', name, ...(rawIdentity ? { rawToolName } : {}), input: { filePath: '/fixture/a', pattern: 'x', url: 'https://example.invalid' } };
  const result = { type: 'tool_result' as const, tool_use_id: 'c', content: 'Error is ordinary tool text', toolUseResult: state };
  const snapshot = JSON.stringify([use, result]);
  const { container, unmount } = render(<ThemeProvider><ExpandKeyProvider value="evidence"><ClaudeContentArrayRenderer provider={provider} content={[use, result]} /></ExpandKeyProvider></ThemeProvider>);
  const dom = container.querySelector('[data-tool-row]')?.getAttribute('data-tool-verdict');
  unmount();
  expect({ dom, pure: toolOutcome(use, [result], toolFamily(name), provider).verdict }).toEqual({ dom: expected, pure: expected });
  expect(isToolRunEligible(use, [result], toolFamily(name), provider)).toBe(expected === 'succeeded' && toolFamily(name) === 'read-search');
  expect(JSON.stringify([use, result])).toBe(snapshot);
}

for (const provider of ['opencode', 'kilo']) {
  describe(`${provider} owner option C`, () => {
    for (const [raw, name, metadata] of tools) {
      for (const rawIdentity of [true, false]) {
        it(`${raw} default custom shape is unknown (raw identity ${rawIdentity})`, () => {
          check(provider, raw, name, { status: 'completed', title: '', metadata: provider === 'kilo' ? { truncated: false } : {} }, 'unknown', rawIdentity);
        });
      }
      it(`${raw} genuine built-in shape keeps the bounded policy`, () => {
        check(provider, raw, name, { status: 'completed', title: raw === 'webfetch' ? 'https://example.invalid (text/plain)' : '', metadata: provider === 'kilo' ? { truncated: false, ...metadata, ...(raw === 'read' ? { loaded: [] } : {}), ...(raw === 'write' ? { diff: '', filediff: {} } : {}) } : metadata }, raw === 'grep' || (provider === 'kilo' && raw === 'list') ? 'unknown' : 'succeeded');
      });
      it(`${raw} thrown error still fails`, () => {
        check(provider, raw, name, { status: 'error', title: '', metadata: {}, error: 'synthetic failure' }, 'failed');
      });
    }
    it.each([{}, { truncated: false }, { truncated: true, outputPath: '/fixture/output' }, { truncated: false, approval: {} }, { truncated: true, outputPath: '/fixture/output', approval: { permission: 'read' } }, { approval: {} }])('empty title with wrapper metadata %j', metadata => {
      check(provider, 'read', 'Read', { status: 'completed', title: '', metadata }, provider === 'kilo' || Object.keys(metadata).length === 0 ? 'unknown' : 'succeeded');
    });
    it.each([{ status: 'completed' }, { status: 'completed', title: '' }, { status: 'completed', title: '', metadata: null }, { status: 'completed', title: '', metadata: [] }, { status: 'completed', title: null, metadata: {} }])('missing/malformed shape is not invented: %j', state => {
      check(provider, 'read', 'Read', state, 'succeeded');
    });
    it('cannot prove built-in provenance from a custom/hook-forged built-in shape', () => {
      check(provider, 'read', 'Read', { status: 'completed', title: '', metadata: { preview: '' } }, 'succeeded');
    });
    it('does not borrow a sibling result shape to certify default custom output', () => {
      const use = { name: 'Read', rawToolName: 'read' };
      const builtin = { toolUseResult: { status: 'completed', title: '', metadata: { preview: '' } } };
      const custom = { toolUseResult: { status: 'completed', title: '', metadata: provider === 'kilo' ? { truncated: false } : {} } };
      expect(toolOutcome(use, [builtin, custom], 'read-search', provider).verdict).toBe('unknown');
      expect(normalizeResult(custom, { provider, toolName: 'Read', rawToolName: 'read' }).isError).toBeUndefined();
    });
  });
}
