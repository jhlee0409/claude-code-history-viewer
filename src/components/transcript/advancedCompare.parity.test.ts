import { describe, expect, it } from "vitest";
import { advancedChanges } from "./advancedCompare";

// Characterization captured from the OLD rendered component before TR2b removal.
// The snapshot records exact change sequence and whitespace, not a computed oracle.
const cases = [
  ["replacement", "one red fox.\nkeep\n", "one blue fox!\nkeep\n"],
  ["whitespace", "  a  b\n\nlast", "a b\n \nlast\n"],
  ["sentences", "Hello world. Next sentence!", "Hello friend. Next sentence?"],
  ["empty", "", "new\n\n"],
] as const;
const modes = ["lines", "trimmedLines", "chars", "words", "wordsWithSpace", "sentences"] as const;

describe("old advanced compare six-method characterization", () => {
  for (const mode of modes) {
    it(mode, () => {
      const observed = cases.map(([name, oldText, newText]) => {
        const parts = advancedChanges(oldText, newText, mode).map(part => ({ kind: part.added ? "add" : part.removed ? "del" : "context", text: part.value }));
        expect(parts.length).toBeGreaterThan(0);
        return { name, parts };
      });
      expect(observed).toMatchSnapshot();
    });
  }
});
