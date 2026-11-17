/**
 * The Import All preview says when the backup was made in the app language:
 * the label is translated with the date, never "Exported:" before a Korean
 * date (CodeRabbit on #692, after F3b moved the date to the app language).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "@/i18n";
import { appFormat } from "@/lib/format/useFormat";
import { ExportImport } from "./ExportImport";

const EXPORTED_AT = "2026-06-29T21:44:30Z";

vi.mock("@/utils/fileDialog", () => ({
  saveFileDialog: vi.fn(),
  openFileDialog: vi.fn(async () =>
    JSON.stringify({ version: 1, exportedAt: "2026-06-29T21:44:30Z", scopes: { user: {} } }),
  ),
}));

describe("Import All preview: when the backup was made", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it.each([
    ["en", "Exported: "],
    ["ko", "내보낸 시각: "],
    ["ja", "エクスポート日時: "],
    ["zh-CN", "导出时间："],
    ["zh-TW", "匯出時間："],
  ])("%s", async (language, label) => {
    await i18n.changeLanguage(language);
    const { unmount } = render(<ExportImport allSettings={null} />);

    fireEvent.click(screen.getByRole("button", { name: i18n.t("settingsManager.exportImport.importAllButton") }));

    const dialog = await screen.findByRole("dialog");
    const description = document.getElementById(dialog.getAttribute("aria-describedby") ?? "");
    expect(description?.textContent).toBe(`${label}${appFormat().dateTime(EXPORTED_AT)}`);

    // Close the dialog and unmount inside the test: Radix FocusScope defers
    // its unmount focus work to a timer, which must not outlive the test
    // environment (an unhandled teardown error otherwise fails the run).
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
