import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
const ROOT=process.cwd();
const DIRS=['contentRenderer','toolResultRenderer','messageRenderer','renderers'].map(d=>join(ROOT,'src/components',d));
const EXTRA=[join(ROOT,'src/components/FileContent.tsx'),join(ROOT,'src/shared/RendererHeader.tsx')];
function files(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?files(join(dir,d.name)):/\.tsx?$/.test(d.name)&&!d.name.includes('.test.')?[join(dir,d.name)]:[]);}
const sourceFiles=[...DIRS.flatMap(files),...EXTRA];
function findings(file:string,text:string){const sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const found:string[]=[];
function walk(n:ts.Node){if((ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n))&&n.tagName.getText(sf)==='button')found.push(`${relative(ROOT,file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line+1} raw button`);ts.forEachChild(n,walk);}walk(sf);return found;}
describe('TR1c owned renderer shell/control invariant',()=>{
 it('catches actual JSX, not comments or strings',()=>{expect(findings('probe.tsx','const x=<button onClick={()=>{}}>open</button>')).toHaveLength(1);expect(findings('probe.tsx','const x="<button>"; // <button>')).toEqual([]);});
 it('links every renderer disclosure to its content',()=>{
  const missing:string[]=[];
  for(const file of sourceFiles){const sf=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);function visit(n:ts.Node){if(ts.isJsxOpeningElement(n)&&n.tagName.getText(sf)==='Button'){
    const attrs=n.attributes.properties.filter(ts.isJsxAttribute);const click=attrs.find(a=>a.name.getText(sf)==='onClick');
    if(click&&/set(?:Is\w*Expanded|Show\w+|Expanded|Open)|onToggle|toggle/.test(click.getText(sf))){
      for(const name of ['aria-expanded','aria-controls'])if(!attrs.some(a=>a.name.getText(sf)===name))missing.push(`${relative(ROOT,file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line+1} ${name}`);
    }
   }ts.forEachChild(n,visit);}visit(sf);
  }expect(missing).toEqual([]);
 });
 it('has no raw buttons in owned renderer scope',()=>{expect(sourceFiles.flatMap(f=>findings(f,readFileSync(f,'utf8')))).toEqual([]);});
 it('has no old heads in tool result modules (non-tool bodies are explicitly retained)',()=>{
 const toolFiles=files(join(ROOT,'src/components/toolResultRenderer')).concat([join(ROOT,'src/components/messageRenderer/ToolExecutionResultRouter.tsx'),join(ROOT,'src/components/FileContent.tsx')]);
 const imports=toolFiles.flatMap(f=>{const sf=ts.createSourceFile(f,readFileSync(f,'utf8'),ts.ScriptTarget.Latest,true);const matches:string[]=[];function visit(n:ts.Node){if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier&&ts.isStringLiteral(n.moduleSpecifier)&&/RendererHeader|ToolUseCard|ToolResultCard|RendererCard/.test(n.moduleSpecifier.text))matches.push(relative(ROOT,f));ts.forEachChild(n,visit);}visit(sf);return matches;});expect(imports).toEqual([]);
 });
 it('removes only proven-dead modules; retains non-tool card/header owners for TR4/media',()=>{
 for(const f of ['src/components/renderers/RendererCard.tsx','src/components/contentRenderer/toolUseRenderers/ToolUseCard.tsx','src/components/messageRenderer/QueueOperationRenderer.tsx','src/components/messageRenderer/SummaryMessageRenderer.tsx','src/components/messageRenderer/AssistantMessageDetails.tsx'])expect(existsSync(join(ROOT,f)),f).toBe(false);
 for(const f of ['src/shared/RendererHeader.tsx','src/components/contentRenderer/ToolResultCard.tsx','src/components/contentRenderer/DocumentRenderer.tsx','src/components/contentRenderer/RedactedThinkingRenderer.tsx'])expect(existsSync(join(ROOT,f)),f).toBe(true);
 });
});
