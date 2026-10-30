import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@/contexts/theme';
import { ExpandKeyProvider } from '@/contexts/CaptureExpandContext';
import { useExpandRegistry } from '@/store/expandRegistryStore';
import { ClaudeMessageNode } from '@/components/MessageViewer/components/ClaudeMessageNode';
import { ClaudeContentArrayRenderer } from '@/components/contentRenderer/ClaudeContentArrayRenderer';
import { ToolExecutionResultRouter } from '@/components/messageRenderer/ToolExecutionResultRouter';
import { ResultProviderContext } from '@/components/transcript/resultProvider';
import type { ClaudeMessage } from '@/types';
import i18n from '@/i18n';

beforeAll(async()=>{ await i18n.changeLanguage('en'); });
beforeEach(()=>useExpandRegistry.getState().clearAll());
function open(root: HTMLElement) {
  for(let i=0;i<30;i++) { const b=root.querySelector<HTMLElement>('button[aria-expanded="false"]'); if(!b)return; fireEvent.click(b); }
  throw new Error('disclosures did not settle');
}
const rowVerdicts=(root:HTMLElement)=>[...root.querySelectorAll('[data-tool-row]')].map(n=>n.getAttribute('data-tool-verdict'));

describe('bot provenance regressions — real message and result routes',()=>{
  it('message provider covers legacy sibling and inline content; explicit nested provider still overrides',()=>{
    const message={uuid:'legacy-pi',type:'user',timestamp:'2026-01-01T00:00:00Z',provider:'pi',content:'legacy result',toolUseResult:{stdout:'opaque-pi-output',exitCode:23,interrupted:true}} as ClaudeMessage;
    const {container}=render(<ThemeProvider><ClaudeMessageNode message={message}/><ResultProviderContext.Provider value="claude"><ExpandKeyProvider value="nested"><ClaudeContentArrayRenderer provider="opencode" content={[{type:'tool_use',id:'nested-use',name:'Read',input:{file_path:'guide.md'}},{type:'tool_result',tool_use_id:'nested-use',content:'guide body',toolUseResult:{status:'completed'}}]}/></ExpandKeyProvider></ResultProviderContext.Provider></ThemeProvider>);
    expect(container.querySelector('[data-message-uuid="legacy-pi"] [data-tool-row]')?.getAttribute('data-tool-verdict')).toBe('unknown');
    expect(container.querySelector('[data-message-uuid="legacy-pi"] [data-tool-row]')?.getAttribute('data-tool-lifecycle')).toBe('completed');
    open(container);
    expect(container.textContent).toContain('"exitCode": 23');
    // OpenCode non-process completed is producer no-error; Pi opaque exit remains data.
    // https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/session/prompt.ts#L1115-L1160
    expect(rowVerdicts(container)).toEqual(['unknown','succeeded']);
  });
  // Backend opencode.rs:1461-1511,1675-1691 (also kilo.rs:181):
  // only the normalized name survives; state is attached to the result.
  for (const provider of ['opencode', 'kilo'] as const) {
    it.each(['Read', 'Glob', 'Edit', 'Write', 'WebFetch', 'list'])(`${provider}: backend-delivered %s uses the real paired renderer route`, name => {
      const id = `${provider}-${name}`;
      const content = [
        { type: 'tool_use', id, name, input: { file_path: 'guide.md', pattern: '*.md', url: 'https://example.invalid' } },
        { type: 'tool_result', tool_use_id: id, content: 'synthetic result', toolUseResult: { status: 'completed' } },
      ];
      const { container } = render(<ThemeProvider><ExpandKeyProvider value={id}><ClaudeContentArrayRenderer provider={provider} content={content}/></ExpandKeyProvider></ThemeProvider>);
      expect(rowVerdicts(container)).toEqual([provider === 'kilo' && name === 'list' ? 'unknown' : 'succeeded']);
    });
    it.each(['built-in grep', 'MCP grep_search'])(`${provider}: %s arrives as ambiguous Grep and stays unknown`, source => {
      // Both sources become name:'Grep'; do not invent a raw-name metadata field.
      const id = `${provider}-${source}`;
      const { container } = render(<ThemeProvider><ExpandKeyProvider value={id}><ClaudeContentArrayRenderer provider={provider} content={[
        { type: 'tool_use', id, name: 'Grep', input: { pattern: 'synthetic' } },
        { type: 'tool_result', tool_use_id: id, content: 'synthetic MCP error or grep output', toolUseResult: { status: 'completed' } },
      ]}/></ExpandKeyProvider></ThemeProvider>);
      expect(rowVerdicts(container)).toEqual(['unknown']);
    });
    it(`${provider}: backend Read status:error still fails through the renderer`, () => {
      const id = `${provider}-failed-read`;
      const { container } = render(<ThemeProvider><ExpandKeyProvider value={id}><ClaudeContentArrayRenderer provider={provider} content={[
        { type: 'tool_use', id, name: 'Read', input: { file_path: 'guide.md' } },
        { type: 'tool_result', tool_use_id: id, content: 'synthetic rejection', is_error: true, toolUseResult: { status: 'error' } },
      ]}/></ExpandKeyProvider></ThemeProvider>);
      expect(rowVerdicts(container)).toEqual(['failed']);
    });
  }
  // Kilo shell@0a9faeff:662-683,687-723: abort/timeout => null exit;
  // normal output is unconstrained and may print the same suffix with a numeric exit.
  // https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/tool/shell.ts#L662-L723
  for (const note of ['User aborted the command', 'shell tool terminated command after exceeding timeout 1000 ms.', 'shell tool terminated command after exceeding environment timeout 1000 ms. synthetic note\nsecond line']) {
    it.each([null, 0, 2, undefined])(`Kilo exact shell suffix (${note}) requires recorded null exit: %s`, exit => {
      const output = `synthetic output\n\n<shell_metadata>\n${note}\n</shell_metadata>`;
      const metadata = exit === undefined ? {} : { exit };
      const content = [
        { type: 'tool_use', id: 'shell-call', name: 'Bash', input: { command: 'synthetic' } },
        { type: 'tool_result', tool_use_id: 'shell-call', content: output, toolUseResult: { status: 'completed', output, metadata } },
      ];
      const before = JSON.stringify(content);
      const { container } = render(<ThemeProvider><ExpandKeyProvider value="shell-call"><ClaudeContentArrayRenderer provider="kilo" content={content}/></ExpandKeyProvider></ThemeProvider>);
      expect(container.querySelector('[data-tool-row]')?.getAttribute('data-tool-lifecycle')).toBe(exit === null ? 'interrupted' : 'completed');
      expect(rowVerdicts(container)).toEqual([exit === 0 ? 'succeeded' : exit === 2 ? 'failed' : 'unknown']);
      expect(JSON.stringify(content)).toBe(before);
    });
  }
  // OpenCode c29392d0 introduces the abort writer (parent 46f243fe has no flag).
  // https://github.com/anomalyco/opencode/blob/c29392d0857f11208753bd95be76c6069c070289/packages/opencode/src/session/processor.ts#L402-L415
  // opencode.rs:1493-1511 + result_evidence.rs:4-9 preserve the entire state.
  for (const provider of ['opencode', 'kilo'] as const) {
    it.each([true, false, undefined])(`${provider} error interruption metadata is provider/state scoped: %s`, interrupted => {
      const state = { status: 'error', input: { command: 'synthetic' }, error: 'Tool execution aborted', metadata: { ...(interrupted === undefined ? {} : { interrupted }), output: 'synthetic partial output' }, time: { start: 0, end: 1 } };
      const content = [
        { type: 'tool_use', id: 'aborted-call', name: 'Bash', input: state.input },
        { type: 'tool_result', tool_use_id: 'aborted-call', content: state.error, is_error: true, toolUseResult: state, toolUseResultSource: { messageUuid: 'synthetic', sessionId: 'synthetic', contentIndex: 1, partIndex: 0, association: 'single_result' } },
      ];
      const before = JSON.stringify(content);
      const { container } = render(<ThemeProvider><ExpandKeyProvider value="aborted-call"><ClaudeContentArrayRenderer provider={provider} content={content}/></ExpandKeyProvider></ThemeProvider>);
      expect(container.querySelector('[data-tool-row]')?.getAttribute('data-tool-lifecycle')).toBe(provider === 'opencode' && interrupted === true ? 'interrupted' : 'completed');
      // Existing interruption policy is unknown without a nonzero recorded exit.
      expect(rowVerdicts(container)).toEqual([provider === 'opencode' && interrupted === true ? 'unknown' : 'failed']);
      expect(JSON.stringify(content)).toBe(before);
    });
    it(`${provider} completed arbitrary interruption metadata cannot override success`, () => {
      const { container } = render(<ThemeProvider><ExpandKeyProvider value="completed-call"><ClaudeContentArrayRenderer provider={provider} content={[
        { type: 'tool_use', id: 'completed-call', name: 'Read', input: { file_path: 'synthetic.md' } },
        { type: 'tool_result', tool_use_id: 'completed-call', content: 'synthetic output', toolUseResult: { status: 'completed', metadata: { interrupted: true } } },
      ]}/></ExpandKeyProvider></ThemeProvider>);
      expect(container.querySelector('[data-tool-row]')?.getAttribute('data-tool-lifecycle')).toBe('completed');
      expect(rowVerdicts(container)).toEqual(['succeeded']);
    });
  }
  it('terminal router preserves the full raw record for outcome and independent fields',()=>{
    const record={type:'terminal_stream',command:'demo',stream:'stderr',output:'warning bytes',error_code:'terminal-denied',interrupted:false,future:{zero:0,flag:false,nil:null},content:[{type:'text',text:'distinct-content'}]};
    const before=JSON.stringify(record);
    const {container}=render(<ThemeProvider><ExpandKeyProvider value="terminal-full"><ToolExecutionResultRouter toolResult={record}/></ExpandKeyProvider></ThemeProvider>);
    expect(rowVerdicts(container)).toEqual(['failed']);
    expect(container.textContent).toContain('terminal-denied');
    open(container);
    expect(container.textContent).toContain('warning bytes');
    expect(container.textContent).toContain('distinct-content');
    expect(container.textContent).toContain('"zero": 0');
    expect(container.textContent).toContain('"flag": false');
    expect(container.textContent).toContain('"nil": null');
    expect(JSON.stringify(record)).toBe(before);
  });
});
