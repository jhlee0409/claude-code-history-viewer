import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import * as model from "./transcriptItems";

describe("child-1 target API boundary (wiring intentionally deferred)", () => {
  it("exports one target entry and keeps lookup-map reads inside it", () => {
    expect(typeof model.itemIndexForTarget).toBe("function");
    expect(Object.keys(model).filter(name => /target/i.test(name))).toEqual(["itemIndexForTarget"]);
    const file = ts.createSourceFile("transcriptItems.ts", readFileSync(resolve(__dirname, "./transcriptItems.ts"), "utf8"), ts.ScriptTarget.Latest, true);
    const violations: string[] = [];
    const visit = (node: ts.Node, owner: string) => {
      if (ts.isFunctionDeclaration(node)) owner = node.name?.text ?? "anonymous";
      if (ts.isPropertyAccessExpression(node) && node.name.text === "get" && ts.isPropertyAccessExpression(node.expression) && ["blockToItemIndex", "messageToItemIndexes"].includes(node.expression.name.text) && owner !== "itemIndexForTarget") violations.push(owner);
      ts.forEachChild(node, child => visit(child, owner));
    };
    visit(file, "module");
    expect(violations).toEqual([]);
  });
  it("leaves the legacy virtualizer unconnected for this child", () => {
    const hook = readFileSync(resolve(__dirname, "../MessageViewer/hooks/useMessageVirtualization.ts"), "utf8");
    expect(hook).toContain("flattenMessageTree");
    expect(hook).not.toContain("transcriptItems");
  });
});
