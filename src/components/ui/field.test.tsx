/**
 * Field: one label, help and error wiring for Input, Textarea and Select
 * (inner-UI plan F2a, G-ST8, G-SR4).
 *
 * The label names the control (`<label for>`; a Select trigger also points
 * at it with aria-labelledby), help and error text describe it
 * (aria-describedby, help first), an error marks it aria-invalid. The error
 * text is static (no role="alert"): announcing it is the screen's choice
 * (Notice `live`). Outside a Field the controls render as before.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Field } from "./field";
import { Input, inputVariants } from "./input";
import { Textarea } from "./textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

afterEach(cleanup);

const describedTexts = (el: HTMLElement) =>
  (el.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? `<missing #${id}>`);

describe("Field", () => {
  it("names an Input with its label, describes it with help then error, and marks it invalid", () => {
    render(
      <Field label="Name" help="Shown on the card" error="Enter a name">
        <Input />
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Name" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(describedTexts(input)).toEqual(["Shown on the card", "Enter a name"]);
    const error = screen.getByText("Enter a name");
    expect(error).not.toHaveAttribute("role");
    expect(error).not.toHaveAttribute("aria-live");
  });

  it("is not invalid without an error, and has no description without help", () => {
    render(
      <Field label="Name">
        <Input />
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Name" });
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("keeps the control's own id and description", () => {
    render(
      <>
        <p id="extra">Extra</p>
        <Field label="Name" help="Help">
          <Input id="own-id" aria-describedby="extra" />
        </Field>
      </>,
    );
    const input = screen.getByRole("textbox", { name: "Name" });
    expect(input.id).toBe("own-id");
    expect(describedTexts(input)).toEqual(["Extra", "Help"]);
  });

  it("names and describes a Textarea", () => {
    render(
      <Field label="Notes" error="Too long">
        <Textarea />
      </Field>,
    );
    const textarea = screen.getByRole("textbox", { name: "Notes" });
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    expect(describedTexts(textarea)).toEqual(["Too long"]);
  });

  it("names and describes a Select trigger (combobox)", () => {
    render(
      <Field label="Range" help="Days to include" error="Pick a range">
        <Select defaultValue="7">
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
          </SelectContent>
        </Select>
      </Field>,
    );
    const trigger = screen.getByRole("combobox", { name: "Range" });
    expect(trigger).toHaveAttribute("aria-invalid", "true");
    expect(describedTexts(trigger)).toEqual(["Days to include", "Pick a range"]);
  });

  it("keeps a Select trigger's own aria-label or aria-labelledby as its name", () => {
    render(
      <>
        <span id="own-name">Date range</span>
        <Field label="Range">
          <Select defaultValue="7">
            <SelectTrigger aria-label="Time window">
              <SelectValue />
            </SelectTrigger>
          </Select>
        </Field>
        <Field label="Range">
          <Select defaultValue="7">
            <SelectTrigger aria-labelledby="own-name">
              <SelectValue />
            </SelectTrigger>
          </Select>
        </Field>
      </>,
    );
    const labelled = screen.getByRole("combobox", { name: "Time window" });
    expect(labelled).not.toHaveAttribute("aria-labelledby");
    expect(screen.getByRole("combobox", { name: "Date range" })).toHaveAttribute("aria-labelledby", "own-name");
  });

  it("leaves a control outside a Field as it was", () => {
    render(<Input aria-label="Search" />);
    const input = screen.getByRole("textbox", { name: "Search" });
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(input).not.toHaveAttribute("id");
  });
});

describe("field control look", () => {
  const classesOf = (el: HTMLElement) => el.className.split(/\s+/);

  it("draws Input, Textarea and Select borders with --line-input and the invalid state with the danger line", () => {
    render(
      <>
        <Input aria-label="input" />
        <Textarea aria-label="textarea" />
        <Select>
          <SelectTrigger aria-label="select">
            <SelectValue />
          </SelectTrigger>
        </Select>
      </>,
    );
    for (const el of [screen.getByRole("textbox", { name: "input" }), screen.getByRole("textbox", { name: "textarea" }), screen.getByRole("combobox", { name: "select" })]) {
      const classes = classesOf(el);
      expect(classes, el.tagName).toContain("border-line-input");
      expect(classes, el.tagName).not.toContain("border-input");
      expect(classes, el.tagName).toContain("aria-invalid:border-status-danger-line");
      // Focus is the base ring; disabled is drawn with tokens, not faded.
      expect(classes.filter((c) => /(^|:)outline-(none|hidden)$/.test(c)), el.tagName).toEqual([]);
      expect(classes.filter((c) => /(^|:)opacity-\d+$/.test(c)), el.tagName).toEqual([]);
      expect(classes, el.tagName).toContain("disabled:text-fg-disabled");
    }
  });

  it("keeps the Input variant names; `error` looks like aria-invalid", () => {
    for (const variant of ["default", "error", "ghost"] as const) expect(inputVariants({ variant }).length).toBeGreaterThan(0);
    expect(inputVariants({ variant: "error" }).split(/\s+/)).toContain("border-status-danger-line");
  });
});
