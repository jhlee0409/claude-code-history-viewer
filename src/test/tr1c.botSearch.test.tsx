import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { StrictMode, useEffect } from 'react';
import i18n from '@/i18n';
import { ThemeProvider } from '@/contexts/theme';
import { ExpandKeyProvider } from '@/contexts/CaptureExpandContext';
import { useExpandRegistry } from '@/store/expandRegistryStore';
import { DefaultCard } from '@/components/contentRenderer/unifiedCards/DefaultCard';
import { UnifiedToolExecutionRenderer } from '@/components/contentRenderer/UnifiedToolExecutionRenderer';
import { ToolExecutionResultRouter } from '@/components/messageRenderer/ToolExecutionResultRouter';
import { OutputBlock } from '@/components/transcript/OutputBlock';
import { ResultProviderContext } from '@/components/transcript/resultProvider';
beforeAll(async()=>{await i18n.changeLanguage('en');});
beforeEach(()=>useExpandRegistry.getState().clearAll());
const visible=(root:HTMLElement)=>{const n=root.cloneNode(true) as HTMLElement;n.querySelectorAll('[hidden]').forEach(x=>x.remove());return n;};
function Shell({children}:{children:React.ReactNode}) {return <ThemeProvider><ExpandKeyProvider value="bot-search">{children}</ExpandKeyProvider></ThemeProvider>;}

describe('bot blank-search work is lazy and bounded by stable data',()=>{
  for(const Component of [DefaultCard,UnifiedToolExecutionRenderer]) {
    it(`${Component.displayName ?? 'paired renderer'}: blank/whitespace never serializes search data and nonempty memoizes`,()=>{
      const input={description:'opaque-input'};const toolUse={type:'tool_use',id:'perf-id',name:'opaque_tool',input};
      const toolResults=[{content:'large-result-value'}];
      const spy=vi.spyOn(JSON,'stringify');
      const view=(query:string,current=false)=><Shell><ResultProviderContext.Provider value="pi"><Component toolUse={toolUse} toolResults={toolResults} searchQuery={query} isCurrentMatch={current}/></ResultProviderContext.Provider></Shell>;
      try {
        const {rerender,container}=render(view(''));
        rerender(view('   ',true));
        const searchCalls=()=>spy.mock.calls.filter(([v])=>v===input||v===toolUse||v===toolResults).length;
        expect(searchCalls()).toBe(0);
        rerender(view('large-result'));expect(searchCalls()).toBeGreaterThan(0);
        // Opened JSON input serialization is display work, not search work.
        const resultCalls=()=>spy.mock.calls.filter(([v])=>v===toolUse||v===toolResults).length;
        const count=resultCalls();rerender(view('large-result',true));expect(resultCalls()).toBe(count);
        expect(container.querySelector('[data-tool-row] button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('true');
        expect(visible(container).textContent).toContain('large-result-value');
      }finally{spy.mockRestore();}
    });
  }
});

describe('bot ANSI/search disclosure contracts (component controls, not index certification)',()=>{
  it('nonmatching ANSI zone retains colors while the matching sibling is marked',()=>{
    const {container}=render(<Shell><OutputBlock text={'\u001b[31mred-only\u001b[0m'} errorText={'\u001b[32mneedle-only\u001b[0m'} searchQuery="needle" highlight={{}}/></Shell>);
    const zones=container.querySelectorAll('[data-output-text]');
    expect(zones[0]?.querySelector('[style*="color"]')).not.toBeNull();
    expect(zones[0]?.querySelector('mark')).toBeNull();
    expect(zones[1]?.querySelector('mark')?.textContent).toBe('needle');
  });
  it('ANSI-split visible value reveals the outer record and beyond-cap output with per-query manual collapse',()=>{
    const text=Array.from({length:20},(_,i)=>`line-${i}`).join('\n')+'\nvis\u001b[31mible-hit\u001b[0m\nsecond-visible';
    const record={stdout:text};
    const view=(q:string)=><StrictMode><Shell><ToolExecutionResultRouter toolResult={record} searchQuery={q}/></Shell></StrictMode>;
    const {container,rerender}=render(view('visible-hit'));
    const outer=()=>container.querySelector<HTMLElement>('[data-tool-row] button[aria-expanded]')!;
    expect(outer().getAttribute('aria-expanded')).toBe('true');
    const cap=()=>container.querySelector<HTMLElement>('[data-output] button[aria-expanded]')!;
    expect(cap().getAttribute('aria-expanded')).toBe('true');
    expect(visible(container).querySelector('mark')?.textContent).toBe('visible-hit');
    fireEvent.click(cap());fireEvent.click(outer());
    expect(outer().getAttribute('aria-expanded')).toBe('false');
    rerender(view('second-visible'));
    expect(outer().getAttribute('aria-expanded')).toBe('true');expect(cap().getAttribute('aria-expanded')).toBe('true');
  });
  it('outer relevant-files and inner disclosure reveal each matching query, beyond ten, under actual StrictMode replay',()=>{
    let setups=0,cleanups=0;
    function Replay(){useEffect(()=>{setups++;return()=>{cleanups++;};},[]);return null;}
    const record={files_analyzed:12,relevant_files:['alpha-match.ts','beta-match.ts',...Array.from({length:9},(_,i)=>`ordinary-${i}.ts`),'tail-match.ts']};
    const view=(q:string)=><StrictMode><Shell><Replay/><ToolExecutionResultRouter toolResult={record} searchQuery={q}/></Shell></StrictMode>;
    const {container,rerender}=render(view('alpha-match'));
    const outer=()=>container.querySelector<HTMLElement>('[data-tool-row] button[aria-expanded]')!;
    const files=()=>[...container.querySelectorAll<HTMLElement>('button[aria-expanded]')].find(b=>b.textContent?.includes('Relevant Files'))!;
    expect(setups).toBe(2);expect(cleanups).toBe(1);
    expect(outer().getAttribute('aria-expanded')).toBe('true');expect(files().getAttribute('aria-expanded')).toBe('true');
    expect(visible(container).querySelector('mark')?.textContent).toBe('alpha-match');
    fireEvent.click(files());expect(files().getAttribute('aria-expanded')).toBe('false');
    rerender(view('alpha-match'));expect(files().getAttribute('aria-expanded')).toBe('false');
    rerender(view('beta-match'));expect(files().getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(files());fireEvent.click(outer());
    rerender(view('tail-match'));expect(outer().getAttribute('aria-expanded')).toBe('true');expect(files().getAttribute('aria-expanded')).toBe('true');
    expect(visible(container).querySelector('mark')?.textContent).toBe('tail-match');
    fireEvent.click(files());rerender(view('   '));expect(files().getAttribute('aria-expanded')).toBe('false');
    rerender(view(''));expect(files().getAttribute('aria-expanded')).toBe('false');
  });
});
