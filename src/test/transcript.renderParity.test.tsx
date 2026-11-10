import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ThemeProvider } from "@/contexts/theme";
import { ClaudeMessageNode } from "@/components/MessageViewer/components/ClaudeMessageNode";
import { records } from "./transcript.renderParity.fixtures";
import "@/i18n";

vi.mock("@/lib/format/useFormat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/format/useFormat")>();
  return {
    ...actual,
    useFormat() {
      const format = actual.useFormat();
      return {
        ...format,
        // Keep the real formatter and timestamp markup; pin only this
        // characterization fixture's zone, independent of the test host.
        time: (...args: Parameters<typeof format.time>) =>
          format.time(args[0], { ...args[1], timeZone: "Asia/Seoul" }),
      };
    },
  };
});

function canonical(container: HTMLElement) {
  // React-generated IDs are the only volatile DOM data. Preserve all data keys.
  return container.innerHTML.replace(/_r_[a-z0-9]+_/g, "REACT_ID");
}
afterEach(cleanup);
describe("whole source-record characterization before the render bridge", () => {
  it.each(records)("preserves %s closed/open DOM and search marks", (_name, message) => {
    const view = render(<ThemeProvider><ClaudeMessageNode message={message} depth={0} searchQuery="needle" isMatch isCurrentMatch currentMatchIndex={1} /></ThemeProvider>);
    expect(canonical(view.container)).toMatchSnapshot("closed");
    for (const button of view.container.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]')) fireEvent.click(button);
    expect(canonical(view.container)).toMatchSnapshot("opened");
  });
});
