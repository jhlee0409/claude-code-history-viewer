import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { webkit } from 'playwright';
import { startApp, openScenario } from './appSession.mjs';
import { browserRequirement } from './requirements.mjs';
import { createActions } from '../lib/actions.mjs';
import { settle } from '../lib/browser.mjs';
import { expandScenarios, inspectorStorage } from '../scenarios.mjs';
const enabled=browserRequirement({webkit:true,server:true},{label:'decodedJsonMarks.test'}).enabled;
let app,browser;
const queries={default:String.raw`C:\default\value-report.txt`,bash:'say "bash-quoted"',result:String.raw`C:\retained\report.txt`};
export function plant(fixture){
 const target=fixture.namedSessions['unknown-outcome'],project=fixture.projects.find(p=>p.name===target.project),session=project.sessions.find(s=>s.title===target.title);
 const t=fs.readFileSync(session.filePath,'utf8').trim().split('\n').map(JSON.parse).find(r=>r.type==='user');
 const raw=[{...t,uuid:'json-question',message:{role:'user',content:session.title}}];
 for(const [route,query] of Object.entries(queries)){
  const data={padding:Array.from({length:17},(_,i)=>`padding-${i}`),zznested:[query,query,query],next:'next-'+route,key_only_json:'ordinary'};
  raw.push(route==='result'?{...t,uuid:'json-'+route,message:{role:'user',content:''},toolUseResult:{type:'terminal_stream',output:'done',content:{...data,exitCode:0}}}:{...t,type:'assistant',uuid:'json-'+route,message:{role:'assistant',content:[{type:'tool_use',id:'json-tool-'+route,name:route==='bash'?'Bash':'mcp__probe__opaque',input:route==='bash'?{command:'pwd',...data}:data}]}});
 }
 fs.writeFileSync(session.filePath,raw.map(JSON.stringify).join('\n')+'\n');
}
beforeAll(async()=>{if(!enabled)return;app=await startApp('decoded-json');plant(app.fixture);browser=await webkit.launch();},240000);
afterAll(async()=>{await browser?.close();await app?.stop();});
/* global document */
describe.skipIf(!enabled)('decoded retained JSON: raw server and production WebKit',()=>{
 for(const c of [{id:'390en',viewport:'390x844',locale:'en',variant:{}},{id:'390ko125',viewport:'390x844',locale:'ko',variant:{fontScale:1.25}},{id:'1180inspector',viewport:'1180x760',locale:'en',variant:{},inspector:true}])it(c.id,async()=>{
  const id=`transcript-unknown-outcome--${c.viewport}--dark`,s=await openScenario(browser,app,id,{locale:c.locale,variant:c.variant,storage:c.inspector?inspectorStorage({open:true}):{}});
  const run=createActions({session:s,scenario:expandScenarios().find(x=>x.id===id),manifest:app.fixture,t:s.t});
  const observations=[];
  try{
   for(const [route,query] of Object.entries(queries)){
    await run({do:'transcriptSearch',query});
    const row=s.page.locator(`[data-message-uuid="json-${route}"]`);await row.scrollIntoViewIfNeeded();await settle(s);
    const counter=s.page.locator('#main-content span').filter({hasText:/^\d+\/\d+$/}).first();
    const record={route,query,counter:await counter.count()?await counter.innerText():null,marks:await row.locator('mark').allTextContents(),text:await row.innerText()};observations.push(record);
    // Retained result values are not indexed by current session search. They
    // still reveal/mark through the propagated query; do not invent a counter.
    if(route==='result')expect(record.counter).toBe(null);else expect(record.counter).toBe('2/3');
    expect(record.marks).toEqual(Array(3).fill(JSON.stringify(query).slice(1,-1)));
    const pre=row.locator('[data-output-text]').filter({hasText:'"zznested"'}).first();
    const displayed=await pre.textContent();
    expect(JSON.parse(displayed).zznested).toEqual([query,query,query]);
    // Observe the app's exact copy-helper payload, not the OS clipboard.
    await s.page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__jsonCopy=text;}}});});
    await pre.locator('..').getByRole('button',{name:s.t('outputBlock.copy'),exact:true}).click();await settle(s);
    const copied=await s.page.evaluate(()=>window.__jsonCopy);expect(copied).toBe(displayed);record.displayJSON=displayed;record.copyPayload=copied;record.navigation=[];
    if(route==='result')expect(await row.locator('mark[aria-current="true"]').count()).toBe(0);
    else expect(await row.locator('mark[aria-current="true"]').evaluate(m=>[...m.parentElement.querySelectorAll('mark')].indexOf(m))).toBe(1);
    expect(await row.locator('[data-output] button[aria-expanded]').last().getAttribute('aria-expanded')).toBe('true');
    if(route!=='result'){
     for(const expected of [0,2,1]){
      const button=s.page.getByRole('button',{name:s.t('messageViewer.nextMatch')});
      await button.click();await settle(s);
      const current=await row.locator('mark[aria-current="true"]').evaluateAll(ms=>ms.map(m=>[...m.parentElement.querySelectorAll('mark')].indexOf(m)));
      // Enter advanced the counter to 2/3 (index 1); Next visits 0, 2, 1.
      expect(current).toEqual([expected]);record.navigation.push({counter:await counter.innerText(),current});
     }
    }
    const plain=route==='default'?'value-report':route==='bash'?'bash-quoted':'retained';
    await run({do:'transcriptSearch',query:plain});
    expect(await row.locator('mark').allTextContents()).toEqual([plain,plain,plain]);
    if(route!=='result')expect(await counter.innerText()).toBe('2/3');else expect(await counter.count()).toBe(0);
    record.plainQuery={query:plain,counter:await counter.count()?await counter.innerText():null,marks:await row.locator('mark').allTextContents()};
    const cap=row.locator('[data-output] button[aria-expanded]').last();
    await cap.click();await settle(s);expect(await cap.getAttribute('aria-expanded')).toBe('false');
    await run({do:'transcriptSearch',query:'next-'+route});expect(await cap.getAttribute('aria-expanded')).toBe('true');
    const outer=row.locator('[data-tool-row] button[aria-expanded]').first();await outer.click();await settle(s);expect(await outer.getAttribute('aria-expanded')).toBe('false');
    await run({do:'transcriptSearch',query});expect(await outer.getAttribute('aria-expanded')).toBe('true');
    await run({do:'transcriptSearch',query});await settle(s);
    if(process.env.TR1C_JSON_SHOTS){fs.mkdirSync(process.env.TR1C_JSON_SHOTS,{recursive:true});await row.screenshot({path:path.join(process.env.TR1C_JSON_SHOTS,`${c.id}-${route}.png`)});}
   }
   await run({do:'transcriptSearch',query:'key_only_json'});
   expect(await s.page.locator('#main-content span').filter({hasText:/^\d+\/\d+$/}).count()).toBe(0);
   expect(await s.page.locator('mark').count()).toBe(0);
   if(c.inspector)expect(await s.page.locator('#inspector').evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThan(0);
   expect(s.log.pageErrors).toEqual([]);
  }finally{
   if(process.env.TR1C_JSON_RECEIPTS){fs.mkdirSync(process.env.TR1C_JSON_RECEIPTS,{recursive:true});fs.writeFileSync(path.join(process.env.TR1C_JSON_RECEIPTS,c.id+'.json'),JSON.stringify({dist:app.dist,observations,pageErrors:s.log.pageErrors},null,2));}
   await s.close();
  }
 },120000);
});
