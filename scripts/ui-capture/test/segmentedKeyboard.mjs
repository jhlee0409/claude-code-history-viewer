// Real Edits scope radios: Tab enters the checked item; arrows select the
// previously unchecked item. Never force an unchecked radio into the Tab order.
import { expect } from "vitest";

/* global document */
export const editsScope = (page) => page.locator("#main-content").getByRole("radiogroup", { name: "Session / Project", exact: true });

export async function uncheckedScopeRadio(page) {
  const group = editsScope(page);
  const radios = group.getByRole("radio");
  expect(await radios.count(), "Edits scope radios").toBe(2);
  expect(await group.getByRole("radio", { checked: true }).count(), "one selected scope").toBe(1);
  expect(await group.getByRole("radio", { checked: false }).count(), "one unselected scope").toBe(1);
  // Pin identity by DOM index: an aria-checked=false locator would retarget to
  // the other radio as soon as the arrow selects the intended one.
  const index = await radios.evaluateAll((nodes) => nodes.findIndex((el) => el.getAttribute("aria-checked") === "false"));
  return radios.nth(index);
}

export async function focusScopeRadio(page, target, keyboardFocus) {
  const group = editsScope(page);
  const checked = group.getByRole("radio", { checked: true });
  expect(await checked.count(), "checked Tab entry").toBe(1);
  expect(await group.locator('[role="radio"][tabindex="0"]').count(), "one radio Tab stop").toBe(1);
  expect(await checked.getAttribute("tabindex")).toBe("0");
  expect(await target.getAttribute("aria-checked"), "target starts unchecked").toBe("false");
  expect(await target.getAttribute("tabindex")).toBe("-1");
  expect(await keyboardFocus(page, checked), "Tab enters the checked radio").toBe(true);
  // There are exactly two enabled scope choices in the selected-session fixture.
  expect(await group.getByRole("radio", { disabled: false }).count()).toBe(2);
  await page.keyboard.press("ArrowRight");
  expect(await target.getAttribute("aria-checked"), "arrow selects the target").toBe("true");
  expect(await target.getAttribute("tabindex")).toBe("0");
  expect(await group.getByRole("radio", { checked: true }).count()).toBe(1);
  expect(await group.locator('[role="radio"][tabindex="0"]').count()).toBe(1);
  return target.evaluate((el) => document.activeElement === el);
}
