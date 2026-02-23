import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { DatePickerHeader } from "../components/ui/DatePickerHeader";

const toLocalDateString = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

describe("DatePickerHeader", () => {
  it("keeps start and end aligned when end is set before start", () => {
    const setDateFilter = vi.fn();
    const { container } = render(
      <DatePickerHeader
        dateFilter={{
          start: new Date(2026, 0, 10),
          end: new Date(2026, 0, 12),
        }}
        setDateFilter={setDateFilter}
      />
    );

    const dateInputs = container.querySelectorAll<HTMLInputElement>('input[type="date"]');
    const endInput = dateInputs[1];
    expect(endInput).toBeDefined();

    fireEvent.change(endInput!, { target: { value: "2026-01-05" } });

    expect(setDateFilter).toHaveBeenCalledTimes(1);
    const next = setDateFilter.mock.calls[0]?.[0];
    expect(next).toBeDefined();
    expect(toLocalDateString(next.start)).toBe("2026-01-05");
    expect(toLocalDateString(next.end)).toBe("2026-01-05");
  });

  it("keeps start and end aligned when start is set after end", () => {
    const setDateFilter = vi.fn();
    const { container } = render(
      <DatePickerHeader
        dateFilter={{
          start: new Date(2026, 0, 10),
          end: new Date(2026, 0, 12),
        }}
        setDateFilter={setDateFilter}
      />
    );

    const dateInputs = container.querySelectorAll<HTMLInputElement>('input[type="date"]');
    const startInput = dateInputs[0];
    expect(startInput).toBeDefined();

    fireEvent.change(startInput!, { target: { value: "2026-01-20" } });

    expect(setDateFilter).toHaveBeenCalledTimes(1);
    const next = setDateFilter.mock.calls[0]?.[0];
    expect(next).toBeDefined();
    expect(toLocalDateString(next.start)).toBe("2026-01-20");
    expect(toLocalDateString(next.end)).toBe("2026-01-20");
  });
});
