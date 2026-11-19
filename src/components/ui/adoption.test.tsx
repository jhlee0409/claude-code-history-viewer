import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buttonVariants } from "./button";
import { Card, cardVariants } from "./card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./select";

// These values pin F2a's existing primary look, not a newly invented style.
const PRIMARY = "bg-primary text-primary-foreground hover:bg-primary/85 active:bg-primary/70 data-disabled:bg-muted data-disabled:text-fg-disabled";

describe("F2b variant and surface contracts", () => {
  it("renames the filled default to primary without changing its states", () => {
    const classes = buttonVariants({ variant: "primary" });
    for (const token of PRIMARY.split(" ")) expect(classes).toContain(token);
  });
  it("keeps Card caller props but removes shadows, scaling and fixed durations from every variant", () => {
    for (const variant of ["default", "elevated", "interactive", "glass", "outline"] as const) {
      expect(cardVariants({ variant })).not.toMatch(/shadow-|scale-|duration-300|backdrop-blur/);
    }
    const click = vi.fn();
    render(<Card variant="interactive" data-testid="card" onClick={click} className="p-4">Contents</Card>);
    fireEvent.click(screen.getByTestId("card"));
    expect(click).toHaveBeenCalledOnce();
    expect(screen.getByTestId("card")).toHaveClass("p-4");
  });
  it("uses real Radix tab/panel relationships and preserves controlled navigation", () => {
    const change = vi.fn();
    render(<Tabs defaultValue="a" onValueChange={change}>
      <TabsList aria-label="Local pages"><TabsTrigger value="a">Overview</TabsTrigger><TabsTrigger value="b">Details</TabsTrigger><TabsTrigger value="c" disabled>Unavailable</TabsTrigger></TabsList>
      <TabsContent value="a">Overview body</TabsContent><TabsContent value="b">Details body</TabsContent>
    </Tabs>);
    const overview = screen.getByRole("tab", { name: "Overview" });
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", overview.id);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Details" }), { button: 0 });
    expect(change).toHaveBeenCalledExactlyOnceWith("b");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Details body");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Unavailable" }), { button: 0 });
    expect(change).toHaveBeenCalledTimes(1);
    expect(overview.className).not.toMatch(/outline-none|shadow-/);
  });
  it("offers compact Select trigger sizes without changing field defaults", () => {
    render(<Select><SelectTrigger aria-label="Compact" {...{ controlSize: "toolbar" }}><SelectValue /></SelectTrigger></Select>);
    expect(screen.getByRole("combobox", { name: "Compact" })).toHaveAttribute("data-control-size", "toolbar");
    expect(screen.getByRole("combobox")).toHaveClass("min-h-6.5");
  });
  it("keeps a real Select unavailable while its enabled control opens", async () => {
    const fixture = (disabled: boolean) => <Select disabled={disabled}><SelectTrigger aria-label="Provider"><SelectValue placeholder="Choose" /></SelectTrigger><SelectContent><SelectItem value="claude">Claude</SelectItem></SelectContent></Select>;
    const { unmount } = render(fixture(true));
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    expect(screen.queryByRole("listbox")).toBeNull();
    unmount();
    render(fixture(false));
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
  });
});
