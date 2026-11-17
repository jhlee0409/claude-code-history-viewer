import { beforeAll, beforeEach, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@/contexts/theme';
import { ExpandKeyProvider } from '@/contexts/CaptureExpandContext';
import { useExpandRegistry } from '@/store/expandRegistryStore';
import { ToolExecutionResultRouter } from '@/components/messageRenderer/ToolExecutionResultRouter';
import { ResultProviderContext } from '@/components/transcript/resultProvider';
import i18n from '@/i18n';
import { resultContent, toolOutcome } from '@/components/transcript/toolOutcome';
beforeAll(async()=>{await i18n.changeLanguage('en');});
beforeEach(()=>useExpandRegistry.getState().clearAll());
function show(record:Record<string,unknown>,provider?:string){
 const before=JSON.stringify(record);
 const {container}=render(<ThemeProvider><ResultProviderContext.Provider value={provider}><ExpandKeyProvider value="round2"><ToolExecutionResultRouter toolResult={record}/></ExpandKeyProvider></ResultProviderContext.Provider></ThemeProvider>);
 for(let i=0;i<30;i++){const b=container.querySelector<HTMLElement>('button[aria-expanded="false"]');if(!b)break;fireEvent.click(b);}
 expect(JSON.stringify(record)).toBe(before);
 return container;
}
const text=(c:HTMLElement)=>c.textContent??'';
it('MCP preserves simultaneous method/function and non-renderable identifying values',()=>{
 const c=show({type:'mcp_tool_call',server:'files',method:'read',function:'independent-alias',params:false,result:0,future:{nil:null,flag:false,zero:0}});
 expect(text(c)).toContain('"function": "independent-alias"');
 expect(text(c)).toContain('"nil": null');expect(text(c)).toContain('"flag": false');expect(text(c)).toContain('"zero": 0');
});
for(const output of [{message:'object-output'},['array-output',false,null,0],null,false,0,'']){
 it(`terminal retains non-rendered output ${JSON.stringify(output)}`,()=>{
  const c=show({type:'terminal_stream',output,command:false,stream:null,timestamp:0,future:{nil:null,flag:false,zero:0}});
  const pre=[...c.querySelectorAll('[data-output-text]')].map(n=>n.textContent).join('\n');
  expect(pre).toContain(JSON.stringify({output},null,2).slice(2,-2).trim());
  expect(pre).toContain('"command": false');expect(pre).toContain('"stream": null');expect(pre).toContain('"timestamp": 0');
  expect(pre).not.toContain('[object Object]');
 });
}
for(const provider of ['codex','openinterpreter','claude','pi',undefined]){
 it(`${provider}: nested output retains its own facts without inventing outer provenance`,()=>{
  const record={type:'terminal_stream',output:'outer-first',content:{stdout:'inner-second',exitCode:7,interrupted:false,isImage:false},future:{last:'last-third'}};
  const c=show(record,provider);const s=text(c);
  expect(s).toContain('"exitCode": 7');expect(s).toContain('"interrupted": false');expect(s).toContain('"isImage": false');
  expect(s.indexOf('outer-first')).toBeLessThan(s.indexOf('inner-second'));expect(s.indexOf('inner-second')).toBeLessThan(s.indexOf('last-third'));
  expect(c.querySelector('[data-tool-row]')?.getAttribute('data-tool-verdict')).toBe('unknown');
 });
}
it('terminal null content remains recorded',()=>{expect(text(show({type:'terminal_stream',output:'outer',content:null}))).toContain('"content": null');});
for(const provider of ['codex','openinterpreter','claude','pi',undefined]){
 for(const outer of [{exitCode:0},{exitCode:3},{error_code:'outer-error'},{interrupted:true}]){
  it(`${provider} preserves nested siblings independently of outer ${JSON.stringify(outer)}`,()=>{
   const content={stdout:'inner',exitCode:7,metadata:{exit_code:9},future:{flag:false,nil:null,zero:0}};
   const c=show({type:'terminal_stream',...outer,content},provider);
   const recorded=[...c.querySelectorAll('[data-output-text]')].find(n=>n.textContent?.startsWith('{')&&n.textContent.includes('"metadata"'));
   expect(JSON.parse(recorded?.textContent??'null')).toEqual(provider==='pi'?content:{exitCode:7,metadata:{exit_code:9},future:{flag:false,nil:null,zero:0}});
   const verdict=c.querySelector('[data-tool-row]')?.getAttribute('data-tool-verdict');
   if('error_code' in outer)expect(verdict).toBe('failed');
   else if(provider==='pi')expect(verdict).toBe('unknown');
   else if('exitCode' in outer)expect(verdict).toBe(outer.exitCode===0?'succeeded':'failed');
   else expect(c.querySelector('[data-tool-row]')?.getAttribute('data-tool-lifecycle')).toBe('interrupted');
  });
 }
}
it('MCP preserves invalid identifier values rather than lossy String coercion',()=>{
 const c=show({type:'mcp_tool_call',server:{name:'opaque-server'},method:false,function:'fallback',params:null,result:false});
 const recorded=[...c.querySelectorAll('[data-output-text]')].find(n=>n.textContent?.includes('opaque-server'));
 expect(JSON.parse(recorded?.textContent??'null')).toEqual({server:{name:'opaque-server'},method:false});
 expect(text(c)).not.toContain('[object Object]');
});
for(const flag of [{interrupted:false},{isImage:false},{isImage:true}]){
 it(`stream content only consumes fields actually represented by the row: ${JSON.stringify(flag)}`,()=>{
  const content={stdout:'ordinary-stream',...flag};
  expect(resultContent({content}).parts).toEqual([{kind:'other',value:flag,generic:true}]);
 });
}
it('same-source normalized execution metadata still owns outcome; nested and sibling values cannot override it',()=>{
 for(const provider of ['codex','openinterpreter']){
  expect(toolOutcome(null,[{content:{type:'terminal_stream',content:{exitCode:7}},toolUseResult:{metadata:{exit_code:0},status:'failed'}}],'process',provider).verdict).toBe('succeeded');
  expect(toolOutcome(null,[{content:'first',toolUseResult:{metadata:{exit_code:0}}},{content:'second',toolUseResult:{metadata:{exit_code:7}}}],'process',provider).verdict).toBe('failed');
 }
});
