// Behaviour-only fixture: never rendered by the default state sheets.
import { useRef, useState } from "react";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { ChipToggle, ChipToggleGroup } from "@/components/ui/chipToggle";

export function RovingFocusProbe() {
  const policy = new URLSearchParams(location.search).get("policy") ?? "accept";
  const [value, setValue] = useState("a");
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
  return <div className="bg-background text-foreground min-h-screen p-6" data-gallery-ready="true">
    <button onClick={() => setDisabled("a")}>Disable A</button>
    <button onClick={() => setDisabled("b")}>Disable B</button>
    <button onClick={() => setDisabled(null)}>Enable all</button>
    <button onClick={() => setOrder(["c", "a", "b"])}>Reorder</button>
    <button onClick={() => resolveRequest.current?.()}>Resolve request</button>
    <button data-before-radio="">Before radio</button>
    <Segmented value={value} onValueChange={request} aria-label="Controlled radios">
      {order.map((item) => <SegmentedItem key={item} value={item} disabled={item === disabled}>{item.toUpperCase()}</SegmentedItem>)}
      <SegmentedItem value="locked" disabled>Locked</SegmentedItem>
    </Segmented>
    <button data-after-radio="">After radio</button>
    <output ref={requestOutput} data-requests="">[]</output>
    <button data-before-toolbar="">Before toolbar</button>
    <ChipToggleGroup aria-label="Independent filters">
      {order.map((item) => <ChipToggle key={item} pressed={pressed[item as keyof typeof pressed]} disabled={item === disabled}
        onPressedChange={(next) => setPressed((previous) => ({ ...previous, [item]: next }))}>{item.toUpperCase()}</ChipToggle>)}
      <ChipToggle pressed={false} disabled onPressedChange={() => { throw new Error("disabled activation"); }}>Locked</ChipToggle>
      <button>Reset</button>
    </ChipToggleGroup>
    <button data-after-toolbar="">After toolbar</button>
  </div>;
}
