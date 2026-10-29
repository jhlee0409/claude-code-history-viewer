import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProviderDot } from "@/components/ProjectTree/components/ProviderDot";
import { PROVIDER_IDS } from "@/utils/providers";
import { ProviderMark } from "./providerMark";
import "@/i18n";

describe("provider shape adoption", () => {
  it("names standalone marks and keeps unknown providers honest", () => {
    render(<><ProviderMark provider="codex" /><ProviderMark provider="future-provider" /></>);
    expect(screen.getByRole("img", { name: "Codex CLI" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "future-provider" })).toHaveAttribute("data-provider-shape", "unknown");
  });
  it("characterizes the decorative dot boundary used inside already-named project rows", () => {
    const { container } = render(<ProviderDot provider="codex" className="mr-2" />);
    const dot = container.querySelector('[data-provider-dot="codex"]');
    expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(dot).toHaveClass("mr-2");
    expect(screen.queryByRole("img")).toBeNull();
  });
  it("gives each supported provider a stable non-colour mark, even in decorative mode", () => {
    const { container } = render(<>{PROVIDER_IDS.map((provider) => <ProviderDot key={provider} provider={provider} />)}</>);
    const marks = [...container.querySelectorAll("[data-provider-shape]")];
    expect(marks).toHaveLength(PROVIDER_IDS.length);
    expect(new Set(marks.map((mark) => mark.getAttribute("data-provider-shape"))).size).toBe(PROVIDER_IDS.length);
    // IDs alone cannot prove non-colour identity: compare actual SVG geometry.
    expect(new Set(marks.map((mark) => mark.querySelector("svg")!.innerHTML)).size).toBe(PROVIDER_IDS.length);
  });
});
