import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string } & Record<string, unknown>) =>
      (options?.defaultValue ?? _key).replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(options?.[name] ?? "")),
  }),
}));

import { ModelLifecycleBadge } from "./ModelLifecycleBadge";

describe("ModelLifecycleBadge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("renders nothing for an active model", () => {
    const { container } = render(<ModelLifecycleBadge model="claude-sonnet-4-6" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an unknown model", () => {
    const { container } = render(<ModelLifecycleBadge model="mystery-9000" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("labels a retired model with its date and names the replacement in the hint", () => {
    render(<ModelLifecycleBadge model="gpt-5-codex" />);
    const badge = screen.getByText("retired 2026-07-23");
    expect(badge.getAttribute("title")).toContain("2026-07-23");
    expect(badge.getAttribute("title")).toContain("gpt-5.6-sol");
  });

  it("labels an upcoming shutdown as retiring", () => {
    render(<ModelLifecycleBadge model="gpt-4.1-nano" />);
    expect(screen.getByText("retires 2026-10-23")).toBeTruthy();
  });
});
