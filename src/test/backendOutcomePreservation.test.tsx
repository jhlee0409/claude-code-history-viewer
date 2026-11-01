import { beforeAll, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@/contexts/theme';
import { ExpandKeyProvider } from '@/contexts/CaptureExpandContext';
import { ClaudeContentArrayRenderer } from '@/components/contentRenderer/ClaudeContentArrayRenderer';
import i18n from '@/i18n';

beforeAll(async () => { await i18n.changeLanguage('en'); });
describe('backend producer outcome preservation through the real renderer', () => {
  for (const provider of ['opencode', 'kilo']) {
    it.each([['grep', 'succeeded'], ['grep_search', 'unknown'], ['Grep', 'unknown'], ['read_file', 'unknown']])(`${provider} exact raw tool %s`, (rawToolName, expected) => {
      const { container } = render(<ThemeProvider><ExpandKeyProvider value="evidence"><ClaudeContentArrayRenderer provider={provider} content={[
        { type: 'tool_use', id: 'c', name: 'Grep', rawToolName, input: { pattern: 'synthetic' } },
        { type: 'tool_result', tool_use_id: 'c', content: 'Error is ordinary search text', toolUseResult: { status: 'completed' } },
      ]}/></ExpandKeyProvider></ThemeProvider>);
      expect(container.querySelector('[data-tool-row]')?.getAttribute('data-tool-verdict')).toBe(expected);
    });
  }
  for (const provider of ['pi', 'ompi', 'gemini', 'cursor', 'zcode', 'goose', 'crush', 'zed', 'copilot', 'kimi', 'forgecode']) {
    it.each([['derived', false, 'unknown'], [undefined, false, 'succeeded'], ['derived', true, 'failed']] as const)(`${provider}: flag provenance %s/%s`, (source, isError, expected) => {
      const { container } = render(<ThemeProvider><ExpandKeyProvider value="evidence"><ClaudeContentArrayRenderer provider={provider} content={[
        { type: 'tool_use', id: 'c', name: 'Read', input: { file_path: 'guide.md' } },
        { type: 'tool_result', tool_use_id: 'c', content: 'Error is ordinary file text', is_error: isError, ...(source ? { is_error_source: source } : {}) },
      ]}/></ExpandKeyProvider></ThemeProvider>);
      expect(container.querySelector('[data-tool-row]')?.getAttribute('data-tool-verdict')).toBe(expected);
    });
  }
});
