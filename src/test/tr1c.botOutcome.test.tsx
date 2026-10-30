import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@/contexts/theme';
import { ExpandKeyProvider } from '@/contexts/CaptureExpandContext';
import { useExpandRegistry } from '@/store/expandRegistryStore';
import { ToolExecutionResultRouter } from '@/components/messageRenderer/ToolExecutionResultRouter';
import { normalizeResult, toolOutcome } from '@/components/transcript/toolOutcome';
import type { ToolFamily, ToolResultLike } from '@/components/transcript/toolOutcome';
import i18n from '@/i18n';
beforeAll(async()=>{await i18n.changeLanguage('en');});
beforeEach(()=>useExpandRegistry.getState().clearAll());
const completed={content:'Error handling guide: ordinary file contents',toolUseResult:{status:'completed'}};
describe('bot source evidence precedence',()=>{
  for(const provider of ['opencode','kilo']) {
    for(const family of ['read-search','other','process'] as ToolFamily[]) it(`${provider} ${family}: named built-in completion is no-error; process completion is lifecycle (C1/C2)`,()=>{
      const use={name:family==='read-search'?'read':family==='other'?'edit':'bash'};
      // Normal return -> completed; thrown failure -> error (not bash exit semantics):
      // https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/session/prompt.ts#L1115-L1160
      expect(toolOutcome(use,[completed],family,provider)).toMatchObject({verdict:family==='process'?'unknown':'succeeded',reason:family==='process'?'no-exit-code':'no-error-signal'});
      expect(toolOutcome(use,[completed,{content:'Error: sibling failure'}],family,provider)).toMatchObject({verdict:'unknown'});
      expect(toolOutcome(use,[completed,{...completed,content:'second completed text'}],family,provider).verdict).toBe(family==='process'?'unknown':'succeeded');
      for(const explicit of [{is_error:true},{content:{error_code:'explicit-code'}}])expect(toolOutcome(use,[{...completed,...explicit}],family,provider).verdict).toBe('failed');
      expect(toolOutcome(use,[completed,{content:'unknown sibling'}],family,provider).verdict).toBe('unknown');
      expect(toolOutcome(use,[completed,{content:'failed state',toolUseResult:{status:'error'}}],family,provider).verdict).toBe('failed');
    });
  }
  it('recorded process exits keep precedence over prose; explicit errors still conflict',()=>{
    for(const exitCode of [0,2]) {
      const result={content:'Error handling guide',toolUseResult:{exitCode}};
      expect(toolOutcome(null,[result],'process','claude').verdict).toBe(exitCode===0?'succeeded':'failed');
      expect(toolOutcome(null,[{...result,is_error:true}],'process','claude').verdict).toBe('failed');
    }
    expect(toolOutcome(null,[{content:'Error handling guide',toolUseResult:{status:'completed'}}],'other','pi').verdict).toBe('unknown');
  });
  it.each([true,'permission denied',{code:'forbidden',message:'denied'}])('legacy MCP explicit error %j reaches collapsed failure via adapter',error=>{
    const record={server:'files',method:'read',error};
    expect(normalizeResult({content:record}).isError).toBe(true);
    const {container}=render(<ThemeProvider><ExpandKeyProvider value="mcp-error"><ToolExecutionResultRouter toolResult={record}/></ExpandKeyProvider></ThemeProvider>);
    expect(container.querySelector('[data-tool-row]')?.getAttribute('data-tool-verdict')).toBe('failed');
  });
  it.each([{}, {error:null}, {error:false}, {error:''}, {error:0}])('MCP absence/negative is not an explicit failure: %j',extra=>{
    const record={server:'files',method:'read',...extra};const before=JSON.stringify(record);
    expect(toolOutcome(null,[{content:record}],'other').verdict).toBe('unknown');
    expect(JSON.stringify(record)).toBe(before);
  });
  it('error key without a legacy MCP schema, or inside opaque provider data, is not failure evidence',()=>{
    for(const content of [{error:'denied'},{server:'files',error:'denied'},{server:'files',method:'read',error:'denied'}]){
      const r:ToolResultLike={content};
      for(const provider of ['pi','codex','opencode','kilo']) expect(normalizeResult(r,{provider}).isError).toBeUndefined();
      if(!('method' in content))expect(normalizeResult(r).isError).toBeUndefined();
    }
  });
});
