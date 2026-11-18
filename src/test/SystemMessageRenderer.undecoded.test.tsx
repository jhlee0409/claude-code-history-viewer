// The note Cursor ACP sessions carry when part of their store could not be
// decoded (#576). The backend text starts with the count
// (`providers::cursor_acp::undecoded_note`); the renderer localizes it.
import { render } from "@testing-library/react";
import { afterAll, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { SystemMessageRenderer } from "../components/messageRenderer/SystemMessageRenderer";

const BACKEND_TEXT =
  "4 items in this session's store could not be decoded and are not shown.";

describe("SystemMessageRenderer undecoded records note", () => {
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("shows the count with a localized title and plural", async () => {
    await i18n.changeLanguage("en");
    const { rerender } = render(
      <SystemMessageRenderer subtype="undecoded_records" level="warning" content={BACKEND_TEXT} />,
    );
    expect(document.body).toHaveTextContent("Some content not shown");
    expect(document.body).toHaveTextContent(
      "4 items in this session's store couldn't be decoded and aren't shown.",
    );

    rerender(
      <SystemMessageRenderer
        subtype="undecoded_records"
        level="warning"
        content="1 item in this session's store could not be decoded and is not shown."
      />,
    );
    expect(document.body).toHaveTextContent(
      "1 item in this session's store couldn't be decoded and isn't shown.",
    );

    await i18n.changeLanguage("zh-CN");
    rerender(
      <SystemMessageRenderer subtype="undecoded_records" level="warning" content={BACKEND_TEXT} />,
    );
    expect(document.body).toHaveTextContent("部分内容未显示");
    expect(document.body).toHaveTextContent("此会话存储中有 4 项无法解码，未予显示。");
  });

  it("falls back to the stored text when it carries no count", async () => {
    await i18n.changeLanguage("en");
    render(
      <SystemMessageRenderer subtype="undecoded_records" content="Some records were skipped." />,
    );
    expect(document.body).toHaveTextContent("Some records were skipped.");
  });
});
