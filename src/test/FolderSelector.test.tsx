import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FolderSelector } from "@/components/modals/folderSelect/FolderSelector";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("@/utils/platform", () => ({
  isTauri: () => false,
}));

vi.mock("@/services/api", () => ({
  api: vi.fn(),
}));

describe("FolderSelector provider discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers provider discovery directly from the missing-Claude screen", async () => {
    const onDiscoverProviders = vi.fn().mockResolvedValue(undefined);

    render(
      <FolderSelector
        onFolderSelected={vi.fn()}
        onDiscoverProviders={onDiscoverProviders}
      />
    );

    const discoverButton = screen.getByRole("button", {
      name: "Find other providers",
    });
    expect(discoverButton).toBeEnabled();

    fireEvent.click(discoverButton);

    await waitFor(() => {
      expect(onDiscoverProviders).toHaveBeenCalledOnce();
    });
  });

  it("disables provider discovery while a scan is running", () => {
    render(
      <FolderSelector
        onFolderSelected={vi.fn()}
        onDiscoverProviders={vi.fn()}
        isDiscoveringProviders
      />
    );

    expect(
      screen.getByRole("button", { name: "Searching for providers..." })
    ).toBeDisabled();
  });
});
