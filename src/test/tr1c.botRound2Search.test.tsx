import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@/contexts/theme';
import { ExpandKeyProvider } from '@/contexts/CaptureExpandContext';
import { useExpandRegistry } from '@/store/expandRegistryStore';
import { ToolExecutionResultRouter } from '@/components/messageRenderer/ToolExecutionResultRouter';
import { ResultProviderContext } from '@/components/transcript/resultProvider';
import { DefaultCard } from '@/components/contentRenderer/unifiedCards/DefaultCard';
import { UnifiedToolExecutionRenderer } from '@/components/contentRenderer/UnifiedToolExecutionRenderer';
import { resultSearchText } from '@/components/transcript/resultSearchText';
import i18n from '@/i18n';
beforeAll(async()=>{await i18n.changeLanguage('en');});
beforeEach(()=>useExpandRegistry.getState().clearAll());
const values=[String.raw`C:\work\report.txt`,'say "quoted-value"','line-one\nline-two','tab-one\ttab-two'];
function Shell({children}:{children:React.ReactNode}){return <ThemeProvider><ResultProviderContext.Provider value="codex"><ExpandKeyProvider value="round2-search">{children}</ExpandKeyProvider></ResultProviderContext.Provider></ThemeProvider>;}
for(const value of values){
 it(`decoded nested value is searchable without mutating source: ${JSON.stringify(value)}`,()=>{
  const data={nested:[{parts:[value,'\u001b[31mansi-value\u001b[0m']}],nil:null,flag:false,zero:0};const original=JSON.stringify(data);
  expect(resultSearchText(data)).toContain(value);expect(resultSearchText(data)).toContain('ansi-value');expect(resultSearchText(data)).toContain('"nested"');expect(JSON.stringify(data)).toBe(original);
 });
 for(const Component of [DefaultCard,UnifiedToolExecutionRenderer]){
  it(`${Component.displayName}: decoded result reveals and marks past-cap, manual collapse/query switch`,()=>{
   const results=[{content:{stdout:Array.from({length:20},(_,i)=>`line-${i}`).join('\n')+'\n'+value+'\nnext-query'}}];
   const toolUse={id:'round2-result',name:'opaque_tool',input:{description:'ordinary'}};
   const view=(q:string)=><Shell><Component toolUse={toolUse} toolResults={results} searchQuery={q}/></Shell>;
   const {container,rerender}=render(view(value));
   const outer=()=>container.querySelector<HTMLElement>('[data-tool-row] button[aria-expanded]')!;
   expect(outer().getAttribute('aria-expanded')).toBe('true');
   expect([...container.querySelectorAll('[data-output-text]')].some(n=>n.textContent?.includes(value))).toBe(true);
   expect([...container.querySelectorAll('mark')].map(n=>n.textContent).join('')).toContain(value);
   fireEvent.click(outer());expect(outer().getAttribute('aria-expanded')).toBe('false');rerender(view(value));expect(outer().getAttribute('aria-expanded')).toBe('false');
   rerender(view('next-query'));expect(outer().getAttribute('aria-expanded')).toBe('true');
  });
 }
 it('RecordedResult reveals decoded stream values',()=>{const {container}=render(<Shell><ToolExecutionResultRouter toolResult={{stdout:value}} searchQuery={value}/></Shell>);expect(container.querySelector('[data-tool-row] button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('true');expect(container.querySelector('mark')?.textContent).toBe(value);});
 it('Default input uses decoded values for reveal',()=>{const {container}=render(<Shell><DefaultCard toolUse={{id:'input-only',name:'opaque_tool',input:{description:value}}} toolResults={[]} searchQuery={value}/></Shell>);expect(container.querySelector('[data-tool-row] button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('true');});
}
it('undefined serializer remains empty',()=>{expect(resultSearchText(undefined)).toBe('');});
it('blank search never serializes results at shared consumers',()=>{
 const input={description:'ordinary'},toolUse={id:'blank',name:'opaque_tool',input},toolResults=[{content:'result'}];const spy=vi.spyOn(JSON,'stringify');
 try{render(<Shell><DefaultCard toolUse={toolUse} toolResults={toolResults} searchQuery="  "/><UnifiedToolExecutionRenderer toolUse={toolUse} toolResults={toolResults} searchQuery=""/></Shell>);expect(spy.mock.calls.filter(([v])=>v===input||v===toolUse||v===toolResults)).toEqual([]);}finally{spy.mockRestore();}
});
