import { describe, it, expect, vi, beforeEach } from "vitest";
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

Object.assign(navigator, {
  clipboard: { writeText: vi.fn(() => Promise.resolve()) },
});

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
  beforeEach(() => {
    vi.clearAllMocks();
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

    fireEvent.click(container.querySelector(".cursor-pointer")!);

    // Prism renders <pre> with code tokens
    expect(container.querySelector("pre")).toBeTruthy();
    // Should NOT have ReactMarkdown prose wrapper
    expect(container.querySelector("[class*='prose']")).toBeNull();
  });

  it("should render markdown with ReactMarkdown when expanded for .md files", () => {
    const mdEdit: FileEditData = {
      ...baseEdit,
      file_path: "/docs/README.md",
      content_after_change: "# Title\n\n**Bold text**\n\n| A | B |\n|---|---|\n| 1 | 2 |",
    };

    const { container } = render(
      <FileEditItem edit={mdEdit} isDarkMode={false} />
    );

    fireEvent.click(container.querySelector(".cursor-pointer")!);

    // Should render markdown elements, not raw text
    expect(container.querySelector("strong")?.textContent).toBe("Bold text");
    expect(container.querySelector("table")).toBeTruthy();
    // Should NOT have Prism <pre> with line numbers
    expect(container.querySelector("[style*='table-row']")).toBeNull();
  });
});
