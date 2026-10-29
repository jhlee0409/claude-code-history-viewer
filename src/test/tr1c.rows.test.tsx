import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { StrictMode } from 'react';
import i18n from '@/i18n';
import { ThemeProvider } from '@/contexts/theme';
import { ExpandKeyProvider } from '@/contexts/CaptureExpandContext';
import { useExpandRegistry } from '@/store/expandRegistryStore';
import { ClaudeContentArrayRenderer } from '@/components/contentRenderer/ClaudeContentArrayRenderer';
import samples from './fixtures/tr1c/public-results.json';
const fixture = samples as unknown as Record<string, { load_provider_messages: { uuid: string; content: unknown; subtype?: string }[] }>;
function mount(provider: string, uuid: string, searchQuery = '') {
  const m = fixture[provider]!.load_provider_messages.find(m => m.uuid === uuid)!;
  const props = { content: m.content as unknown[], provider, searchQuery };
  return render(<StrictMode><ThemeProvider><ExpandKeyProvider value={`${provider}-${uuid}`}><ClaudeContentArrayRenderer {...props} /></ExpandKeyProvider></ThemeProvider></StrictMode>);
}
function open(root: HTMLElement) { for(let i=0;i<40;i++){const b=root.querySelector<HTMLElement>('button[aria-expanded=false]'); if(!b)break;fireEvent.click(b);} }
beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => { useExpandRegistry.getState().clearAll(); });
describe('TR1c source-owned outcomes reach real content dispatcher rows', () => {
  it('an OpenCode Bash result-only hit opens its existing named card and marks output', () => {
    const {container}=mount('opencode','msg_001','same');
    const row=container.querySelector('[data-tool-row-wrapper]')!;
    expect(row.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('true');
    expect(row.querySelector('mark')?.textContent).toBe('same');
  });
  for(const provider of ['codex','openinterpreter']) {
    it(`${provider}: actual shell row owns the wrapper outcome and retained future values`, () => {
      const {container}=mount(provider,'use-function');open(container);
      expect(container.querySelector('[data-tool-row]')?.getAttribute('data-tool-verdict')).toBe('succeeded');
      expect(container.textContent).toContain('Exit code 0');
      expect(container.textContent).toContain('future');
      expect(container.textContent).toContain('"null": null');
      expect(container.textContent).toContain('"false": false');
      expect(container.textContent).toContain('"zero": 0');
    });
  }
  for(const provider of ['opencode','kilo']) {
    it(`${provider}: completed, cancelled and error use same outcome vocabulary`, () => {
      const {container}=mount(provider,'msg_001');open(container);
      const rows=[...container.querySelectorAll('[data-tool-row]')];
      expect(rows[0]?.getAttribute('data-tool-verdict')).toBe('succeeded');
      expect(rows[1]?.getAttribute('data-tool-lifecycle')).toBe('interrupted');
      expect(container.textContent).toContain('evidence-only-needle');
    });
  }
  it('Pi opaque details retain explicit null/false/zero without inventing an exit', () => {
    const {container}=mount('pi','result-0');open(container);
    expect(container.textContent).toContain('evidence-only-needle');
    expect(container.querySelector('[data-tool-row]')?.getAttribute('data-tool-verdict')).toBe('unknown');
    expect(container.textContent).not.toContain('Exit code 0');
  });
  it('result-only hits open once per query, mark, permit manual collapse under StrictMode', () => {
    const {container,rerender}=mount('codex','use-custom','same');
    const toggle=()=>container.querySelector<HTMLElement>('[data-tool-row] button[aria-expanded]')!;
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('mark')?.textContent?.toLowerCase()).toContain('same');
    const target=toggle().getAttribute('aria-controls');expect(container.querySelector(`[id="${target}"]`)).not.toBeNull();
    fireEvent.click(toggle());expect(toggle().getAttribute('aria-expanded')).toBe('false');
    rerender(<></>);
  });
});
