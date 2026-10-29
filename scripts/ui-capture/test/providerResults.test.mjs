// TR1c: actual Codex raw #749 records → HTTP → desktop/phone content dispatcher.
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { webkit } from 'playwright';
import { startApp, openScenario } from './appSession.mjs';
import { browserRequirement } from './requirements.mjs';
import { createActions } from '../lib/actions.mjs';
import { settle } from '../lib/browser.mjs';
import { expandScenarios, inspectorStorage } from '../scenarios.mjs';
const enabled = browserRequirement({webkit:true,server:true},{label:'providerResults.test'}).enabled;
let app, browser;
function plant(fixture) {
  const project=fixture.projects.find(p=>p.provider==='codex');const session=project.sessions[0];
  const old=fs.readFileSync(session.filePath,'utf8').trim().split('\n').map(JSON.parse);
  const meta=old.find(r=>r.type==='session_meta');
  const question=old.find(r=>r.type==='response_item' && r.payload?.type==='message' && r.payload?.role==='user' && r.payload.content?.some(b=>b.text===session.title));
  const records=fs.readFileSync('src-tauri/tests/fixtures/tool-result-metadata-codex-structured.jsonl','utf8').trim().split('\n').map(JSON.parse).slice(1);
  fs.writeFileSync(session.filePath,[meta,question,...records].map(JSON.stringify).join('\n')+'\n');
  fixture.namedSessions['unknown-outcome']={project:project.name,title:session.title};
  return session;
}
beforeAll(async()=>{if(!enabled)return;app=await startApp('provider-results');plant(app.fixture);browser=await webkit.launch();},240000);
afterAll(async()=>{await browser?.close();await app?.stop();});
/* global document, innerWidth */
describe.skipIf(!enabled)('TR1c source-grounded provider result reachability (real WebKit)',()=>{
 for(const c of [
  {id:'390en',viewport:'390x844',locale:'en',variant:{}},
  {id:'390ko125',viewport:'390x844',locale:'ko',variant:{fontScale:1.25}},
  {id:'1180inspector',viewport:'1180x760',locale:'en',variant:{inspector:'open'}},
 ]) it(c.id,async()=>{
  const id=`transcript-unknown-outcome--${c.viewport}--dark`;
  const s=await openScenario(browser,app,id,{locale:c.locale,variant:c.variant,storage:c.id==='1180inspector'?inspectorStorage({open:true}):{}});
  try {
   const run=createActions({session:s,scenario:expandScenarios().find(s=>s.id===id),manifest:app.fixture,t:s.t});
   await run({do:'expandToolRows',match:['pwd'],limit:1});
   const zero=s.page.locator('[data-message-uuid="use-function"] [data-tool-row]');
   expect(await zero.getAttribute('data-tool-verdict')).toBe('succeeded');
   const replay=s.page.locator('[data-message-uuid="use-replay"] [data-tool-row]');
   expect(await replay.getAttribute('data-tool-lifecycle')).toBe('interrupted');
   await run({do:'transcriptSearch',query:'same'});
   const row=s.page.locator('[data-message-uuid="use-custom"] [data-tool-row-wrapper]').first();
   const toggle=row.locator('[data-tool-row] button[aria-expanded]').first();
   expect(await toggle.getAttribute('aria-expanded')).toBe('true');
   expect(await row.locator('mark').count()).toBeGreaterThan(0);
   const counter=s.page.locator('#main-content span').filter({hasText:/^\d+\/\d+$/}).first();
   expect(await counter.innerText()).toMatch(/^[1-9]\d*\/[1-9]\d*$/);
   await toggle.click();await settle(s);expect(await toggle.getAttribute('aria-expanded')).toBe('false');
   await run({do:'transcriptSearch',query:'ame'});expect(await toggle.getAttribute('aria-expanded')).toBe('true');
   await row.scrollIntoViewIfNeeded();await settle(s);
   const copy=row.getByRole('button',{name:s.t('toolRow.copyToolId'),exact:true});
   await copy.scrollIntoViewIfNeeded();await settle(s);
   expect(await copy.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
   expect(await s.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   if(c.id==='1180inspector')expect(await s.page.locator('#inspector').evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThan(0);
   expect(s.log.pageErrors).toEqual([]);
   if(process.env.TR1C_SHOTS){fs.mkdirSync(process.env.TR1C_SHOTS,{recursive:true});await s.page.screenshot({path:path.join(process.env.TR1C_SHOTS,`${c.id}.png`)});}
  }finally{await s.close();}
 },120000);
});
