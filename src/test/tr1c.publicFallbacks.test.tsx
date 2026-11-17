// Actual public responses over repository-authored records. No invented result blocks.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@/contexts/theme';
import { ExpandKeyProvider } from '@/contexts/CaptureExpandContext';
import { useExpandRegistry } from '@/store/expandRegistryStore';
import { ClaudeContentArrayRenderer } from '@/components/contentRenderer/ClaudeContentArrayRenderer';
import { normalizeResult, toolOutcome } from '@/components/transcript/toolOutcome';
import { ToolExecutionResultRouter } from '@/components/messageRenderer/ToolExecutionResultRouter';
import i18n from '@/i18n';
import publicResults from './fixtures/tr1c/public-results.json';

type Message = { uuid: string; content: string | Record<string, unknown>[] };
const samples = publicResults as unknown as Record<string, { load_provider_messages: Message[] }>;
const resultProviders = ['amazonq', 'cline', 'codebuddy', 'copilot', 'crush', 'cursor', 'forgecode', 'gemini', 'goose', 'grok', 'kimi', 'kiro', 'qwen', 'vibe', 'zcode', 'zed'];
const textProviders = ['aider', 'antigravity', 'continue', 'cursor-agent', 'llm', 'pearai', 'trae'];
// Independent expectations: process success is NOT supplied by these result fixtures.
const processVerdicts: Record<string, string[]> = {
  amazonq: ['unknown'], cline: ['unknown'], codebuddy: ['unknown', 'failed'],
  copilot: ['unknown'], crush: ['unknown'], cursor: ['unknown'], forgecode: ['unknown'],
  gemini: ['unknown', 'failed'], goose: ['unknown'], grok: ['unknown'], kimi: ['unknown'],
  kiro: ['unknown'], qwen: ['unknown'], vibe: ['unknown'], zcode: ['unknown'], zed: ['unknown'],
};
function blocks(provider: string) {
  expect(samples[provider], `${provider}: observed public fixture required`).toBeDefined();
  return samples[provider]!.load_provider_messages.flatMap(m => Array.isArray(m.content) ? m.content : []);
}
function mount(provider: string) {
  const messages = samples[provider]!.load_provider_messages;
  return render(<ThemeProvider>{messages.map(m => <ExpandKeyProvider key={m.uuid} value={`${provider}-${m.uuid}`}>
    {/* String messages use the existing text-block route, not a synthetic tool result. */}
    <section data-source-message={m.uuid}><ClaudeContentArrayRenderer provider={provider} content={typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content}/></section>
  </ExpandKeyProvider>)}</ThemeProvider>);
}
function open(root: HTMLElement) {
  for (let i = 0; i < 80; i++) {
    const button = root.querySelector<HTMLElement>('button[aria-expanded="false"]');
    if (!button) return;
    fireEvent.click(button);
  }
  throw new Error('disclosures did not settle');
}
beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => { useExpandRegistry.getState().clearAll(); });

describe('TR1c added public provider result/fallback preservation', () => {
  it('opaque content wrappers retain every sibling value, not only the content string', () => {
    // Derived component-state control; not claimed as an observed public response.
    const record = { content: 'payload', future: { zero: 0, flag: false, empty: '', absent: null }, list: ['first', 'second'] };
    const { container } = render(<ThemeProvider><ExpandKeyProvider value="wrapper-control"><ToolExecutionResultRouter toolResult={record}/></ExpandKeyProvider></ThemeProvider>);
    open(container);
    expect([...container.querySelectorAll('pre')].map(el => el.textContent)).toEqual([JSON.stringify(record, null, 2)]);
  });
  it('a content-only wrapper retains the existing plain text presentation', () => {
    const { container } = render(<ThemeProvider><ExpandKeyProvider value="bare-control"><ToolExecutionResultRouter toolResult={{ content: 'payload' }}/></ExpandKeyProvider></ThemeProvider>);
    open(container);
    expect(container.textContent).toContain('payload');
    expect(container.textContent).not.toContain('"content"');
  });
  for (const provider of resultProviders) it(`${provider}: preserves real result values/order and never guesses process exit`, () => {
    const original = JSON.stringify(samples[provider]);
    const results = blocks(provider).filter(b => b.type === 'tool_result');
    expect(results.length).toBeGreaterThan(0);
    expect(results.map(r => toolOutcome(null, [r], 'process', provider).verdict)).toEqual(processVerdicts[provider]);
    for (const r of results) expect(normalizeResult(r, { provider }).exitCode).toBeUndefined();
    const { container } = mount(provider);
    open(container);
    for (const r of results) {
      const text = typeof r.content === 'string' ? r.content : JSON.stringify(r.content, null, 2);
      // Exact output bytes, or the unchanged structured JSON fallback.
      expect([...container.querySelectorAll('pre')].map(el => el.textContent)).toContain(text);
    }
    expect([...container.querySelectorAll('[data-source-message]')].map(el => el.textContent)).toMatchSnapshot();
    expect(JSON.stringify(samples[provider])).toBe(original);
  });
  for (const provider of textProviders) it(`${provider}: preserves text-only fallback without fabricating result/outcome`, () => {
    const content = blocks(provider);
    expect(content.filter(b => b.type === 'tool_result')).toEqual([]);
    const { container } = mount(provider);
    open(container);
    expect(container.querySelector('[data-detail-zone="result"]')).toBeNull();
    // Antigravity records a call but no result; the others record no call.
    expect([...container.querySelectorAll('[data-tool-row]')].map(el => el.getAttribute('data-tool-lifecycle'))).toEqual(provider === 'antigravity' ? ['no-result'] : []);
    expect(container.textContent).not.toContain('Exit code 0');
    expect([...container.querySelectorAll('[data-source-message]')].map(el => el.textContent)).toMatchSnapshot();
  });
});
