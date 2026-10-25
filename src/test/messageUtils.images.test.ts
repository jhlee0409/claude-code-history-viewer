import { describe, expect, it } from "vitest";
import { extractImageFromContent, isBase64Image, isImageUrl } from "@/utils/messageUtils";

const imageUrl = "https://example.invalid/diagram.png?size=large#preview";
const imageData = "data:image/png;base64,aGVsbG8=";

describe("whole-message image detection", () => {
  it.each([
    "https://example.invalid/diagram.png",
    imageUrl,
    "http://example.invalid/PHOTO.JPEG",
    "  https://example.invalid/diagram.webp\n",
  ])("accepts a complete HTTP(S) image URL: %s", (content) => {
    expect(isImageUrl(content)).toBe(true);
  });

  it.each([
    "logo.png",
    "Please update logo.png",
    "See https://example.invalid/diagram.png",
    "https://example.invalid/diagram.png and continue",
    "https://example.invalid/\ndiagram.png",
    "https://example.invalid/page?filename=diagram.png",
    "https://example.invalid/page#diagram.png",
    "file:///tmp/diagram.png",
    "javascript:diagram.png",
    "![diagram](https://example.invalid/diagram.png)",
    "`https://example.invalid/diagram.png`",
  ])("does not classify text as a standalone image: %s", (content) => {
    expect(isImageUrl(content)).toBe(false);
  });

  it("accepts complete image data, including surrounding whitespace", () => {
    expect(isBase64Image(imageData)).toBe(true);
    expect(isBase64Image(`\n${imageData}  `)).toBe(true);
  });

  it.each([
    "data:image/svg+xml;charset=utf-8;base64,PHN2Zy8+",
    "data:image/svg+xml;charset=utf-8;name=diagram%20preview.svg;base64,PHN2Zy8+",
    "DATA:IMAGE/SVG+XML;CHARSET=UTF-8;BASE64,PHN2Zy8+",
    "data:image/png;base64,YQ==",
    "data:image/png;base64,YWI=",
    "data:image/png;base64,YWJj",
    "data:image/png;base64,YQ",
    "data:image/png;base64,YWI",
  ])("accepts image MIME parameters and decodable base64: %s", (content) => {
    expect(isBase64Image(content)).toBe(true);
    expect(extractImageFromContent(content)).toBe(content);
    expect(extractImageFromContent([{ type: "text", text: content }])).toBe(content);
  });

  it.each([
    "data:image/png",
    "data:image/png;base64,",
    "data:image/png;base64,a",
    "data:image/png;base64,abc==",
    "data:image/png;base64,YQ=",
    "data:image/png;base64,YQ===",
    "data:image/png;base64,YW=Jj",
    "data:image/png;base64,YWJj=",
    "data:image/png;base64,YWJj_",
    "data:image/png;base64,YW Jj",
    "data:image/png;base64,YW\nJj",
    "data:image/svg+xml;charset;base64,PHN2Zy8+",
    "data:image/svg+xml;charset=;base64,PHN2Zy8+",
    "data:image/svg+xml;charset=utf-8,PHN2Zy8+",
    "data:image/svg+xml;charset=utf-8;base64,PHN2Zy8+ and more text",
    "data:image/png;base64,aGVsbG8= and more text",
    "data:text/plain;base64,aGVsbG8=",
    "Use data:image/png;base64,aGVsbG8=",
  ])("does not classify an incomplete or embedded data URL: %s", (content) => {
    expect(isBase64Image(content)).toBe(false);
    expect(extractImageFromContent(content)).toBeNull();
    expect(extractImageFromContent([{ type: "text", text: content }])).toBeNull();
  });

  it("extracts only complete images from string and text-block content", () => {
    expect(extractImageFromContent(` ${imageUrl}\n`)).toBe(imageUrl);
    expect(extractImageFromContent([{ type: "text", text: ` ${imageData}\n` }])).toBe(imageData);
    expect(extractImageFromContent([{ type: "text", text: `Look at ${imageUrl}` }])).toBeNull();
    expect(extractImageFromContent([{ type: "text", text: `\`${imageUrl}\`` }])).toBeNull();
    expect(extractImageFromContent("Please update logo.png")).toBeNull();
  });

  it("preserves structured base64 image extraction", () => {
    expect(extractImageFromContent([
      { type: "text", text: "A diagram follows" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } },
    ])).toBe(imageData);
  });
});
