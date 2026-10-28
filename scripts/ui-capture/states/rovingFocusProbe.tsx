// Behaviour-only fixture: never rendered by the default state sheets.
import { useRef, useState } from "react";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { ChipToggle, ChipToggleGroup } from "@/components/ui/chipToggle";

export function RovingFocusProbe() {
  const params = new URLSearchParams(location.search);
  const policy = params.get("policy") ?? "accept";
  const visibility = params.get("visibility") ?? "visible";
  const [value, setValue] = useState(visibility === "selected" ? "b" : "a");
  const [disabled, setDisabled] = useState<string | null>(null);
  const [order, setOrder] = useState(["a", "b", "c"]);
  const [pressed, setPressed] = useState({ a: false, b: true, c: false });
  const requests = useRef<string[]>([]);
  const requestOutput = useRef<HTMLOutputElement>(null);
  const resolveRequest = useRef<(() => void) | null>(null);
  const request = (next: string) => {
    requests.current.push(next);
    // Do not rerender on rejection: that would mask focus-only Tab-stop drift.
    if (requestOutput.current) requestOutput.current.textContent = JSON.stringify(requests.current);
    if (policy === "accept") setValue(next);
    if (policy === "defer") {
      void new Promise<void>((resolve) => { resolveRequest.current = resolve; }).then(() => setValue(next));
    }
  };
  return <div className="bg-background text-foreground min-h-screen p-6" data-gallery-ready="true" data-visibility={visibility}>
    <style>{`
      [data-visibility="first"] [data-roving-item="a"],
      [data-visibility="middle"] [data-roving-item="b"],
      [data-visibility="selected"] [data-roving-item="b"],
      [data-visibility="ancestor"] [data-roving-wrap="a"],
      [data-runtime-hidden] { display: none !important; }
      @media (max-width: 800px) {
        [data-visibility="responsive"] [data-roving-item="a"] { display: none; }
      }
    `}</style>
    <button onClick={() => setDisabled("a")}>Disable A</button>
    <button onClick={() => setDisabled("b")}>Disable B</button>
    <button onClick={() => setDisabled(null)}>Enable all</button>
    <button onClick={() => setOrder(["c", "a", "b"])}>Reorder</button>
    <button onClick={() => resolveRequest.current?.()}>Resolve request</button>
    <button data-before-radio="">Before radio</button>
    <Segmented value={value} onValueChange={request} aria-label="Controlled radios">
      {order.map((item) => <span key={item} data-roving-wrap={item}><SegmentedItem value={item} data-roving-item={item} disabled={item === disabled}>{item.toUpperCase()}</SegmentedItem></span>)}
      <SegmentedItem value="locked" disabled>Locked</SegmentedItem>
    </Segmented>
    <button data-after-radio="">After radio</button>
    <output ref={requestOutput} data-requests="">[]</output>
    <button data-before-toolbar="">Before toolbar</button>
    <ChipToggleGroup aria-label="Independent filters">
      {order.map((item) => <span key={item} data-roving-wrap={item}><ChipToggle data-roving-item={item} pressed={pressed[item as keyof typeof pressed]} disabled={item === disabled}
        onPressedChange={(next) => setPressed((previous) => ({ ...previous, [item]: next }))}>{item.toUpperCase()}</ChipToggle></span>)}
      <ChipToggle pressed={false} disabled onPressedChange={() => { throw new Error("disabled activation"); }}>Locked</ChipToggle>
      <button>Reset</button>
    </ChipToggleGroup>
    <button data-after-toolbar="">After toolbar</button>
  </div>;
}
