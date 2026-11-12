// Component-state shape controls derived from #749 public result blocks.
// These deliberately mutated content arrangements are NOT captured API responses.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@/contexts/theme';
import { ExpandKeyProvider } from '@/contexts/CaptureExpandContext';
import { useExpandRegistry } from '@/store/expandRegistryStore';
import { ClaudeContentArrayRenderer } from '@/components/contentRenderer/ClaudeContentArrayRenderer';
import { recordedResultFields } from '@/components/transcript/toolOutcome';
import i18n from '@/i18n';
import samples from './fixtures/tr1c/public-results.json';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGO4I2f0HwAFMgIsjP5jlwAAAABJRU5ErkJggg==';
const fixtures=samples as unknown as Record<string,{load_provider_messages:{content:unknown}[]}>;
const results=(p:string)=>fixtures[p]!.load_provider_messages.flatMap(m=>Array.isArray(m.content)?m.content.filter((b):b is Record<string,unknown>=>b.type==='tool_result'):[]);
beforeAll(async()=>{await i18n.changeLanguage('en');});
beforeEach(()=>useExpandRegistry.getState().clearAll());
describe('TR1c source metadata preservation',()=>{
 it('OpenCode output echo is not repeated in recorded fields; opaque metadata survives exactly',()=>{
  const r=results('opencode')[0]!;
  const retained=recordedResultFields(r,'opencode') as Record<string,unknown>;
  expect(retained).not.toHaveProperty('output');
  expect(retained.metadata).toEqual({unknown:'evidence-only-needle',null:null,false:false,zero:0,empty:''});
 });
 it('OpenCode 2.x content/error echoes are not repeated; metadata survives',()=>{
  const done={type:'tool_result',tool_use_id:'c',content:'line 1\nline 2',toolUseResult:{status:'completed',input:{command:'ls'},content:[{type:'text',text:'line 1'},{type:'text',text:'line 2'}],metadata:{exit:0}}};
  expect(recordedResultFields(done,'opencode')).toEqual({status:'completed',input:{command:'ls'},metadata:{exit:0}});
  const failed={type:'tool_result',tool_use_id:'c',content:'Could not find oldString',is_error:true,toolUseResult:{status:'error',input:{},error:{type:'tool.execution',message:'Could not find oldString'}}};
  expect(recordedResultFields(failed,'opencode')).toEqual({status:'error',input:{},error:{type:'tool.execution'}});
  const bare={...failed,toolUseResult:{status:'error',input:{},error:{message:'Could not find oldString'}}};
  expect(recordedResultFields(bare,'opencode')).toEqual({status:'error',input:{}});
  const withImage={type:'tool_result',tool_use_id:'c',content:'Image read',toolUseResult:{status:'completed',content:[{type:'text',text:'Image read'},{type:'file',uri:'data:image/png;base64,AA',mime:'image/png'}]}};
  expect(recordedResultFields(withImage,'opencode')).toHaveProperty('content');
 });
 it('Codex unrelated/null/false/zero/empty fields keep their raw values, not the output echo',()=>{
  const r=results('codex')[0]!;
  expect(recordedResultFields(r,'codex')).toEqual({future:{array:[],empty:'',false:false,null:null,zero:0},metadata:{interrupted:false}});
 });
 it('Pi opaque details are never an execution schema, including lookalike exit keys',()=>{
  const r=results('pi')[0]!;const own=r.toolUseResult as Record<string,unknown>;
  expect(recordedResultFields({...r,toolUseResult:{...own,details:{exitCode:9,cancelled:true}}},'pi')).toHaveProperty('details',{exitCode:9,cancelled:true});
 });
});
const arrangements=[['i','t'],['t','i','t'],['i','t','i','t','t'],['i','i','t','t'],['t','t','i','t','i']];
describe('TR1c provider-row mixed-part invariants (derived component controls)',()=>{
 for(const provider of ['codex','openhands','opencode','pi'])for(const shape of arrangements)it(`${provider} ${shape.join('→')}`,()=>{
  const template=results(provider)[0]!;
  const parts=shape.map((kind,i)=>kind==='t'?{type:'text',text:`part-${i}-needle`}:{type:'image',source:{type:'base64',media_type:'image/png',data:png}});
  const content=[{type:'tool_use',id:'control',name:'unknown_tool',input:{}},{...template,tool_use_id:'control',content:parts}];
  const {container}=render(<ThemeProvider><ExpandKeyProvider value={`mixed-${provider}`}><ClaudeContentArrayRenderer content={content} provider={provider}/></ExpandKeyProvider></ThemeProvider>);
  for(let n=0;n<30;n++){const b=container.querySelector<HTMLElement>('button[aria-expanded=false]');if(!b)break;fireEvent.click(b);}
  const ordered=[...container.querySelectorAll('img, [data-output] pre')].filter(el=>!el.closest('[data-recorded-result]')).flatMap(el=>el.tagName==='IMG'?['i']:(el.textContent?.match(/part-\d+-needle/g)??[]).map(()=> 't'));
  expect(ordered).toEqual(shape);
  for(const image of container.querySelectorAll('img'))expect(image.classList.contains('w-full')).toBe(false);
 });
});
