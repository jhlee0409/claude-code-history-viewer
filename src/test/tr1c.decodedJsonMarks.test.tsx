import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@/contexts/theme';
import { ResultProviderContext } from '@/components/transcript/resultProvider';
import { ExpandKeyProvider } from '@/contexts/CaptureExpandContext';
import { useExpandRegistry } from '@/store/expandRegistryStore';
import { UnifiedToolExecutionRenderer } from '@/components/contentRenderer/UnifiedToolExecutionRenderer';
import { ToolResultOutputs } from '@/components/transcript/ToolResultOutputs';
import { OutputBlock } from '@/components/transcript/OutputBlock';
import { copyTextToClipboard } from '@/utils/clipboard';
import i18n from '@/i18n';
vi.mock('@/utils/clipboard',()=>({copyTextToClipboard:vi.fn().mockResolvedValue(undefined)}));
beforeAll(async()=>{await i18n.changeLanguage('en');});
beforeEach(()=>useExpandRegistry.getState().clearAll());
const values=[String.raw`C:\work\report.txt`,'say "quoted-value"','line-one\nline-two','tab-one\ttab-two'];
const spell=(s:string)=>JSON.stringify(s).slice(1,-1);
function openAll(container:HTMLElement){for(let i=0;i<30;i++){const b=container.querySelector<HTMLElement>('button[aria-expanded="false"]');if(!b)break;fireEvent.click(b);}}
function Shell({children}:{children:React.ReactNode}){return <ThemeProvider><ResultProviderContext.Provider value="codex"><ExpandKeyProvider value="decoded-json">{children}</ExpandKeyProvider></ResultProviderContext.Provider></ThemeProvider>;}
for(const value of values)for(const route of ['default','bash','result']){
 it(`${route}: maps ${JSON.stringify(value)} without changing JSON display/copy`,()=>{
  const data={nested:[value,value,value],flag:false,zero:0};const original=JSON.stringify(data,null,2);
  const view=(query:string,index=1)=><Shell>{route==='result'?<ToolResultOutputs results={[{content:{stdout:'done',...data}}]} family="process" expandKey="result" searchQuery={query} highlight={{isCurrentMatch:true,currentMatchIndex:index}}/>:<UnifiedToolExecutionRenderer toolUse={{id:'json',name:route==='bash'?'Bash':'mcp__probe__opaque',input:route==='bash'?{command:'pwd',...data}:data}} toolResults={[]} searchQuery={query} isCurrentMatch currentMatchIndex={index}/>}</Shell>;
  const {container,rerender}=render(view(value));openAll(container);
  const pre=()=>[...container.querySelectorAll<HTMLElement>('[data-output-text]')].find(n=>n.textContent?.includes('"nested"'))!;
  expect(pre().textContent).toBe(original);
  expect([...pre().querySelectorAll('mark')].map(n=>n.textContent)).toEqual([spell(value),spell(value),spell(value)]);
  expect(pre().querySelector('mark[aria-current="true"]')?.textContent).toBe(spell(value));
  expect([...pre().querySelectorAll('mark')].indexOf(pre().querySelector('mark[aria-current="true"]')!)).toBe(1);
  fireEvent.click(pre().closest('[data-output]')!.querySelector('button')!);
  expect(copyTextToClipboard).toHaveBeenLastCalledWith(original);
  rerender(view('absent'));expect(pre().textContent).toBe(original);expect(pre().querySelectorAll('mark')).toHaveLength(0);
  expect(JSON.stringify(data,null,2)).toBe(original);
 });
}
it('MCP missing identifiers are localized in Korean and locale is restored',async()=>{
 const {MCPRenderer}=await import('@/components/toolResultRenderer/MCPRenderer');
 const previous=i18n.language;
 try{await act(async()=>{await i18n.changeLanguage('ko');});const {container}=render(<Shell><MCPRenderer mcpData={{type:'mcp_tool_call'}}/></Shell>);openAll(container);expect(container.textContent).toContain('알 수 없음.알 수 없음');expect(container.textContent).not.toContain('unknown.unknown');}
 finally{await act(async()=>{await i18n.changeLanguage(previous);});}
});
// Static raw JSON exercises the same boundary without a source-owned JS value.
it('static JSON maps escapes and UTF-16 offsets, excludes keys and never joins tokens',()=>{
 const raw=String.raw`{"C:\\key":"İ prefix \uD83D\uDE00 \u0061\u0062\u0061\u0062\u0061","other":["tail","head"],"flag":false,"n":120}`;
 const view=(query:string)=><Shell><OutputBlock text={raw} searchQuery={query} highlight={{isCurrentMatch:true,currentMatchIndex:0}} json /></Shell>;
 const {container,rerender}=render(view('😀'));const pre=()=>container.querySelector('[data-output-text]')!;
 expect(pre().textContent).toBe(raw);expect(pre().querySelector('mark')?.textContent).toBe(String.raw`\uD83D\uDE00`);
 for(const [query,marks] of [['ABa',[String.raw`\u0061\u0062\u0061`]],['false',['false']],['20',['20']],[String.raw`C:\key`,[]],['tail\nhead',[]],['"other"',[]]] as [string,string[]][]){rerender(view(query));expect([...pre().querySelectorAll('mark')].map(n=>n.textContent)).toEqual(marks);expect(pre().textContent).toBe(raw);}
});
it('malformed JSON stays exact with no guessed token marks',()=>{
 const raw='{"broken":"needle';const {container}=render(<Shell><OutputBlock text={raw} searchQuery="needle" highlight={{}} json /></Shell>);expect(container.querySelector('[data-output-text]')?.textContent).toBe(raw);expect(container.querySelectorAll('mark')).toHaveLength(0);
});
