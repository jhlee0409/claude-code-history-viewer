import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SmartJsonDisplay } from "../components/SmartJsonDisplay";

// Marks every translated string, so a literal English title cannot pass.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => `t:${key}`,
  }),
}));

describe("SmartJsonDisplay i18n", () => {
  it("translates the tooltip of every key icon", () => {
    const { container } = render(
      <SmartJsonDisplay
        data={{
          path: "/a",
          file_path: "/b",
          filename: "c",
          command: "ls",
          cmd: "ls",
          query: "q",
          id: 1,
          task_id: 2,
          uuid: "u",
          list: [],
          prompt: "p",
          description: "d",
          error: "e",
          status: "s",
          code: "x",
          allowed_tools: ["Read"],
        }}
      />
    );

    const iconTitles = Array.from(container.querySelectorAll("span[title]")).map((el) => el.getAttribute("title"));
    expect(iconTitles).toHaveLength(16);
    for (const title of iconTitles) {
      expect(title).toMatch(/^t:smartJsonDisplay\.keys\./);
    }
    expect(iconTitles).toContain("t:smartJsonDisplay.keys.path");
    expect(iconTitles).toContain("t:smartJsonDisplay.keys.allowedTools");
  });

  it("translates the empty state", () => {
    render(<SmartJsonDisplay data={null} />);
    expect(screen.getByText("t:smartJsonDisplay.noData")).toBeInTheDocument();
  });
});
