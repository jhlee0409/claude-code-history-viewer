// Raw repository-authored legacy records -> real server -> app search/ToolRow.
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { webkit } from 'playwright';
import { startApp, openScenario } from './appSession.mjs';
import { browserRequirement } from './requirements.mjs';
import { createActions } from '../lib/actions.mjs';
import { settle } from '../lib/browser.mjs';
import { expandScenarios, inspectorStorage } from '../scenarios.mjs';
const enabled=browserRequirement({webkit:true,server:true},{label:'botResultRegressions.test'}).enabled;
let app,browser;
const files=['alpha-match.ts','beta-match.ts',...Array.from({length:9},(_,i)=>`ordinary-${i}.ts`),'tail-match.ts'];
const output=Array.from({length:20},(_,i)=>`line-${i}`).join('\n')+'\nvis\u001b[31mible-hit\u001b[0m\nsecond-visible\nunindexed-\u001b[31mhit\u001b[0m';
function plant(fixture){
 const target=fixture.namedSessions['unknown-outcome'];
 const project=fixture.projects.find(p=>p.name===target.project);
 const session=project.sessions.find(s=>s.title===target.title);
 const raw=fs.readFileSync(session.filePath,'utf8').trim().split('\n').map(JSON.parse);
 const template=raw.find(r=>r.type==='user');
 const question={...template,uuid:'bot-question',message:{role:'user',content:session.title}};
 const record=(uuid,toolUseResult,content='')=>({...template,uuid,parentUuid:'bot-question',message:{role:'user',content},toolUseResult});
 const records=[question,
 record('bot-terminal',{type:'terminal_stream',command:'bot command',stream:'stderr',output:'warning-terminal',error_code:'terminal-denied',future:{flag:false,nil:null,zero:0}}),
 record('bot-mcp',{server:'filesystem',method:'read',error:'permission denied',result:{retained:'independent-result'}}),
 // Content supplies a real indexed source value. relevant_files itself is NOT indexed.
 record('bot-context',{files_analyzed:12,relevant_files:files,content:'alpha-match beta-match tail-match'}),
 // Plain content is an actual indexed positive; the split-only control below is not indexed.
 record('bot-ansi',{stdout:output,content:'visible-hit second-visible'})];
 fs.writeFileSync(session.filePath,records.map(JSON.stringify).join('\n')+'\n');
}
beforeAll(async()=>{if(!enabled)return;app=await startApp('bot-result-regressions');plant(app.fixture);browser=await webkit.launch();},240000);
afterAll(async()=>{await browser?.close();await app?.stop();});
async function setup(c){const id=`transcript-unknown-outcome--${c.viewport}--dark`;const s=await openScenario(browser,app,id,{locale:c.locale,variant:c.variant,storage:c.inspector?inspectorStorage({open:true}):{}});const run=createActions({session:s,scenario:expandScenarios().find(s=>s.id===id),manifest:app.fixture,t:s.t});return {s,run};}
async function shot(s,c,label){if(process.env.TR1C_BOT_SHOTS){fs.mkdirSync(process.env.TR1C_BOT_SHOTS,{recursive:true});await s.page.screenshot({path:path.join(process.env.TR1C_BOT_SHOTS,`${c.id}-${label}.png`)});}}
/* global document, innerWidth */
describe.skipIf(!enabled)('TR1c bot result regressions in raw WebKit',()=>{
 for(const c of [{id:'390en',viewport:'390x844',locale:'en',variant:{}},{id:'390ko125',viewport:'390x844',locale:'ko',variant:{fontScale:1.25}},{id:'1180inspector',viewport:'1180x760',locale:'en',variant:{},inspector:true}]){
  it(`${c.id} terminal complete record and MCP failure/target`,async()=>{
   const {s,run}=await setup(c);try{
    const terminal=s.page.locator('[data-message-uuid="bot-terminal"]');
    expect(await terminal.locator('[data-tool-row]').getAttribute('data-tool-verdict')).toBe('failed');
    expect(await terminal.innerText()).toContain('terminal-denied');
    const mcp=s.page.locator('[data-message-uuid="bot-mcp"]');
    expect(await mcp.locator('[data-tool-row]').getAttribute('data-tool-verdict')).toBe('failed');
    expect(await mcp.locator('[data-tool-row] [data-row-target]').innerText()).toBe('filesystem.read');
    await run({do:'expandToolRows',match:['bot command','terminal-denied','filesystem.read'],limit:2});
    expect(await terminal.innerText()).toContain('"nil": null');
    expect(await mcp.innerText()).toContain('independent-result');
    await mcp.scrollIntoViewIfNeeded();await settle(s);await shot(s,c,'outcomes');
    expect(await s.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(s.log.pageErrors).toEqual([]);
   }finally{await s.close();}
  },120000);
  it(`${c.id} counted filename queries reveal inner/cap, manual collapse and query switch`,async()=>{
   const {s,run}=await setup(c);try{
    const counter=s.page.locator('#main-content span').filter({hasText:/^\d+\/\d+$/}).first();
    for(const query of ['alpha-match','beta-match','tail-match']){
     await run({do:'transcriptSearch',query});expect(await counter.innerText()).toMatch(/^[1-9]\d*\/[1-9]\d*$/);
     const row=s.page.locator('[data-message-uuid="bot-context"]');
     const b=row.getByRole('button',{name:s.t('codebaseContextRenderer.relevantFiles').replace('{{count}}','12'),exact:true});
     expect(await b.getAttribute('aria-expanded')).toBe('true');
     expect(await row.locator('mark').filter({hasText:query}).count()).toBeGreaterThan(0);
     await b.click();await settle(s);expect(await b.getAttribute('aria-expanded')).toBe('false');
    }
    await run({do:'transcriptSearch',query:'visible-hit'});expect(await counter.innerText()).toMatch(/^[1-9]\d*\/[1-9]\d*$/);
    const row=s.page.locator('[data-message-uuid="bot-ansi"]');
    const output=row.locator('[data-output]').first();
    expect(await output.locator('button[aria-expanded]').getAttribute('aria-expanded')).toBe('true');
    expect(await output.locator('mark').innerText()).toBe('visible-hit');
    await output.scrollIntoViewIfNeeded();await settle(s);await shot(s,c,'search');
    const cap=output.locator('button[aria-expanded]');await cap.click();await settle(s);expect(await cap.getAttribute('aria-expanded')).toBe('false');
    await run({do:'transcriptSearch',query:'second-visible'});expect(await cap.getAttribute('aria-expanded')).toBe('true');
    await run({do:'transcriptSearch',query:'unindexed-hit'});expect(await counter.count()).toBe(0);
    await run({do:'transcriptSearch',query:'relevant_files'});expect(await counter.count()).toBe(0);
    if(c.inspector)expect(await s.page.locator('#inspector').evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThan(0);
    expect(s.log.pageErrors).toEqual([]);
   }finally{await s.close();}
  },120000);
 }
});
