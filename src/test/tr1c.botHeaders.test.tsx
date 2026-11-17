import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import i18n from '@/i18n';
import { ThemeProvider } from '@/contexts/theme';
import { ExpandKeyProvider } from '@/contexts/CaptureExpandContext';
import { useExpandRegistry } from '@/store/expandRegistryStore';
import { ToolExecutionResultRouter } from '@/components/messageRenderer/ToolExecutionResultRouter';
import { TaskOperationGroupRenderer } from '@/components/toolResultRenderer/TaskOperationGroupRenderer';
import type { TaskOperation } from '@/components/MessageViewer/helpers/taskOperationHelpers';
beforeAll(async()=>{await i18n.changeLanguage('en');});
beforeEach(()=>useExpandRegistry.getState().clearAll());
describe('bot distinguishing heads and honest disclosures',()=>{
  it.each([null,false,0,''])('MCP retains explicitly recorded params/result/error %j and independent fields',value=>{
    const record={server:'filesystem',method:'read',params:value,result:value,error:value,future:{zero:0,flag:false,nil:null}};
    const {container}=render(<ThemeProvider><ExpandKeyProvider value="mcp-presence"><ToolExecutionResultRouter toolResult={record}/></ExpandKeyProvider></ThemeProvider>);
    for(let i=0;i<10;i++){const b=container.querySelector<HTMLElement>('button[aria-expanded="false"]');if(!b)break;fireEvent.click(b);}
    expect(container.textContent).toContain('"error": '+JSON.stringify(value));
    expect(container.textContent).toContain('"nil": null');
    expect([...container.querySelectorAll('pre')].filter(n=>n.textContent===JSON.stringify(value))).toHaveLength(2);
  });
  it('collapsed MCP rows distinguish server.method (including function alias) in shared target with search',()=>{
    const {container}=render(<ThemeProvider>{['read','write'].map((method,i)=><ExpandKeyProvider value={method} key={method}><ToolExecutionResultRouter toolResult={{server:'filesystem',...(i?{function:method}:{method}),params:{path:'file'},result:'ok'}}/></ExpandKeyProvider>)}</ThemeProvider>);
    expect([...container.querySelectorAll('[data-tool-row] [data-row-target]')].map(n=>n.textContent)).toEqual(['filesystem.read','filesystem.write']);
    expect(container.querySelectorAll('[data-tool-row] button[aria-expanded="false"]')).toHaveLength(2);
  });
  it('description-less task entries are static, not inert buttons; actual disclosures remain linked',()=>{
    const operations=[{toolName:'TaskCreate',toolUseId:'one',messageUuid:'one',input:{subject:'static-task'},task:{id:'1',subject:'static-task'}},{toolName:'TaskCreate',toolUseId:'two',messageUuid:'two',input:{subject:'expandable-task',description:'task-body'},task:{id:'2',subject:'expandable-task',description:'task-body'}}] as unknown as TaskOperation[];
    const {container,getByText}=render(<ThemeProvider><ExpandKeyProvider value="task-group"><TaskOperationGroupRenderer operations={operations}/></ExpandKeyProvider></ThemeProvider>);
    expect(getByText('static-task').closest('button')).toBeNull();
    expect(getByText('static-task').closest('[aria-expanded]')).toBeNull();
    const b=getByText('expandable-task').closest('button')!;
    expect(b.getAttribute('aria-expanded')).toBe('false');fireEvent.click(b);
    expect(b.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector(`[id="${b.getAttribute('aria-controls')}"]`)?.textContent).toBe('task-body');
  });
});
