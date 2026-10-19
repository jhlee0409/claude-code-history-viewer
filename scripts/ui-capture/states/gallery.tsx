// Primitive states gallery (plan I0; ported from the gap audit's
// scratch/visual-audit/gaps/states). Every control carries
//   data-ctl="<primitive>:<variant>"   which control
//   data-src="<state>"                  the state rendered statically
// (default, disabled, aria-disabled, loading, error, selected, checked,
// checked-disabled). Hover, keyboard focus and pressed are produced by the
// runner (states/run.mjs) on the `default`/`selected`/`checked` instances.
// Not part of the app build or tsc (scripts/ is outside tsconfig.app.json).
import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import "./states.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { LoadingButtonContent } from "@/components/ui/loading";

const query = new URLSearchParams(location.search);
if (query.get("theme") === "dark") document.documentElement.classList.add("dark");

const BUTTON_VARIANTS = ["default", "destructive", "outline", "secondary", "ghost", "link"] as const;
const BADGE_VARIANTS = ["default", "secondary", "destructive", "outline", "accent", "success", "warning", "info", "muted"] as const;
const CARD_VARIANTS = ["default", "elevated", "interactive", "glass", "outline"] as const;

function Row({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div data-row={id} style={{ display: "flex", alignItems: "center", gap: 16, padding: "6px 0" }}>
      <div style={{ width: 150, fontSize: 11, fontFamily: "monospace" }} className="text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

function App() {
  return (
    <div className="bg-background text-foreground min-h-screen p-6" style={{ width: 1100 }} data-gallery-ready="true">
      {BUTTON_VARIANTS.map((v) => (
        <Row key={v} id={`button-${v}`} label={`Button ${v}`}>
          <Button data-ctl={`button:${v}`} data-src="default" variant={v}>Save</Button>
          <Button data-ctl={`button:${v}`} data-src="disabled" variant={v} disabled>Save</Button>
          <Button data-ctl={`button:${v}`} data-src="loading" variant={v} disabled aria-busy="true">
            <LoadingButtonContent isLoading loadingText="Save">Save</LoadingButtonContent>
          </Button>
          <Button data-ctl={`button:${v}`} data-src="aria-disabled" variant={v} aria-disabled="true">Save</Button>
        </Row>
      ))}
      <Row id="button-sizes" label="Button sizes">
        <Button size="sm" data-ctl="button:sm" data-src="default">Small</Button>
        <Button size="lg" data-ctl="button:lg" data-src="default">Large</Button>
        <Button size="icon" variant="ghost" data-ctl="button:icon-ghost" data-src="default" aria-label="Settings">⚙</Button>
      </Row>
      <Row id="input" label="Input">
        <Input data-ctl="input:default" data-src="default" placeholder="Search" style={{ width: 180 }} />
        <Input data-ctl="input:default" data-src="disabled" disabled placeholder="Search" style={{ width: 180 }} />
        <Input data-ctl="input:default" data-src="error" aria-invalid="true" defaultValue="bad value" style={{ width: 180 }} />
      </Row>
      <Row id="textarea" label="Textarea">
        <Textarea data-ctl="textarea:default" data-src="default" placeholder="Notes" style={{ width: 240, minHeight: 40 }} />
        <Textarea data-ctl="textarea:default" data-src="disabled" disabled style={{ width: 240, minHeight: 40 }} />
        <Textarea data-ctl="textarea:default" data-src="error" aria-invalid="true" defaultValue="bad value" style={{ width: 240, minHeight: 40 }} />
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
        <div className="segmented" role="group">
          <button className="segmented-item px-3 py-1 text-list" aria-pressed="true" data-ctl="segmented:item" data-src="selected">Overview</button>
          <button className="segmented-item px-3 py-1 text-list" aria-pressed="false" data-ctl="segmented:item" data-src="default">Tokens</button>
          <button className="segmented-item px-3 py-1 text-list" aria-pressed="false" disabled data-ctl="segmented:item" data-src="disabled">Edits</button>
        </div>
      </Row>
      <Row id="badge" label="Badge">
        {BADGE_VARIANTS.map((v) => (
          <Badge key={v} variant={v} data-ctl={`badge:${v}`} data-src="default">{v}</Badge>
        ))}
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

createRoot(document.getElementById("root")!).render(<App />);
