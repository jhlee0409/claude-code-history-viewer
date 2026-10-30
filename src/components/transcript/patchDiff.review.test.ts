import { expect, it } from "vitest";
import { parseApplyPatch, structuredSections } from "./patchDiff";

// Producer: openai/codex@788b9d7bf6e37f735647b7f84b556c2a807df4d8,
// parser.rs:20,44-45; streaming_parser.rs:276-345. Audit C7 probe cases.
const parse = (body: string) => parseApplyPatch(`*** Begin Patch\n${body}\n*** End Patch`);
it.each([
  "-40,1 +42,1 @@", "- 40 +42 @@", "@property", "2024 config", "    def f():",
  "class Foo", "-40,no +42,1 @@", "-40 +42", "-9007199254740992 +42 @@",
  "-9007199254740991,3 +9007199254740991,3 @@", "+added", "@", "-040 +42 @@",
])("every @@ space suffix is an anchor, never coordinates: %j", anchor => {
  const sections = parse(`*** Update File: a.py\n@@ ${anchor}\n-old\n+new`)?.[0]?.sections;
  expect(sections).toHaveLength(1);
  expect(sections?.[0]).toMatchObject({ anchor, lines: [{ kind: "del", text: "old", oldNo: null, newNo: null }, { kind: "add", text: "new", oldNo: null, newNo: null }] });
  expect(sections?.[0]?.oldStart).toBeUndefined();
  expect(sections?.[0]?.newStart).toBeUndefined();
});
it.each(["@@\n", ""])("bare and omitted anchors have blank gutters: %j", header => {
  expect(parse(`*** Update File: a\n${header} same\n-old\n+new`)?.[0]?.sections[0]?.lines?.map(l => [l.oldNo, l.newNo])).toEqual([[null, null], [null, null], [null, null]]);
});
it("empty lines are empty context, including before an explicit anchor", () => {
  expect(parse("*** Update File: a\n\n@@ def f():\n a\n\n-b\n+c")?.[0]?.sections.map(s => s.lines?.map(l => [l.kind, l.text]))).toEqual([[["context", ""]], [["context", "a"], ["context", ""], ["del", "b"], ["add", "c"]]]);
});
it.each([
  "*** Environment ID: remote\n*** Update File: a\n@@\n-a\n+b",
  "*** Environment ID:remote\n*** Delete File: a",
  "  *** Add File: a   \n+x\n  *** Delete File: b  ",
  "*** Update File: a  \n@@ @property  \n-a  \n+b  ",
  "*** Update File: a\n*** Move to: b  \n@@\n-a\n+b\n*** End of File\n\n@@ next\n+x",
  "*** Add File: empty",
  "*** Delete File: gone",
])("upstream accepted metadata/marker examples: %j", body => expect(parse(body)).not.toBeNull());
it.each(["@@@", "@@\tanchor", "@@@@", "not a row", "\\ No newline at end of file"])("upstream invalid update row falls back: %j", row => expect(parse(`*** Update File: a\n${row}\n-old\n+new`)).toBeNull());
it.each([
  "*** Environment ID:\n*** Delete File: a",
  "*** Environment ID: x\n*** Environment ID: y\n*** Delete File: a",
  "*** Delete File: a\n*** Environment ID: x",
  "*** Update File: a",
  "*** Update File: a\n@@",
  "*** Update File: a\n@@\n@@ next\n+x",
  "*** Update File: a\n@@\n+x\n*** End of File\n+x",
  "*** Add File: a\n-not allowed",
  "*** Delete File: a\n+not allowed",
  "*** Update File: a\n+x\n*** Move to: b",
])("upstream rejects malformed operation structure: %j", body => expect(parse(body)).toBeNull());
it("patch boundary trim and lenient EOF wrappers mirror upstream", () => {
  const source = "*** Begin Patch\n*** Update File: a\n@@\n-a\n+b\n*** End Patch";
  expect(parseApplyPatch(` \n${source} \n\t`)).not.toBeNull();
  for (const marker of ["<<EOF", "<<'EOF'", '<<"EOF"']) expect(parseApplyPatch(`${marker}\n${source}\nEOF\n`)).not.toBeNull();
  expect(parseApplyPatch(source + "\ntrailing junk")).toBeNull();
  expect(parseApplyPatch(source.replace("*** End Patch", "  *** End Patch  "))).not.toBeNull();
  expect(parseApplyPatch("*** Begin Patch\n*** End Patch")).toEqual([]);
  // In UpdateFile only trim_end applies before the final line: an indented
  // marker is a context row, not an end marker (streaming_parser.rs:228,318).
  expect(parseApplyPatch(source.replace("*** End Patch", "  *** End Patch  \n*** End Patch"))?.[0]?.sections[0]?.lines?.slice(-1)[0]?.text).toBe(" *** End Patch  ");
});
it("marker whitespace follows Rust str trim, not JavaScript trim", () => {
  expect(parseApplyPatch("\u0085*** Begin Patch\n*** Delete File: a\n*** End Patch\u0085")).not.toBeNull();
  expect(parseApplyPatch("\uFEFF*** Begin Patch\n*** Delete File: a\n*** End Patch")).toBeNull();
  expect(parse("*** Delete File: a\u2028b")?.[0]?.path).toBe("a\u2028b");
});
it("structured patch numbering remains recorded (and defaults stay compatible)", () => {
  expect(structuredSections([{ oldStart: 40, newStart: 42, lines: ["-old", "+new"] }, { lines: [" same"] }]).map(s => s.lines!.map(l => [l.oldNo, l.newNo]))).toEqual([[[40, null], [null, 42]], [[1, 1]]]);
});
