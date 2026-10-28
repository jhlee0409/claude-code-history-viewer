// Primitive states gallery (plan I0; ported from the gap audit's
// scratch/visual-audit/gaps/states). Every control carries
//   data-ctl="<primitive>:<variant>"   which control
//   data-src="<state>"                  the state rendered statically
// (default, disabled, aria-disabled, loading, error, selected, checked,
// checked-disabled). Hover, keyboard focus and pressed are produced by the
// runner (states/run.mjs) on the `default`/`selected`/`checked` instances.
// The F2a state contract (states/judge.mjs) holds every `button:`,
// `input:`, `textarea:`, `select:` and `switch:` control: all Button
// variants and sizes, the Input variants and sizes, controls inside a Field
// with help and error text. Not part of the app build or tsc (scripts/ is
// outside tsconfig.app.json).
//
// `?view=probes` renders the Button behaviour probes of the real-browser
// tests (test/primitives.states.test.mjs) instead: the same mounted Button
// idle and loading with the caller's own gap, padding, direction and a
// wrapping label, and a Button, an `asChild` link and an `asChild` submit
// button, each aria-disabled, loading and enabled, whose handlers (their
// own and the child's) record every call in `window.__probeLog`. They are
// not part of the gallery sheets (`pnpm ui:states` opens the gallery).
import { createRoot } from "react-dom/client";
import { useState, type ReactNode } from "react";
import { Settings } from "lucide-react";
import "./states.css";
import "@/i18n";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { Notice } from "@/components/ui/notice";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { ChipToggle, ChipToggleGroup } from "@/components/ui/chipToggle";
import { MetricModeToggle } from "@/components/ui/MetricModeToggle";
import { RovingFocusProbe } from "./rovingFocusProbe";
import { PageHeader } from "@/components/ui/pageHeader";
import { ProviderMark } from "@/components/ui/providerMark";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";

const query = new URLSearchParams(location.search);
if (query.get("theme") === "dark") document.documentElement.classList.add("dark");

const BUTTON_VARIANTS = ["primary", "destructive", "outline", "secondary", "ghost", "link"] as const;
const BUTTON_SIZES = [
  { ctl: "sm", size: "sm", variant: "primary" },
  { ctl: "lg", size: "lg", variant: "primary" },
  { ctl: "icon", size: "icon", variant: "ghost" },
  { ctl: "icon-sm", size: "icon-sm", variant: "ghost" },
  { ctl: "icon-lg", size: "icon-lg", variant: "outline" },
] as const;
const BADGE_VARIANTS = ["neutral", "muted", "danger", "warning", "info", "outline"] as const;
const BADGE_LEGACY = ["default", "secondary", "destructive", "accent", "success"] as const;
const NOTICE_VARIANTS = ["neutral", "info", "warning", "danger", "success"] as const;
const CARD_VARIANTS = ["default", "elevated", "interactive", "glass", "outline"] as const;

function Row({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div data-row={id} style={{ display: "flex", alignItems: "center", gap: 16, padding: "6px 0" }}>
      <div style={{ width: 150, flex: "none", fontSize: 11, fontFamily: "monospace" }} className="text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

function ButtonSizeContent({ ctl }: { ctl: string }) {
  return ctl.startsWith("icon") ? <Settings /> : ctl === "sm" ? "Small" : "Large";
}

function App() {
  return (
    <div className="bg-background text-foreground min-h-screen p-6" style={{ width: 1100 }} data-gallery-ready="true">
      {BUTTON_VARIANTS.map((v) => (
        <Row key={v} id={`button-${v}`} label={`Button ${v}`}>
          <Button data-ctl={`button:${v}`} data-src="default" variant={v}>Save</Button>
          <Button data-ctl={`button:${v}`} data-src="disabled" variant={v} disabled>Save</Button>
          <Button data-ctl={`button:${v}`} data-src="aria-disabled" variant={v} aria-disabled="true">Save</Button>
          <Button data-ctl={`button:${v}`} data-src="loading" variant={v} loading>Save</Button>
        </Row>
      ))}
      <Row id="button-sizes" label="Button sizes">
        {BUTTON_SIZES.map(({ ctl, size, variant }) => (
          <span key={ctl} style={{ display: "inline-flex", gap: 8 }}>
            <Button data-ctl={`button:${ctl}`} data-src="default" size={size} variant={variant} aria-label={ctl.startsWith("icon") ? "Settings" : undefined}>
              <ButtonSizeContent ctl={ctl} />
            </Button>
            <Button data-ctl={`button:${ctl}`} data-src="loading" size={size} variant={variant} loading aria-label={ctl.startsWith("icon") ? "Settings" : undefined}>
              <ButtonSizeContent ctl={ctl} />
            </Button>
          </span>
        ))}
      </Row>
      <Row id="input" label="Input">
        <Input data-ctl="input:default" data-src="default" placeholder="Search" style={{ width: 160 }} />
        <Input data-ctl="input:default" data-src="disabled" disabled placeholder="Search" style={{ width: 160 }} />
        <Input data-ctl="input:default" data-src="error" aria-invalid="true" defaultValue="bad value" style={{ width: 160 }} />
        <Input data-ctl="input:ghost" data-src="default" variant="ghost" placeholder="Ghost" style={{ width: 120 }} />
        <Input data-ctl="input:sm" data-src="default" inputSize="sm" placeholder="Small" style={{ width: 100 }} />
        <Input data-ctl="input:lg" data-src="default" inputSize="lg" placeholder="Large" style={{ width: 120 }} />
      </Row>
      <Row id="field" label="Field">
        <div style={{ width: 220 }}>
          <Field label="Name" help="Shown on the card">
            <Input data-ctl="input:field" data-src="default" placeholder="Session name" />
          </Field>
        </div>
        <div style={{ width: 220 }}>
          <Field label="Name" error="Enter a name">
            <Input data-ctl="input:error" data-src="default" defaultValue="" />
          </Field>
        </div>
        <div style={{ width: 220 }}>
          <Field label="Range" help="Days to include" error="Pick a range">
            <Select defaultValue="a">
              <SelectTrigger data-ctl="select:error" data-src="default"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="a">All time</SelectItem></SelectContent>
            </Select>
          </Field>
        </div>
      </Row>
      <Row id="textarea" label="Textarea">
        <Textarea data-ctl="textarea:default" data-src="default" placeholder="Notes" style={{ width: 220, minHeight: 40 }} />
        <Textarea data-ctl="textarea:default" data-src="disabled" disabled style={{ width: 220, minHeight: 40 }} />
        <div style={{ width: 220 }}>
          <Field label="Notes" error="Too long">
            <Textarea data-ctl="textarea:error" data-src="default" defaultValue="bad value" style={{ minHeight: 40 }} />
          </Field>
        </div>
      </Row>
      <Row id="select" label="Select">
        <div style={{ width: 180 }}>
          <Select defaultValue="a">
            <SelectTrigger data-ctl="select:default" data-src="default" aria-label="Range"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="a">All time</SelectItem><SelectItem value="b">Last 7 days</SelectItem></SelectContent>
          </Select>
        </div>
        <div style={{ width: 180 }}>
          <Select defaultValue="a" disabled>
            <SelectTrigger data-ctl="select:default" data-src="disabled" aria-label="Range (disabled)"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="a">All time</SelectItem></SelectContent>
          </Select>
        </div>
      </Row>
      <Row id="switch" label="Switch">
        <Switch data-ctl="switch:default" data-src="default" aria-label="a" />
        <Switch data-ctl="switch:default" data-src="checked" defaultChecked aria-label="b" />
        <Switch data-ctl="switch:default" data-src="disabled" disabled aria-label="c" />
        <Switch data-ctl="switch:default" data-src="checked-disabled" disabled defaultChecked aria-label="d" />
      </Row>
      <Row id="spinner" label="Spinner">
        <Spinner data-ctl="spinner:14" data-src="default" size={14} />
        <Spinner data-ctl="spinner:16" data-src="default" />
        <Spinner data-ctl="spinner:24" data-src="default" size={24} />
        <span className="text-list text-fg-2" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Spinner decorative /> Loading sessions
        </span>
      </Row>
      <Row id="badge" label="Badge">
        {BADGE_VARIANTS.map((v) => (
          <Badge key={v} variant={v} data-ctl={`badge:${v}`} data-src="default">{v}</Badge>
        ))}
      </Row>
      <Row id="badge-legacy" label="Badge (older names)">
        {BADGE_LEGACY.map((v) => (
          <Badge key={v} variant={v} data-ctl={`badge:${v}`} data-src="default">{v}</Badge>
        ))}
      </Row>
      <Row id="notice" label="Notice">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 290px)", gap: 8 }}>
          {NOTICE_VARIANTS.map((v) => (
            <Notice key={v} variant={v} title={`${v[0]!.toUpperCase()}${v.slice(1)} notice`} data-ctl={`notice:${v}`} data-src="default">
              One line of detail.
            </Notice>
          ))}
          <Notice variant="danger" live data-ctl="notice:live" data-src="default">Could not save the file (live)</Notice>
        </div>
      </Row>
      <Row id="tabs" label="Tabs">
        <Tabs defaultValue="o">
          <TabsList>
            <TabsTrigger value="o" data-ctl="tabs:trigger" data-src="selected">Overview</TabsTrigger>
            <TabsTrigger value="b" data-ctl="tabs:trigger" data-src="default">Browse</TabsTrigger>
            <TabsTrigger value="c" data-ctl="tabs:trigger" data-src="disabled" disabled>Locked</TabsTrigger>
          </TabsList>
        </Tabs>
      </Row>
      <Row id="segmented" label=".segmented">
        <Segmented value="overview" onValueChange={() => {}} aria-label="View mode">
          <SegmentedItem value="overview" data-ctl="segmented:item" data-src="selected">Overview</SegmentedItem>
          <SegmentedItem value="tokens" data-ctl="segmented:item" data-src="default">Tokens</SegmentedItem>
          <SegmentedItem value="edits" disabled data-ctl="segmented:item" data-src="disabled">Edits</SegmentedItem>
        </Segmented>
      </Row>
      <Row id="chips" label="ChipToggle">
        <ChipToggleGroup aria-label="Message filters">
          <ChipToggle pressed data-ctl="chip:toggle" data-src="selected" onPressedChange={() => {}}>User</ChipToggle>
          <ChipToggle pressed={false} data-ctl="chip:toggle" data-src="default" onPressedChange={() => {}}>Assistant</ChipToggle>
          <ChipToggle pressed={false} data-ctl="chip:toggle" data-src="disabled" disabled onPressedChange={() => {}}>Unavailable</ChipToggle>
        </ChipToggleGroup>
      </Row>
      <Row id="card" label="Card">
        {CARD_VARIANTS.map((v) => (
          <Card key={v} variant={v} data-ctl={`card:${v}`} data-src="default" tabIndex={v === "interactive" ? 0 : undefined} style={{ padding: 12, width: 120, fontSize: 13 }}>
            {v}
          </Card>
        ))}
      </Row>
      <Row id="menu" label="DropdownMenu">
        <DropdownMenu open modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" data-ctl="menu:trigger" data-src="default">Menu</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" avoidCollisions={false}>
            <DropdownMenuItem data-ctl="menu:item" data-src="default">Open in new tab</DropdownMenuItem>
            <DropdownMenuItem data-ctl="menu:item" data-src="disabled" disabled>Delete</DropdownMenuItem>
            <DropdownMenuCheckboxItem checked data-ctl="menu:checkbox" data-src="checked">Show minimap</DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Row>
      <div style={{ height: 260 }} />
    </div>
  );
}

/** Loading-size probes: an icon and a label laid out by the caller's own classes (the last three wrap the label). */
const LOADING_PROBES: { id: string; className?: string; size?: "sm"; trailingIcon?: boolean; parentWidth?: number }[] = [
  { id: "default" },
  { id: "gap-1", className: "gap-1" },
  { id: "gap-3", className: "gap-3" },
  { id: "gap-1.5 px-2, icon label icon", className: "gap-1.5 px-2", trailingIcon: true },
  { id: "sm gap-1", className: "gap-1", size: "sm" },
  { id: "flex-col gap-1", className: "h-auto flex-col gap-1 py-2" },
  { id: "gap-1, wraps at 101px", className: "h-auto w-[101px] gap-1 whitespace-normal py-2" },
  { id: "gap-1, wraps in a 101px parent", className: "h-auto gap-1 whitespace-normal py-2", parentWidth: 101 },
  { id: "flex-col gap-1, wraps at 101px", className: "h-auto w-[101px] flex-col gap-1 whitespace-normal py-2" },
];

/**
 * Every handler the press probes record, by name: each press handler and
 * key handler an inactive Button holds back, and the focus and hover ones
 * it keeps (the real-browser test decides which must run).
 */
const RECORDED_HANDLERS = [
  "onClick", "onClickCapture", "onDoubleClick", "onDoubleClickCapture", "onAuxClick", "onAuxClickCapture",
  "onMouseDown", "onMouseDownCapture", "onMouseUp", "onMouseUpCapture",
  "onPointerDown", "onPointerDownCapture", "onPointerUp", "onPointerUpCapture",
  "onTouchStart", "onTouchStartCapture", "onTouchEnd", "onTouchEndCapture",
  "onSubmit", "onSubmitCapture",
  "onKeyDown", "onKeyDownCapture", "onKeyUp", "onKeyUpCapture", "onKeyPress", "onKeyPressCapture",
  "onFocus", "onBlur", "onPointerEnter", "onPointerLeave", "onMouseEnter", "onMouseLeave",
] as const;

type ProbeRecord = { probe: string; source: "button" | "child" | "form" | "window"; handler: string; key?: string };
const probeLog: ProbeRecord[] = [];

/** Recording handlers for every RECORDED_HANDLERS name, as props. */
const recorders = (probe: string, source: "button" | "child") =>
  Object.fromEntries(RECORDED_HANDLERS.map((handler) => [handler, (event: { key?: string }) => void probeLog.push({ probe, source, handler, key: event.key })]));

const PRESS_MODES = ["button", "link", "submit"] as const;
const PRESS_STATES = ["aria-disabled", "loading", "enabled"] as const;

/** One press probe: `data-probe-press="<mode>:<state>"` on the element that receives the events, in its own form. */
function PressProbe({ mode, state }: { mode: (typeof PRESS_MODES)[number]; state: (typeof PRESS_STATES)[number] }) {
  const id = `${mode}:${state}`;
  const stateProps = state === "aria-disabled" ? { "aria-disabled": true } : state === "loading" ? { loading: true } : {};
  const label = `${mode} ${state}`;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        probeLog.push({ probe: id, source: "form", handler: "submit" });
      }}
    >
      {mode === "button" ? (
        <Button data-probe-press={id} type="submit" {...stateProps} {...recorders(id, "button")}>
          {label}
        </Button>
      ) : (
        <Button asChild {...stateProps} {...recorders(id, "button")}>
          {mode === "link" ? (
            <a data-probe-press={id} href={`#followed-${mode}-${state}`} {...recorders(id, "child")}>
              {label}
            </a>
          ) : (
            <button data-probe-press={id} type="submit" {...recorders(id, "child")}>
              {label}
            </button>
          )}
        </Button>
      )}
    </form>
  );
}

function Adoption() {
  const [metric, setMetric] = useState<"tokens" | "cost_estimated">("tokens");
  const [user, setUser] = useState(true);
  const [assistant, setAssistant] = useState(false);
  return <div className="bg-background text-foreground min-h-screen p-6" data-gallery-ready="true">
    <PageHeader title="Analytics" description="F2b component contracts" controls={<ProviderMark provider="codex" />} />
    <MetricModeToggle value={metric} onChange={setMetric} />
    <button type="button" data-after-radio="">After radio</button>
    <ChipToggleGroup aria-label="Probe filters">
      <ChipToggle pressed={user} onPressedChange={setUser}>User</ChipToggle>
      <ChipToggle pressed={assistant} onPressedChange={setAssistant}>Assistant</ChipToggle>
      <ChipToggle pressed={false} disabled onPressedChange={() => { throw new Error("disabled chip activated"); }}>Unavailable</ChipToggle>
    </ChipToggleGroup>
    <button type="button" data-after-toolbar="">After toolbar</button>
    <Segmented value="one" onValueChange={() => {}} aria-label="Header mode">
      <SegmentedItem value="one">First</SegmentedItem><SegmentedItem value="two">Second</SegmentedItem>
    </Segmented>
    <Tabs defaultValue="overview">
      <TabsList aria-label="Probe pages"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="details">Details</TabsTrigger></TabsList>
      <TabsContent value="overview">Overview body</TabsContent><TabsContent value="details">Detail body</TabsContent>
    </Tabs>
    <Select defaultValue="claude"><SelectTrigger aria-label="Choose provider" controlSize="toolbar"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="claude">Claude</SelectItem><SelectItem value="codex">Codex</SelectItem></SelectContent></Select>
    <Select disabled defaultValue="claude"><SelectTrigger aria-label="Unavailable provider" controlSize="header"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="claude">Claude</SelectItem></SelectContent></Select>
  </div>;
}

function Probes() {
  const [loading, setLoading] = useState(false);
  return (
    <div className="bg-background text-foreground min-h-screen p-6" style={{ width: 1100 }} data-gallery-ready="true">
      <Row id="probe-loading" label="loading size">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
          <button type="button" data-probe="toggle-loading" onClick={() => setLoading((on) => !on)}>
            Toggle loading
          </button>
          {LOADING_PROBES.map(({ id, className, size, trailingIcon, parentWidth }) => {
            const button = (
              <Button key={id} data-probe-width={id} className={className} size={size} loading={loading}>
                <Settings />
                Save changes
                {trailingIcon && <Settings />}
              </Button>
            );
            return parentWidth ? <div key={id} style={{ width: parentWidth }}>{button}</div> : button;
          })}
        </div>
      </Row>
      <Row id="probe-press" label="press handlers">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, max-content)", gap: 16 }}>
          {PRESS_STATES.flatMap((state) => PRESS_MODES.map((mode) => <PressProbe key={`${mode}:${state}`} mode={mode} state={state} />))}
        </div>
      </Row>
    </div>
  );
}

if (query.get("view") === "probes") {
  Object.assign(window, { __probeLog: probeLog });
  // A global shortcut listener (bubble phase): it must still see every key.
  window.addEventListener("keydown", (event) => {
    const probe = (event.target as Element | null)?.closest?.("[data-probe-press]")?.getAttribute("data-probe-press");
    if (probe) probeLog.push({ probe, source: "window", handler: "keydown", key: event.key });
  });
}

createRoot(document.getElementById("root")!).render(query.get("view") === "roving" ? <RovingFocusProbe /> : query.get("view") === "probes" ? <Probes /> : query.get("view") === "adoption" ? <Adoption /> : <App />);
