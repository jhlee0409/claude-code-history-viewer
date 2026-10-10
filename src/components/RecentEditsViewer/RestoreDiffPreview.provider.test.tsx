/**
 * The restore confirmation renders the real diff viewer, whose
 * AdvancedTextDiff needs an ExpandKeyProvider. The confirmation sits outside
 * the expanded row that provides one, so the preview must supply its own.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
  }),
}));

vi.mock("@/services/api", () => ({ api: vi.fn().mockResolvedValue("const a = 1;\n") }));

import { RestoreDiffPreview } from "./RestoreDiffPreview";

describe("RestoreDiffPreview with the real diff viewer", () => {
  it("renders the diff without an ExpandKeyProvider from the caller", async () => {
    render(
      <RestoreDiffPreview
        filePath="/Users/alex/Projects/my-app/src/main.ts"
        restoreContent={"const a = 2;\n"}
        existsOnDisk={true}
        restoreScope={{ projectPath: "/Users/alex/.claude/projects/-Users-alex-Projects-my-app" }}
      />
    );
    await waitFor(() => expect(screen.getAllByText(/const a = /).length).toBeGreaterThan(0));
  });
});
