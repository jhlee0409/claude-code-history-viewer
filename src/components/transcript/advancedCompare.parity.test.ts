import { createElement } from "react";
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { AdvancedTextDiff } from "../AdvancedTextDiff";

// Characterization captured from the OLD rendered component before TR2b removal.
// The snapshot records exact change sequence and whitespace, not a computed oracle.
const cases = [
  ["replacement", "one red fox.\nkeep\n", "one blue fox!\nkeep\n"],
  ["whitespace", "  a  b\n\nlast", "a b\n \nlast\n"],
  ["sentences", "Hello world. Next sentence!", "Hello friend. Next sentence?"],
  ["empty", "", "new\n\n"],
] as const;
const modes = ["lines", "trimmedLines", "chars", "words", "wordsWithSpace", "sentences"] as const;
beforeAll(async () => { await i18n.changeLanguage("en"); });
afterEach(cleanup);

describe("old advanced compare six-method characterization", () => {
  for (const mode of modes) {
    it(mode, () => {
      const observed = cases.map(([name, oldText, newText]) => {
        const { container, unmount } = render(createElement(ExpandKeyProvider, { value: `legacy-${mode}-${name}`, children: createElement(AdvancedTextDiff, { oldText, newText, diffMode: mode }) }));
        const parts = [...container.querySelectorAll("span[title]")].map((part) => ({
          kind: part.getAttribute("title") === "Added" ? "add" : part.getAttribute("title") === "Removed" ? "del" : "context",
          text: part.textContent,
        }));
        expect(parts.length).toBeGreaterThan(0);
        unmount();
        return { name, parts };
      });
      expect(observed).toMatchSnapshot();
    });
  }
});
