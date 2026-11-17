import { useMemo } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { ClaudeMessage } from "@/types";
import type { MessageFilter } from "@/store/slices/filterSlice";
import { applyMessageDisplayFilter } from "@/components/MessageViewer/helpers/messageDisplayFilter";
import { useFilterReadingPosition } from "@/components/MessageViewer/hooks/useFilterReadingPosition";

const store = vi.hoisted(() => ({ listeners: new Set<(state: Record<string, unknown>, previous: Record<string, unknown>) => void>() }));
vi.mock("@/store/useAppStore", () => ({ useAppStore: { subscribe: (fn: (state: Record<string, unknown>, previous: Record<string, unknown>) => void) => { store.listeners.add(fn); return () => store.listeners.delete(fn); } } }));

const all = (): MessageFilter => ({
  roles: { user: true, assistant: true },
  contentTypes: { text: true, thinking: true, toolCalls: true, commands: true, parallelTasks: true },
});
const user: ClaudeMessage = { uuid: "read-source", type: "user", content: "human input", timestamp: "2026-01-01T00:00:00Z" };
const assistant: ClaudeMessage = { ...user, uuid: "assistant-source", type: "assistant", content: [{ type: "text", text: "answer" }] };

function fixture(source = [user], filter = all(), project = applyMessageDisplayFilter) {
  const viewport = document.createElement("div");
  const row = document.createElement("div");
  row.dataset.messageUuid = source[0]!.uuid;
  viewport.append(row);
  document.body.append(viewport);
  Object.defineProperties(viewport, { scrollHeight: { value: 3000 }, clientHeight: { value: 500 } });
  viewport.getBoundingClientRect = () => ({ top: 0, bottom: 500 } as DOMRect);
  let start = 0;
  row.getBoundingClientRect = () => ({ top: start - viewport.scrollTop, bottom: start - viewport.scrollTop + 100, height: 100 } as DOMRect);
  const props = {
    sessionPath: "session-A", source, messageFilter: filter,
    getScrollElement: () => viewport,
    getScrollIndex: vi.fn((): number | null => 0),
    virtualizer: { getOffsetForIndex: vi.fn(() => [0]) } as unknown as Virtualizer<HTMLElement, Element>,
    explicitTarget: null as string | null, restoringRef: { current: false },
  };
  let state = {
    selectedSession: { file_path: "session-A" }, targetMessageUuid: null as string | null,
    messageFilter: filter, showSystemMessages: false, messages: source,
    messageUpdateKind: "replace" as "replace" | "tail-refresh" | "prepend",
    pagination: { isLoadingMore: false }, isLoadingMessages: false,
  };
  const hook = renderHook(options => {
    const messages = useMemo(() => project(options.source, options.messageFilter), [options.source, options.messageFilter]);
    useFilterReadingPosition({ ...options, messages });
    return messages;
  }, { initialProps: props });
  const update = (patch: Partial<typeof state>, commit = true) => act(() => {
    const previous = state;
    state = { ...state, ...patch };
    for (const fn of store.listeners) fn(state, previous);
    if (commit) hook.rerender({ ...props, source: state.messages, messageFilter: state.messageFilter });
  });
  return { viewport, row, props, hook, update, move: (value: number) => { start = value; } };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); document.body.replaceChildren(); vi.useRealTimers(); expect(store.listeners.size).toBe(0); });

describe("filter operation lifetime", () => {
  it.each([false, true])("expires the review's same-array parallelTasks=%s no-op before an unrelated replace", enabled => {
    const initial = all(); initial.contentTypes.parallelTasks = !enabled;
    const f = fixture([user], initial);
    const originalProjection = f.hook.result.current;
    const next = { ...initial, contentTypes: { ...initial.contentTypes, parallelTasks: enabled } };
    f.update({ messageFilter: next });
    expect(f.hook.result.current).toBe(originalProjection); // The actual category fast path.
    expect(f.props.restoringRef.current).toBe(false);
    act(() => vi.advanceTimersByTime(1000)); // Expiry must not depend on a guessed delay.
    f.viewport.scrollTop = 900;
    f.update({ messages: [{ ...user }], pagination: { isLoadingMore: false } });
    expect(f.viewport.scrollTop).toBe(900);
    expect(f.props.restoringRef.current).toBe(false);
  });

  it.each([false, true])("finishes a client operation even when an arbitrary projection preserves its reference (%s)", enabled => {
    // Model any unchanged projection, independently of category/filter implementation.
    const f = fixture([user], all(), source => source);
    const next = { ...f.props.messageFilter, roles: { user: true, assistant: enabled } };
    f.update({ messageFilter: next });
    f.viewport.scrollTop = 900;
    f.update({ messages: [...f.props.source] });
    expect(f.viewport.scrollTop).toBe(900);
  });

  it.each([
    ...(["user", "assistant"] as const).flatMap(role => [false, true].map(enabled => ({ role, enabled }))),
  ])("does not retain a no-population $role=$enabled operation", ({ role, enabled }) => {
    const initial = all(); initial.roles[role] = !enabled;
    const source = role === "user" ? [assistant] : [user];
    const f = fixture(source, initial);
    f.update({ messageFilter: { ...initial, roles: { ...initial.roles, [role]: enabled } } });
    expect(f.hook.result.current).toEqual(source);
    f.viewport.scrollTop = 900;
    f.update({ messages: source.map(message => ({ ...message })) });
    expect(f.viewport.scrollTop).toBe(900);
  });

  it.each((["text", "thinking", "toolCalls", "commands"] as const).flatMap(content => [false, true].map(enabled => ({ content, enabled }))))(
    "does not retain a no-population $content=$enabled operation", ({ content, enabled }) => {
      const initial = all(); initial.contentTypes[content] = !enabled;
      const f = fixture([user], initial);
      f.update({ messageFilter: { ...initial, contentTypes: { ...initial.contentTypes, [content]: enabled } } });
      expect(f.hook.result.current).toEqual([user]);
      f.viewport.scrollTop = 900;
      f.update({ messages: [{ ...user }] });
      expect(f.viewport.scrollTop).toBe(900);
    },
  );

  it("preserves a source through an ordinary client filter that removes another role", () => {
    const f = fixture([user, assistant]);
    // Capture still observes old DOM; projection changes only at commit.
    const next = { ...all(), roles: { user: true, assistant: false } };
    f.update({ messageFilter: next }, false);
    f.move(250);
    f.hook.rerender({ ...f.props, messageFilter: next });
    expect(f.hook.result.current).toEqual([user]);
    expect(f.viewport.scrollTop).toBe(250);
  });

  it("retains a genuinely async system-filter anchor through the replace commit (M1 negative control)", () => {
    const f = fixture();
    f.update({ showSystemMessages: true });
    act(() => vi.advanceTimersByTime(1000));
    expect(f.viewport.scrollTop).toBe(0);
    f.move(250);
    f.update({ messages: [{ ...user }], messageUpdateKind: "replace", pagination: { isLoadingMore: false } });
    expect(f.viewport.scrollTop).toBe(250);
    expect(f.props.restoringRef.current).toBe(true);
  });

  it.each(["tail-refresh", "prepend"] as const)("yields a pending async anchor to %s", kind => {
    const f = fixture();
    f.update({ showSystemMessages: true });
    f.viewport.scrollTop = 900;
    f.update({ messages: [{ ...user }], messageUpdateKind: kind });
    expect(f.viewport.scrollTop).toBe(900);
  });

  it("discards a pending async no-op when HTTP settles with the same source array", () => {
    const f = fixture();
    f.update({ showSystemMessages: true });
    f.update({ pagination: { isLoadingMore: false } });
    f.viewport.scrollTop = 900;
    f.update({ messages: [{ ...user }] });
    expect(f.viewport.scrollTop).toBe(900);
  });

  it("keeps the first-visible fallback when the async filter hides the source", () => {
    const f = fixture();
    f.update({ showSystemMessages: true });
    f.props.getScrollIndex.mockReturnValue(null);
    f.row.remove();
    f.update({ messages: [] });
    expect(f.viewport.scrollTop).toBe(0);
    expect(f.props.restoringRef.current).toBe(false);
    expect(f.props.virtualizer.getOffsetForIndex).not.toHaveBeenCalled();
  });
});
