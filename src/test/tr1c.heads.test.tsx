import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import i18n from "@/i18n";
import { ThemeProvider } from "@/contexts/theme";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { useExpandRegistry } from "@/store/expandRegistryStore";
import { ToolExecutionResultRouter } from "@/components/messageRenderer/ToolExecutionResultRouter";
import { TaskNotificationRenderer } from "@/components/contentRenderer/TaskNotificationRenderer";

// Component-state controls of the existing router shapes, not fabricated API responses.
const CASES: [string, Record<string, unknown> | string, string[]][] = [
  ["MCP", { server: "server-one", method: "method-one", params: { needle: "param-one" }, result: { text: "result-one" } }, ["server-one", "method-one", "param-one", "result-one"]],
  ["codebase", { files_analyzed: 3, context_window: "context-one", relevant_files: ["first.ts", "second.ts"] }, ["context-one", "first.ts", "second.ts"]],
  ["Git", { command: "git status", status: "status-one", files: ["first.ts", "second.ts"], diff: "diff-one" }, ["git status", "status-one", "first.ts", "second.ts", "diff-one"]],
  ["web", { query: "query-one", results: ["first-result", "second-result"] }, ["query-one", "first-result", "second-result"]],
  ["todo", { oldTodos: [], newTodos: [{ content: "first-todo", status: "pending", priority: "high" }, { content: "second-todo", status: "completed", priority: "low" }] }, ["first-todo", "high", "second-todo", "low"]],
  ["task", { task: { id: "task-one", subject: "subject-one", owner: "owner-one", status: "pending" } }, ["task-one", "subject-one", "owner-one"]],
  ["task-update", { success: true, taskId: "task-one", statusChange: { from: "pending", to: "completed" }, updatedFields: ["field-one"] }, ["task-one", "pending", "completed", "field-one"]],
  ["task-list", { tasks: [{ id: "task-one", subject: "first-task" }, { id: "task-two", subject: "second-task" }] }, ["task-one", "first-task", "task-two", "second-task"]],
  ["files", { filenames: ["src/first.ts", "lib/second.ts"], numFiles: 2 }, ["first.ts", "src", "second.ts", "lib"]],
  ["patch", { filePath: "src/first.ts", structuredPatch: [], content: "file-one" }, ["src/first.ts", "file-one"]],
  ["file", { file: { filePath: "src/first.ts", content: "file-one", numLines: 1, startLine: 1, totalLines: 1 } }, ["src/first.ts", "file-one"]],
  ["fallback", { future: { first: "first-value", second: "second-value" }, nil: null, zero: 0, flag: false }, ["first-value", "second-value", "null", "0", "false"]],
  ["error", "Error: error-one", ["error-one"]],
  ["generic", { stdout: "stdout-one", stderr: "stderr-one", interrupted: false, isImage: false }, ["stdout-one", "stderr-one"]],
];
function mount(record: Record<string, unknown> | string, query?: string) {
  return render(<ThemeProvider><ExpandKeyProvider value="part2-head"><ToolExecutionResultRouter toolResult={record} searchQuery={query} /></ExpandKeyProvider></ThemeProvider>);
}
function openAll(container: HTMLElement) {
  // Legacy inner folds have no aria-expanded: characterization opens each once.
  const clicked = new WeakSet<HTMLElement>();
  for (let i=0; i<60; i++) {
    const b=[...container.querySelectorAll<HTMLElement>('button')].find(b=>!clicked.has(b)&&b.getAttribute('aria-expanded')!=='true'&&(b.hasAttribute('aria-expanded')||b.querySelector('.lucide-chevron-right')));
    if(!b)break; clicked.add(b);fireEvent.click(b);
  }
}
beforeAll(async()=>{await i18n.changeLanguage('en');});
beforeEach(()=>{useExpandRegistry.getState().clearAll();});
describe('TR1c part2 characterization',()=>{
  it('retains the visible Notice details preview before expanding it',()=>{
    const record='<task-notification><task-id>task-preview</task-id><status>completed</status><summary>done-summary</summary></task-notification>\nnotice-preview-one\nnotice-preview-two\nnotice-preview-three\nnotice-full-four';
    const {container}=render(<ThemeProvider><ExpandKeyProvider value="notice-preview"><TaskNotificationRenderer text={record} /></ExpandKeyProvider></ThemeProvider>);
    const visible=()=>{const clone=container.cloneNode(true) as HTMLElement;clone.querySelectorAll('[hidden]').forEach(n=>n.remove());return clone.textContent;};
    expect(visible()).toContain('notice-preview-one');
    const toggle=[...container.querySelectorAll<HTMLElement>('button[aria-expanded]')].find(b=>b.textContent?.includes(i18n.t('taskNotification.details')))!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');fireEvent.click(toggle);
    expect(visible()).toContain('notice-full-four');fireEvent.click(toggle);
    expect(visible()).toContain('notice-preview-one');
  });
  it.each(CASES)('%s retains existing recorded body values',(_name,record,values)=>{
    const {container}=mount(record);openAll(container);
    const visible=container.cloneNode(true) as HTMLElement;visible.querySelectorAll('[hidden]').forEach(n=>n.remove());
    for(const value of values)expect(visible.textContent).toContain(value);
    if(values.includes('first-todo')||values.includes('first-task')||values.includes('first-result')){
      const first=values.find(v=>v.startsWith('first-'))!;const second=values.find(v=>v.startsWith('second-'))!;
      expect(visible.textContent!.indexOf(first)).toBeLessThan(visible.textContent!.indexOf(second));
    }
  });
});
describe('TR1c part2 row adoption',()=>{
  it('a fallback value search opens and marks the original value',()=>{
    const {container}=mount({future:'fallback-needle'},'fallback-needle');
    expect(container.querySelector('[data-tool-row] button')?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('mark')?.textContent).toBe('fallback-needle');
  });
  it('generic execution retains distinct output and extra values once with honest status',()=>{
    const {container}=mount({stdout:'stdout-single',stderr:'stderr-single',exitCode:0,interrupted:false,isImage:false,future:'future-single'});openAll(container);
    expect(container.querySelector('[data-tool-row]')?.getAttribute('data-tool-verdict')).toBe('succeeded');
    for(const value of ['stdout-single','stderr-single','future-single'])expect(container.textContent?.split(value)).toHaveLength(2);
    expect(container.textContent?.split('Exit code 0')).toHaveLength(2);
    expect(container.textContent).toContain('"interrupted": false');
    expect(container.textContent).toContain('"isImage": false');
    expect(container.textContent).not.toContain('Completed');
  });
  it.each(CASES)('%s uses a result ToolRow, linked disclosure and result zone',(_name,record)=>{
    const {container}=mount(record);const row=container.querySelector('[data-tool-row]');
    expect(row).not.toBeNull();
    const toggle=row!.querySelector<HTMLElement>('button[aria-expanded]')!;
    expect(toggle.getAttribute('aria-controls')).toBeTruthy();fireEvent.click(toggle);
    expect(container.querySelector('[data-detail-zone=result]')).not.toBeNull();
    expect(container.querySelectorAll('[data-detail-zone=input]')).toHaveLength(0);
    expect(container.querySelector('.border-b.border-line-faint')).not.toBeNull();
    openAll(container);
    const ids=[...container.querySelectorAll('[id]')].map(n=>n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for(const disclosure of container.querySelectorAll('button[aria-expanded]')){
      const target=disclosure.getAttribute('aria-controls');
      expect(target).toBeTruthy();
      expect([...container.querySelectorAll('[id]')].some(n=>n.id===target)).toBe(true);
      expect(disclosure.textContent?.trim()||disclosure.getAttribute('aria-label')).toBeTruthy();
    }
  });
  it.each([[0,'succeeded'],[2,'failed'],[undefined,'unknown']] as const)('terminal result exit %s uses only adapter verdict %s',(exitCode,verdict)=>{
    const {container}=mount({ type:'terminal_stream',command:'command-one',stream:'stderr',output:'warning-one',exitCode });
    openAll(container);expect(container.querySelector('[data-tool-row]')?.getAttribute('data-tool-verdict')).toBe(verdict);
    expect(container.querySelector('[data-output]')).not.toBeNull();expect(container.textContent).toContain('warning-one');
    expect(container.textContent).not.toContain('Completed');
  });
});
