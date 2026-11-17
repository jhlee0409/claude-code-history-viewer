/**
 * A tab that is not on screen and saved no project name is labelled by the
 * last part of its project's path - on Windows as on POSIX (PR #673 review).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@/services/api", () => ({ api: vi.fn(async () => null) }));
vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});

import { useAppStore } from "@/store/useAppStore";
import { blankDocument } from "@/navigation/documents";
import { useTabItems } from "@/layouts/shell/useTabItems";

const pristine = useAppStore.getState();
beforeEach(() => useAppStore.setState(pristine, true));

const labelOfTabIn = (projectPath: string) => {
  const active = blankDocument("active");
  const other = { ...blankDocument("other"), project: { provider: "claude", path: projectPath } };
  useAppStore.setState({ documents: [active, other], activeDocumentId: "active", hydratedDocumentId: "active" });
  const { result } = renderHook(() => useTabItems());
  return result.current.find((item) => item.id === "other")?.label;
};

describe("an unopened tab's project label", () => {
  it.each([
    ["a POSIX path", "/Users/alex/Projects/my-repo"],
    ["a Windows path", "C:\\Users\\alex\\Projects\\my-repo"],
    ["a Windows path with a trailing separator", "C:\\Users\\alex\\Projects\\my-repo\\"],
  ])("names the folder for %s", (_kind, path) => {
    expect(labelOfTabIn(path)).toBe("my-repo");
  });
});
