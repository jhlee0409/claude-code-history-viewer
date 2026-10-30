import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as UI from "./index";
import { ContentHeader } from "@/layouts/shell/ContentHeader";

describe("PageHeader", () => {
  it("adopts the h1 in the real content header, leaving navigation and the subtitle present", () => {
    render(<ContentHeader view="analytics" selectedSession={null} globalOverviewDescription="All projects" />);
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.getByRole("group", { name: "Analytics" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Analytics");
    expect(document.querySelector("header[data-page-header]")).toBeInTheDocument();
  });
  it("owns one h1 and named local navigation and scope slots without nesting headings", () => {
    expect(UI).toHaveProperty("PageHeader");
    const { PageHeader } = UI;
    render(<PageHeader title="Analytics" description="Evidence for this project" tabs={<nav aria-label="Analytics pages">Overview</nav>} controls={<button>All projects</button>} />);
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.getByRole("group", { name: "Analytics" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Analytics");
    expect(screen.getByRole("navigation", { name: "Analytics pages" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All projects" })).toBeInTheDocument();
    expect(screen.getByText("Evidence for this project")).toBeInTheDocument();
  });
});
