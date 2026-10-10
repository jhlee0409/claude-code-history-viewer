/**
 * #640: the preview reads the current file through the restore guard
 * (`read_restore_target`, scoped like `restore_file`), not the generic
 * `read_text_file`, whose WebUI allowlist refuses project files.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
  }),
}));

const apiMock = vi.fn();
vi.mock("@/services/api", () => ({ api: (...a: unknown[]) => apiMock(...a) }));

vi.mock("../EnhancedDiffViewer", () => ({
  EnhancedDiffViewer: ({ oldText }: { oldText: string }) => (
    <pre data-testid="diff">{oldText}</pre>
  ),
}));

import { RestoreDiffPreview } from "./RestoreDiffPreview";

const filePath = "/Users/alex/Projects/my-app/src/main.ts";
const scope = {
  projectPath: "/Users/alex/.claude/projects/-Users-alex-Projects-my-app",
  sessionFilePath: "/Users/alex/.claude/projects/-Users-alex-Projects-my-app/s1.jsonl",
};

describe("RestoreDiffPreview", () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it("reads the file through the restore guard with the restore scope", async () => {
    apiMock.mockResolvedValue("current on disk");

    render(
      <RestoreDiffPreview
        filePath={filePath}
        restoreContent="restored version"
        restoreScope={scope}
      />
    );

    expect(await screen.findByTestId("diff")).toHaveTextContent("current on disk");
    expect(apiMock).toHaveBeenCalledWith("read_restore_target", {
      filePath,
      projectPath: scope.projectPath,
      sessionFilePath: scope.sessionFilePath,
    });
    expect(apiMock).not.toHaveBeenCalledWith("read_text_file", expect.anything());
  });

  it("shows a missing target as a create", async () => {
    apiMock.mockResolvedValue(null);

    render(
      <RestoreDiffPreview
        filePath={filePath}
        restoreContent="restored version"
        restoreScope={scope}
      />
    );

    expect(
      await screen.findByText("This file is not on disk. Restoring will create it.")
    ).toBeInTheDocument();
  });

  it("does not fall back to an unscoped read when there is no restore scope", async () => {
    render(<RestoreDiffPreview filePath={filePath} restoreContent="restored version" />);

    expect(
      await screen.findByText(/The file on disk could not be read/)
    ).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });
});
