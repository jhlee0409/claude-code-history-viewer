import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { FileEditItem } from "@/components/RecentEditsViewer/FileEditItem";
import type { FileEditData } from "@/components/RecentEditsViewer/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const baseEdit: FileEditData = {
  file_path: "/path/to/file.ts",
  content_before_change: "const x = 1;",
  content_after_change: "const x = 2;",
  operation_type: "edit",
  lines_added: 1,
  lines_removed: 1,
  timestamp: "2025-02-26T10:00:00Z",
};

describe("FileEditItem", () => {
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(() => Promise.resolve()) },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      writable: true,
      configurable: true,
    });
  });

  it("should render file name and diff stats", () => {
    const edit: FileEditData = { ...baseEdit, lines_added: 5, lines_removed: 2 };
    const { container } = render(
      <FileEditItem edit={edit} isDarkMode={false} />
    );

    expect(container.textContent).toContain("file.ts");
    expect(container.textContent).toContain("+5");
    expect(container.textContent).toContain("-2");
  });

  it("should render code with Prism when expanded for non-markdown files", () => {
    const { container } = render(
      <FileEditItem edit={baseEdit} isDarkMode={false} />
    );

    fireEvent.click(container.querySelector("[data-testid='file-edit-header']")!);

    // Prism renders <pre> with code tokens
    expect(container.querySelector("pre")).toBeTruthy();
    // Should NOT have Markdown prose wrapper
    expect(container.querySelector("[class*='prose']")).toBeNull();
  });

  it("should render markdown with Markdown component when expanded for .md files", () => {
    const mdEdit: FileEditData = {
      ...baseEdit,
      file_path: "/docs/README.md",
      content_after_change: "# Title\n\n**Bold text**\n\n| A | B |\n|---|---|\n| 1 | 2 |",
    };

    const { container } = render(
      <FileEditItem edit={mdEdit} isDarkMode={false} />
    );

    fireEvent.click(container.querySelector("[data-testid='file-edit-header']")!);

    // Should render markdown elements, not raw text
    expect(container.querySelector("strong")?.textContent).toBe("Bold text");
    expect(container.querySelector("table")).toBeTruthy();
    // Should NOT have Prism <pre> with line numbers
    expect(container.querySelector("[style*='table-row']")).toBeNull();
  });

  it("should render markdown for .markdown extension files", () => {
    const markdownEdit: FileEditData = {
      ...baseEdit,
      file_path: "/docs/CHANGELOG.markdown",
      content_after_change: "## Changelog\n\n- item 1",
    };

    const { container } = render(
      <FileEditItem edit={markdownEdit} isDarkMode={false} />
    );

    fireEvent.click(container.querySelector("[data-testid='file-edit-header']")!);

    expect(container.querySelector("h2")?.textContent).toBe("Changelog");
    expect(container.querySelectorAll("li").length).toBeGreaterThanOrEqual(1);
  });
});
