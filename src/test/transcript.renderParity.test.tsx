import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ThemeProvider } from "@/contexts/theme";
import { ClaudeMessageNode } from "@/components/MessageViewer/components/ClaudeMessageNode";
import { records } from "./transcript.renderParity.fixtures";
import "@/i18n";


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
