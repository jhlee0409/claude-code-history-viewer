// Authored raw JSONL, real unchanged server, production WebKit; no invented API data.
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { webkit } from 'playwright';
import { startApp, openScenario } from './appSession.mjs';
import { browserRequirement } from './requirements.mjs';
import { createActions } from '../lib/actions.mjs';
import { settle } from '../lib/browser.mjs';
import { expandScenarios, inspectorStorage } from '../scenarios.mjs';
const enabled=browserRequirement({webkit:true,server:true},{label:'botRound2Regressions.test'}).enabled;
const values=[String.raw`C:\work\report.txt`,'say "quoted-value"'];
let app,browser;
function plant(fixture){
 const target=fixture.namedSessions['unknown-outcome'],project=fixture.projects.find(p=>p.name===target.project),session=project.sessions.find(s=>s.title===target.title);
 const template=fs.readFileSync(session.filePath,'utf8').trim().split('\n').map(JSON.parse).find(r=>r.type==='user');
 const record=(uuid,toolUseResult)=>({...template,uuid,parentUuid:'round2-question',message:{role:'user',content:''},toolUseResult});
 const padding=Array.from({length:20},(_,i)=>`line-${i}`).join('\n');
 const raw=[{...template,uuid:'round2-question',message:{role:'user',content:session.title}},
 record('round2-mcp',{server:'files',method:'read',function:'independent-alias',params:false,result:0}),
 record('round2-terminal',{type:'terminal_stream',command:'round2-terminal-command',output:{message:'object-output'},content:{stdout:'inner-second',exitCode:7,interrupted:false,isImage:false},future:{nil:null,flag:false,zero:0}}),
 ...values.map((v,i)=>record(`round2-search-${i}`,{stdout:padding+'\n'+v+'\nnext-query'})),
 record('round2-nested',{payload:[{parts:[String.raw`D:\nested\"quoted".txt`,'line-one\nline-two','tab-one\ttab-two']}],key_only_round2:'ordinary'}),
 record('round2-ansi',{stdout:'split-\u001b[31monly\u001b[0m'})];
 fs.writeFileSync(session.filePath,raw.map(JSON.stringify).join('\n')+'\n');
}
beforeAll(async()=>{if(!enabled)return;app=await startApp('bot-round2');plant(app.fixture);browser=await webkit.launch();},240000);
afterAll(async()=>{await browser?.close();await app?.stop();});
async function setup(c){const id=`transcript-unknown-outcome--${c.viewport}--dark`;const s=await openScenario(browser,app,id,{locale:c.locale,variant:c.variant,storage:c.inspector?inspectorStorage({open:true}):{}});const run=createActions({session:s,scenario:expandScenarios().find(x=>x.id===id),manifest:app.fixture,t:s.t});return{s,run};}
async function shot(s,c,label){if(process.env.TR1C_ROUND2_SHOTS){fs.mkdirSync(process.env.TR1C_ROUND2_SHOTS,{recursive:true});await s.page.screenshot({path:path.join(process.env.TR1C_ROUND2_SHOTS,`${c.id}-${label}.png`)});}}
/* global document, innerWidth */
describe.skipIf(!enabled)('TR1c second bot round raw production route',()=>{
 for(const c of [{id:'390en',viewport:'390x844',locale:'en',variant:{}},{id:'390ko125',viewport:'390x844',locale:'ko',variant:{fontScale:1.25}},{id:'1180inspector',viewport:'1180x760',locale:'en',variant:{},inspector:true}]){
  it(`${c.id}: MCP aliases and nested/structured terminal records survive`,async()=>{
   const {s,run}=await setup(c);try{
    await run({do:'expandToolRows',match:['files.read',s.t('terminalStreamRenderer.title')],limit:2});
    const mcp=s.page.locator('[data-message-uuid="round2-mcp"]');expect(await mcp.innerText()).toContain('"function": "independent-alias"');
    const terminal=s.page.locator('[data-message-uuid="round2-terminal"]');expect(await terminal.innerText()).toContain('"message": "object-output"');expect(await terminal.innerText()).toContain('"exitCode": 7');expect(await terminal.innerText()).toContain('"interrupted": false');
    expect(await terminal.locator('[data-tool-row]').getAttribute('data-tool-verdict')).toBe('unknown');
    await terminal.scrollIntoViewIfNeeded();await settle(s);await shot(s,c,'preservation');
    expect(await s.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(s.log.pageErrors).toEqual([]);
   }finally{await s.close();}
  },120000);
  it(`${c.id}: counted decoded searches reveal and mark beyond cap`,async()=>{
   const {s,run}=await setup(c);try{
    const counter=s.page.locator('#main-content span').filter({hasText:/^\d+\/\d+$/}).first();
    for(const [i,query] of values.entries()){
     await run({do:'transcriptSearch',query});expect(await counter.innerText()).toMatch(/^[1-9]\d*\/[1-9]\d*$/);
     const row=s.page.locator(`[data-message-uuid="round2-search-${i}"]`);const outer=row.locator('[data-tool-row] button[aria-expanded]').first();expect(await outer.getAttribute('aria-expanded')).toBe('true');
     expect(await row.locator('[data-output] button[aria-expanded]').first().getAttribute('aria-expanded')).toBe('true');expect(await row.locator('mark').innerText()).toBe(query);
     await row.scrollIntoViewIfNeeded();await settle(s);await shot(s,c,`search-${i}`);
     await outer.click();await settle(s);expect(await outer.getAttribute('aria-expanded')).toBe('false');
    }
    for(const query of ['key_only_round2','split-only']){await run({do:'transcriptSearch',query});expect(await counter.count()).toBe(0);}
    if(c.inspector)expect(await s.page.locator('#inspector').evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThan(0);
    expect(s.log.pageErrors).toEqual([]);
   }finally{await s.close();}
  },120000);
 }
 it('unchanged backend searches decoded nested arrays, escapes, newline and tab values; not keys or split-only ANSI',async()=>{
  for(const query of [String.raw`D:\nested\"quoted".txt`,'line-one\nline-two','tab-one\ttab-two',...values]){
   const response=await fetch(app.server.origin+'/api/search_messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({claudePath:path.join(app.fixture.home,'.claude'),query})});expect(response.status).toBe(200);const data=await response.json();expect(Array.isArray(data)).toBe(true);expect(data.some(x=>x.uuid.startsWith('round2-'))).toBe(true);
  }
  for(const query of ['key_only_round2','split-only']){const response=await fetch(app.server.origin+'/api/search_messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({claudePath:path.join(app.fixture.home,'.claude'),query})});expect(response.status).toBe(200);expect(await response.json()).toEqual([]);}
 },120000);
});
