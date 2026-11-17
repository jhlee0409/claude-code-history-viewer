/**
 * Spinner, Badge and Notice contracts (inner-UI plan F2a, G-ST6, G-SR6).
 *
 * - Spinner: the one loading glyph. Standalone it is a status with the
 *   existing `common.loading` text; inside a control that already says it
 *   is busy (Button `loading`) it is decorative and hidden.
 * - Badge: neutral · muted · danger · warning · info · outline, on the
 *   status tokens, no shadow, pill radius. There is no success badge; the
 *   older variant names still render (secondary/default → neutral,
 *   destructive → danger, success/accent → neutral) until F2b renames
 *   their call sites.
 * - Notice: an inline notice on the status tokens. role="alert" only with
 *   `live` (a static notice is read in place, not announced on every visit).
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import i18n from "@/i18n";
import { Spinner } from "./spinner";
import { Badge, badgeVariants } from "./badge";
import { Notice } from "./notice";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

describe("Spinner", () => {
  it("is a status named with common.loading, its glyph spinning and hidden", () => {
    render(<Spinner />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(i18n.t("common.loading"));
    const glyph = status.querySelector("svg");
    expect(glyph).not.toBeNull();
    expect(glyph!.getAttribute("aria-hidden")).toBe("true");
    expect(glyph!.getAttribute("class") ?? "").toMatch(/(^|\s)animate-spin(\s|$)/);
    expect(glyph!.getAttribute("width")).toBe("16");
  });

  it("takes its own label and an allowed icon size", () => {
    render(<Spinner label="Restoring" size={24} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Restoring");
    expect(status.querySelector("svg")!.getAttribute("width")).toBe("24");
  });

  it("decorative: no status, hidden from assistive tech", () => {
    const { container } = render(<Spinner decorative />);
    expect(screen.queryByRole("status")).toBeNull();
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("aria-hidden")).toBe("true");
    expect(root.getAttribute("data-slot")).toBe("spinner");
  });
});

describe("Badge", () => {
  const CONTRACT = ["neutral", "muted", "danger", "warning", "info", "outline"] as const;
  const classes = (variant: Parameters<typeof badgeVariants>[0] extends infer P ? (P extends { variant?: infer V } ? V : never) : never) =>
    badgeVariants({ variant }).split(/\s+/);

  it("has the six contract variants, none with a shadow, all pill-shaped", () => {
    for (const variant of CONTRACT) {
      const c = classes(variant);
      expect(c.filter((x) => /(^|:)shadow(-|$)/.test(x)), variant).toEqual([]);
      expect(c, variant).toContain("rounded-pill");
    }
  });

  it("draws danger, warning and info with the status tokens", () => {
    for (const status of ["danger", "warning", "info"] as const) {
      const c = classes(status);
      expect(c, status).toContain(`bg-status-${status}-surface`);
      expect(c, status).toContain(`text-status-${status}-fg`);
    }
  });

  it("has no success look; older names render a contract look", () => {
    expect(badgeVariants({ variant: "secondary" })).toBe(badgeVariants({ variant: "neutral" }));
    expect(badgeVariants({ variant: "default" })).toBe(badgeVariants({ variant: "neutral" }));
    expect(badgeVariants({ variant: "destructive" })).toBe(badgeVariants({ variant: "danger" }));
    expect(badgeVariants({ variant: "success" })).toBe(badgeVariants({ variant: "neutral" }));
    expect(badgeVariants({ variant: "accent" })).toBe(badgeVariants({ variant: "neutral" }));
    expect(badgeVariants({})).toBe(badgeVariants({ variant: "neutral" }));
    for (const variant of CONTRACT) expect(classes(variant).join(" "), variant).not.toMatch(/success/);
  });

  it("renders its children", () => {
    render(<Badge variant="muted">Read</Badge>);
    expect(screen.getByText("Read")).toBeInTheDocument();
  });
});

describe("Notice", () => {
  it("a static notice has no live role", () => {
    render(<Notice title="Auto-cleanup is on">Old sessions are archived after 30 days.</Notice>);
    const notice = screen.getByText("Auto-cleanup is on").closest('[data-slot="notice"]') as HTMLElement;
    expect(notice).not.toBeNull();
    expect(notice).not.toHaveAttribute("role");
    expect(notice).not.toHaveAttribute("aria-live");
    expect(notice).toHaveTextContent("Old sessions are archived after 30 days.");
  });

  it("`live` makes it an alert", () => {
    render(
      <Notice variant="danger" live>
        Could not save
      </Notice>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save");
  });

  it("draws each tone with its status tokens and a hidden icon", () => {
    for (const variant of ["danger", "warning", "info", "success"] as const) {
      const { container, unmount } = render(<Notice variant={variant}>{variant}</Notice>);
      const notice = container.querySelector<HTMLElement>('[data-slot="notice"]')!;
      const c = notice.className.split(/\s+/);
      expect(c, variant).toContain(`bg-status-${variant}-surface`);
      expect(c, variant).toContain(`border-status-${variant}-line`);
      const icon = notice.querySelector("svg");
      expect(icon, variant).not.toBeNull();
      expect(icon!.getAttribute("aria-hidden")).toBe("true");
      unmount();
    }
  });

  it("`icon={null}` hides the icon", () => {
    const { container } = render(<Notice icon={null}>plain</Notice>);
    expect(container.querySelector("svg")).toBeNull();
  });
});
