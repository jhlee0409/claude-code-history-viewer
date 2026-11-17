import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MessageContentDisplay } from "@/components/messageRenderer/MessageContentDisplay";
import { ClaudeContentArrayRenderer } from "@/components/contentRenderer/ClaudeContentArrayRenderer";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";

const wrapper = ({ children }: { children: ReactNode }) => (
  <ExpandKeyProvider value="image-regression">{children}</ExpandKeyProvider>
);
const imageUrl = "https://example.invalid/diagram.png?size=large#preview";
const imageData = "data:image/png;base64,aGVsbG8=";
const parameterizedImageData = "data:image/svg+xml;charset=utf-8;base64,PHN2Zy8+";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("message image content preservation", () => {
  it.each(["user", "assistant"])("keeps a filename in %s prose", (messageType) => {
    const content = "Please update logo.png";
    const { container } = render(<MessageContentDisplay content={content} messageType={messageType} />, { wrapper });
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain(content);
  });

  it.each([
    [`\`\`\`text\n${imageUrl}\n\`\`\``, `${imageUrl}\n`],
    [`~~~text\n${imageUrl}\n~~~`, `${imageUrl}\n`],
    [`Use \`${imageUrl}\` in the example.`, imageUrl],
  ])("keeps an image URL inside Markdown code", (content, expectedCode) => {
    const { container } = render(<MessageContentDisplay content={content} messageType="assistant" />, { wrapper });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("code")?.textContent).toBe(expectedCode);
  });

  it("preserves prose containing a bare image URL", () => {
    const content = `Compare ${imageUrl} with the previous version.`;
    const { container } = render(<MessageContentDisplay content={content} messageType="assistant" />, { wrapper });
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain(content);
  });

  it.each([
    `Use ${parameterizedImageData} in the example.`,
    "data:image/png;base64,a",
    "data:image/png;base64,abc==",
  ])("keeps prose and malformed image data visible as text", (content) => {
    const { container } = render(<MessageContentDisplay content={content} messageType="assistant" />, { wrapper });
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain(content);
  });

  it("keeps a parameterized data URL inside Markdown code", () => {
    const content = `\`\`\`text\n${parameterizedImageData}\n\`\`\``;
    const { container } = render(<MessageContentDisplay content={content} messageType="assistant" />, { wrapper });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("code")?.textContent).toBe(`${parameterizedImageData}\n`);
  });

  it("lets Markdown render an explicit image in its original position", () => {
    const content = `Before\n\n![diagram](${imageUrl})\n\nAfter`;
    const { container } = render(<MessageContentDisplay content={content} messageType="assistant" />, { wrapper });
    const paragraphs = container.querySelectorAll(".prose > p");
    expect(paragraphs[0]?.textContent).toBe("Before");
    expect(paragraphs[1]?.querySelector("img")).toHaveAttribute("src", imageUrl);
    expect(paragraphs[1]?.querySelector("img")).toHaveAttribute("alt", "diagram");
    expect(paragraphs[2]?.textContent).toBe("After");
  });

  it("preserves a Markdown link to an image as a link", () => {
    const { container } = render(<MessageContentDisplay content={`[Download diagram](${imageUrl})`} messageType="assistant" />, { wrapper });
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("link", { name: "Download diagram" })).toHaveAttribute("href", imageUrl);
  });

  it.each(["user", "assistant"])("copies the original %s text with its complete URL", (messageType) => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const content = `Keep ${imageUrl} and this suffix.`;
    const { container } = render(<MessageContentDisplay content={content} messageType={messageType} />, { wrapper });
    fireEvent.click(container.querySelector("button")!);
    expect(writeText).toHaveBeenCalledWith(content);
  });

  it("keeps image URLs available to message search", () => {
    const content = `Before ${imageUrl} after`;
    const { container } = render(<MessageContentDisplay content={content} messageType="assistant" searchQuery="diagram.png" />, { wrapper });
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain(content);
    expect(screen.getByText("diagram.png")).toBeInTheDocument();
  });

  it.each([imageUrl, imageData, parameterizedImageData])("still renders a complete image value", (content) => {
    const { container } = render(<MessageContentDisplay content={` ${content}\n`} messageType="assistant" />, { wrapper });
    expect(container.querySelector("img")).toHaveAttribute("src", content);
  });

  it("keeps structured image blocks and adjacent text", () => {
    const { container } = render(<ClaudeContentArrayRenderer content={[
      { type: "text", text: "A diagram follows" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } },
      { type: "image", source: { type: "url", url: imageUrl } },
    ]} />, { wrapper });
    const images = container.querySelectorAll("img");
    expect(container.textContent).toContain("A diagram follows");
    expect(images[0]).toHaveAttribute("src", imageData);
    expect(images[1]).toHaveAttribute("src", imageUrl);
  });
});
