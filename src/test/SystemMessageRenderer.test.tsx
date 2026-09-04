import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SystemMessageRenderer } from "../components/messageRenderer/SystemMessageRenderer";
import { ExpandKeyProvider } from "../contexts/CaptureExpandContext";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
  initReactI18next: {
    type: "3rdParty",
    init: () => {},
  },
}));

describe("SystemMessageRenderer compaction boundary", () => {
  it("renders the retained summary and before/after token counts", () => {
    const { container } = render(
      <ExpandKeyProvider value="system-message-test">
        <SystemMessageRenderer
          subtype="compact_boundary"
          content="Earlier work summarized"
          compactMetadata={{
            trigger: "threshold",
            preTokens: 50_000,
            postTokens: 12_000,
          }}
          expandKey="cmp-1"
        />
      </ExpandKeyProvider>,
    );

    expect(container.textContent).toContain("Earlier work summarized");
    expect(container.textContent).toContain("50,000 → 12,000 tokens");
    expect(container.textContent).not.toContain("threshold");

    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-expanded="false"]',
    );
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle!);

    expect(container.textContent).toContain("Earlier work summarized");
    expect(container.textContent).toContain("threshold");
  });

  it("keeps a compaction warning visible while the summary is collapsed", () => {
    const { container } = render(
      <ExpandKeyProvider value="system-message-warning-test">
        <SystemMessageRenderer
          subtype="compact_boundary"
          content={"Summary preview\nHidden summary detail"}
          compactMetadata={{
            warning: "Compaction freed too little context",
          }}
          expandKey="cmp-warning"
        />
      </ExpandKeyProvider>,
    );

    expect(
      container.querySelector('button[aria-expanded="false"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain(
      "Compaction freed too little context",
    );
    expect(container.textContent).not.toContain("Hidden summary detail");
  });

  it("reveals and highlights a search match below the collapsed preview", () => {
    const { container } = render(
      <ExpandKeyProvider value="system-message-search-test">
        <SystemMessageRenderer
          subtype="compact_boundary"
          content={"Summary preview\nHidden searchable needle"}
          searchQuery="needle"
          isCurrentMatch
          currentMatchIndex={0}
          expandKey="cmp-search"
        />
      </ExpandKeyProvider>,
    );

    expect(
      container.querySelector('button[aria-expanded="true"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("Hidden searchable needle");
    expect(
      container.querySelector('[data-search-highlight="current"]'),
    ).not.toBeNull();
  });
});

describe("SystemMessageRenderer structured content", () => {
  const structuredContent = [
    { type: "text", text: "Structured system context" },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: "YWJj",
      },
    },
  ];

  it("renders inline images inside an expanded system prompt", () => {
    const { container } = render(
      <ExpandKeyProvider value="system-message-image-test">
        <SystemMessageRenderer
          subtype="system_prompt"
          content={structuredContent}
          expandKey="developer-image"
        />
      </ExpandKeyProvider>,
    );

    fireEvent.click(
      container.querySelector<HTMLButtonElement>(
        'button[aria-expanded="false"]',
      )!,
    );

    expect(container.textContent).toContain("Structured system context");
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "data:image/png;base64,YWJj",
    );
  });

  it("renders inline images inside a displayed custom message", () => {
    const { container } = render(
      <SystemMessageRenderer
        subtype="custom_notice"
        content={structuredContent}
      />,
    );

    expect(container.textContent).toContain("Structured system context");
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "data:image/png;base64,YWJj",
    );
  });
});
