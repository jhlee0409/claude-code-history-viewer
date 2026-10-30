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
    // C2: provider identity still routes fields, but completion alone proves no success.
    expect(rowVerdicts(container)).toEqual(['unknown','unknown']);
  });
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
