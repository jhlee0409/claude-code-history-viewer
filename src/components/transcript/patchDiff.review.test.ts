import { expect, it } from "vitest";
import { parseApplyPatch, structuredSections } from "./patchDiff";

const parse = (body: string) => parseApplyPatch(`*** Begin Patch\n${body}\n*** End Patch`);
it("numbered apply_patch hunks retain both offsets and increment each side independently", () => {
  const sections = parse("*** Update File: a.ts\n@@ -40,2 +42,2 @@ title\n same\n-old\n+new\n@@ -90 +120 @@\n-last\n+LAST")![0]!.sections;
  expect(sections.map(s => [s.oldStart, s.newStart])).toEqual([[40, 42], [90, 120]]);
  expect(sections.map(s => s.lines!.map(l => [l.oldNo, l.newNo]))).toEqual([[[40, 42], [41, null], [null, 43]], [[90, null], [null, 120]]]);
});
it.each(["@@", "@@ class Widget", "@@ def method()", ""])("unnumbered apply_patch header %j does not invent line numbers", header => {
  const section = parse(`*** Update File: a.ts\n${header ? header + "\n" : ""} same\n-old\n+new`)![0]!.sections[0]!;
  expect(section.oldStart).toBeUndefined();
  expect(section.newStart).toBeUndefined();
  expect(section.lines!.map(l => [l.oldNo, l.newNo])).toEqual([[null, null], [null, null], [null, null]]);
});
it("numbered offsets do not leak to an unnumbered hunk or next file", () => {
  const files = parse("*** Update File: a.ts\n@@ -40 +42 @@\n-old\n+new\n@@ label\n+next\n*** Add File: b.ts\n+file")!;
  expect(files[0]!.sections[1]!.lines![0]!.newNo).toBeNull();
  expect(files[1]!.sections[0]!.lines![0]!.newNo).toBeNull();
});
it("zero-count numbered ranges retain the recorded zero start", () => {
  const section = parse("*** Update File: a.ts\n@@ -0,0 +1,1 @@\n+first")![0]!.sections[0]!;
  expect([section.oldStart, section.newStart]).toEqual([0, 1]);
  expect(section.lines![0]!.newNo).toBe(1);
});
it.each(["@@ -40,no +42,1 @@", "@@ -40 +42", "@@ -9007199254740992 +42 @@"])("malformed numeric header %j falls back to raw instead of false offsets", header => {
  expect(parse(`*** Update File: a.ts\n${header}\n-old\n+new`)).toBeNull();
});
it.each([
  { header: "@@ -9007199254740991 +9007199254740991 @@", rows: " last", expected: [[9007199254740991, 9007199254740991]] },
  { header: "@@ -9007199254740990,2 +9007199254740990,2 @@ label", rows: " before\n last", expected: [[9007199254740990, 9007199254740990], [9007199254740991, 9007199254740991]] },
  { header: "@@ -9007199254740991,1 +0,0 @@", rows: "-last", expected: [[9007199254740991, null]] },
  { header: "@@ -0,0 +9007199254740991,1 @@", rows: "+last", expected: [[null, 9007199254740991]] },
  { header: "@@ -0,9007199254740991 +0,9007199254740991 @@", rows: " first", expected: [[0, 0]] },
  { header: "@@ -0,0 +0,0 @@", rows: " first", expected: [[0, 0]] },
])("safe boundary coordinates remain exact: $header", ({ header, rows, expected }) => {
  const section = parse(`*** Update File: a.ts\n${header}\n${rows}`)![0]!.sections[0]!;
  expect(section.lines!.map(line => [line.oldNo, line.newNo])).toEqual(expected);
});

it("structured patch numbering remains recorded (and defaults stay compatible)", () => {
  expect(structuredSections([{ oldStart: 40, newStart: 42, lines: ["-old", "+new"] }, { lines: [" same"] }]).map(s => s.lines!.map(l => [l.oldNo, l.newNo]))).toEqual([[[40, null], [null, 42]], [[1, 1]]]);
});
