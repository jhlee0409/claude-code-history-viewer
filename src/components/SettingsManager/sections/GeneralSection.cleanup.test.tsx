import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

import { GeneralSection } from "./GeneralSection";

const renderSection = (cleanupPeriodDays?: number) => {
  const onChange = vi.fn();
  render(
    <GeneralSection
      settings={{ cleanupPeriodDays }}
      isExpanded
      onToggle={() => {}}
      onChange={onChange}
      readOnly={false}
    />
  );
  const input = screen.getByLabelText(
    "settingsManager.general.cleanupPeriod"
  ) as HTMLInputElement;
  return { input, onChange };
};

// #587: an invalid or transient entry must never replace the saved period —
// writing `undefined` would drop the key and reset e.g. 3650 to 30.
describe("GeneralSection cleanup period", () => {
  it("writes periods beyond a year", () => {
    const { input, onChange } = renderSection(3650);
    expect(input.value).toBe("3650");
    expect(input.max).toBe("");

    fireEvent.change(input, { target: { value: "5000" } });
    expect(onChange).toHaveBeenCalledWith({ cleanupPeriodDays: 5000 });
  });

  it("keeps the saved value for 0 or an empty field, and restores it on blur", () => {
    const { input, onChange } = renderSection(3650);

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.change(input, { target: { value: "0" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("0");

    fireEvent.blur(input);
    expect(input.value).toBe("3650");
  });
});
