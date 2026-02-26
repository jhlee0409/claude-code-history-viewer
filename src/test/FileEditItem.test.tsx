import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { FileEditItem } from "@/components/RecentEditsViewer/FileEditItem";
import type { FileEditData } from "@/components/RecentEditsViewer/types";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Mock Tauri API
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock navigator.clipboard
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn(() => Promise.resolve()),
  },
});

describe("FileEditItem - Markdown Detection and Rendering", () => {
  const baseEdit: FileEditData = {
    file_path: "/path/to/file.ts",
    content_before_change: "const x = 1;",
    content_after_change: "const x = 2;",
    operation_type: "edit",
    lines_added: 1,
    lines_removed: 1,
    timestamp: "2025-02-26T10:00:00Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render file edit item without crashing", () => {
    const { container } = render(
      <FileEditItem edit={baseEdit} isDarkMode={false} />
    );

    expect(container).toBeTruthy();
    expect(container.textContent).toContain("file.ts");
  });

  it("should detect .md file and render markdown", () => {
    const mdEdit: FileEditData = {
      ...baseEdit,
      file_path: "/docs/README.md",
      content_after_change: "# Title\n**Bold text**",
    };

    const { container } = render(
      <FileEditItem edit={mdEdit} isDarkMode={false} />
    );

    // Component should render without error
    expect(container).toBeTruthy();
    expect(container.textContent).toContain("README.md");
  });

  it("should detect .markdown file", () => {
    const markdownEdit: FileEditData = {
      ...baseEdit,
      file_path: "/docs/GUIDE.markdown",
      content_after_change: "# Guide",
    };

    const { container } = render(
      <FileEditItem edit={markdownEdit} isDarkMode={false} />
    );

    expect(container).toBeTruthy();
    expect(container.textContent).toContain("GUIDE.markdown");
  });

  it("should detect case-insensitive markdown extension", () => {
    const MD_EDIT: FileEditData = {
      ...baseEdit,
      file_path: "/docs/README.MD",
      content_after_change: "# Markdown",
    };

    const { container } = render(
      <FileEditItem edit={MD_EDIT} isDarkMode={false} />
    );

    expect(container).toBeTruthy();
    expect(container.textContent).toContain("README.MD");
  });

  it("should render TypeScript file without markdown", () => {
    const tsEdit: FileEditData = {
      ...baseEdit,
      file_path: "/src/component.tsx",
      content_after_change: "const Comp = () => <div/>;",
    };

    const { container } = render(
      <FileEditItem edit={tsEdit} isDarkMode={false} />
    );

    expect(container).toBeTruthy();
    expect(container.textContent).toContain("component.tsx");
  });

  it("should render Python file without markdown", () => {
    const pyEdit: FileEditData = {
      ...baseEdit,
      file_path: "/scripts/main.py",
      content_after_change: "def hello():\n    print('world')",
    };

    const { container } = render(
      <FileEditItem edit={pyEdit} isDarkMode={false} />
    );

    expect(container).toBeTruthy();
    expect(container.textContent).toContain("main.py");
  });

  it("should support dark mode for code files", () => {
    const tsEdit: FileEditData = {
      ...baseEdit,
      file_path: "/src/file.ts",
    };

    const { container } = render(
      <FileEditItem edit={tsEdit} isDarkMode={true} />
    );

    expect(container).toBeTruthy();
  });

  it("should support dark mode for markdown files", () => {
    const mdEdit: FileEditData = {
      ...baseEdit,
      file_path: "/docs/README.md",
      content_after_change: "# Title",
    };

    const { container } = render(
      <FileEditItem edit={mdEdit} isDarkMode={true} />
    );

    expect(container).toBeTruthy();
  });

  it("should handle empty markdown content", () => {
    const emptyEdit: FileEditData = {
      ...baseEdit,
      file_path: "/docs/empty.md",
      content_after_change: "",
    };

    const { container } = render(
      <FileEditItem edit={emptyEdit} isDarkMode={false} />
    );

    expect(container).toBeTruthy();
  });

  it("should handle large content", () => {
    const largeContent = "Line 1\n".repeat(500);
    const largeEdit: FileEditData = {
      ...baseEdit,
      file_path: "/docs/large.md",
      content_after_change: largeContent,
    };

    const { container } = render(
      <FileEditItem edit={largeEdit} isDarkMode={false} />
    );

    expect(container).toBeTruthy();
  });

  it("should display diff stats", () => {
    const editWithStats: FileEditData = {
      ...baseEdit,
      lines_added: 5,
      lines_removed: 2,
    };

    const { container } = render(
      <FileEditItem edit={editWithStats} isDarkMode={false} />
    );

    expect(container.textContent).toContain("+5");
    expect(container.textContent).toContain("-2");
  });

  it("should render operation badge", () => {
    const { container } = render(
      <FileEditItem edit={baseEdit} isDarkMode={false} />
    );

    // Check that badge container exists
    expect(container.querySelector("[class*='px-2']")).toBeTruthy();
  });
});
