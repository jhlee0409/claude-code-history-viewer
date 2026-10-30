// Inner-UI fixture content (plan I0): tool-outcome cases, a mixed turn,
// content blocks, CJK sessions, usage variety, provider edit shapes and
// scale sessions. Built from generate.mjs's primitives (passed in as `kit`)
// so it follows the same determinism rules; every project here has its own
// PRNG stream, so the original 25 projects' bytes are unchanged (only the
// app metadata's discovered providers gain "opencode").
//
// Each case is named in INNER_CASES (README + baseline.json list them); a
// scenario opens a session through `manifest.namedSessions[<key>]`.

import path from "node:path";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/** Named fixture cases → where they live (documentation and scenario keys). */
export const INNER_CASES = {
  "mixed-turn": "kiln-renderers: text → Read·Grep ×4 (success) → Edit diff → failing test Bash (exit code 1); short and very long paths; three index.ts",
  "outcomes": "kiln-renderers: explicit exit 1, stderr warning + exit 0, API error_code, is_error:false + exit 2 (conflict), interrupted + exit 130, tool with no result, orphan result",
  "unknown-outcome": "kiln-renderers: E15 as in the audit gallery - stdout \"\", fatal stderr, interrupted:false, no exit code, no is_error",
  "blocks": "kiln-renderers: thinking, web search (server tool + results), citations, image, document, an unknown block type",
  "cjk-ko": "kiln-renderers: Korean title and body mixed with paths and code",
  "cjk-ja": "kiln-renderers: Japanese title and body mixed with paths and code",
  "cjk-zh-CN": "kiln-renderers: Simplified Chinese title and body mixed with paths and code",
  "cjk-zh-TW": "kiln-renderers: Traditional Chinese title and body mixed with paths and code",
  "usage-mix": "meridian-usage: two models and two service tiers in one session",
  "usage-cache": "meridian-usage: a cache-read-heavy session",
  "patch-only": "prism-gateway (Codex): apply_patch edits only, one multi-file patch (update, update, add)",
  "opencode-edits": "ferry-sync (OpenCode JSON storage): edit (newString fragment), multiedit (input JSON), write with empty content; source cost only",
  "giant-turn": "quarry-scale: one turn of 2,000 blocks (1,000 tool calls + results)",
  "ten-thousand": "quarry-scale: a 10,000-message session",
};

const ONE_PX_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEUlEQVR4nGP4z8DwHwlwMDAAAAD//wMAx1wH+QAAAABJRU5ErkJggg==";

/**
 * The D12 CJK cases: [session key, title, assistant body]. Each body mixes
 * prose, paths and code, and ends with a prose run long enough to wrap the
 * transcript column whatever CJK font the system falls back to (the
 * cjkLeading probe needs a multi-line CJK text node; fixtureInner.test).
 */
export const CJK_CASES = [
  ["cjk-ko", "알림 미리보기 경로 정리하고 테스트 고쳐줘", "`src/preview/renderPreview.ts`의 공백 처리 때문에 테스트가 깨졌습니다. 경로는 `src/preview` 아래에 있고, 수정한 코드는 `input.trim().replace(/\\s+/g, \" \")` 입니다. 이어지는 설명은 좁은 창과 넓은 창 모두에서 줄바꿈과 줄 간격을 확인하기 위해 충분히 길게 쓴 한국어 문장이며, 단어 중간에서 끊기지 않고 어절 사이에서만 줄이 바뀌어야 합니다."],
  ["cjk-ja", "通知プレビューのパスを整理してテストを直して", "`src/preview/renderPreview.ts` の空白処理でテストが失敗しています。修正後のコードは `input.trim().replace(/\\s+/g, \" \")` です。長い説明文がここに続き、行の折り返しと行間を確認するための日本語の文章を十分な長さで書いています。広い画面でも狭い画面でも、この段落は二行以上に折り返されることを前提にしています。"],
  ["cjk-zh-CN", "整理通知预览路径并修复测试", "测试失败是因为 `src/preview/renderPreview.ts` 中的空白处理。修改后的代码是 `input.trim().replace(/\\s+/g, \" \")`。这里继续写一段足够长的中文说明，用来检查换行和行距在窄窗口中的表现。无论窗口宽窄，这一段都应当折成两行以上，便于测量行高与字号之比。"],
  ["cjk-zh-TW", "整理通知預覽路徑並修復測試", "測試失敗是因為 `src/preview/renderPreview.ts` 中的空白處理。修改後的程式碼是 `input.trim().replace(/\\s+/g, \" \")`。這裡繼續寫一段足夠長的中文說明，用來檢查換行與行距在窄視窗中的表現。無論視窗寬窄，這一段都應當折成兩行以上，便於測量行高與字號之比。"],
];

/** The audit gallery's E15 result, byte for byte (scratch/visual-audit/system/gallery/fixtures.tsx:161). */
export const E15_RESULT = { stdout: "", stderr: "fatal: not a git repository (or any of the parent directories): .git", interrupted: false };

function seedFor(kit, label) {
  return parseInt(kit.hexFor(`inner-seed:${label}`, 8), 16) >>> 0;
}

function claudeSession(kit, { label, cwd, sessionId, model, build, endMs }) {
  const rng = kit.createRng(seedFor(kit, label));
  const t = kit.createClaudeTranscript({ rng, cwd, sessionId, model });
  build(t, rng);
  const shift = endMs - t.clock;
  return { records: t.finalize(shift), messageCount: t.count, endMs };
}

/** assistant tool_use + user tool_result in one call. */
function round(t, { name, input, result, toolUseResult, isError, text, advanceMs }) {
  const id = t.toolUseId();
  t.assistant([...(text ? [{ type: "text", text }] : []), { type: "tool_use", id, name, input }], "tool_use");
  if (result !== undefined) t.toolResultFull(id, result, toolUseResult, isError, advanceMs);
  return id;
}

// ---------------------------------------------------------------------------
// kiln-renderers: transcript cases
// ---------------------------------------------------------------------------

function kilnSessions(cwd) {
  const p = (rel) => path.join(cwd, rel);
  const longDir = "packages/platform/services/notifications/internal/adapters/outbound/email/templates/transactional";
  return [
    {
      key: "mixed-turn",
      title: "The notification preview test fails since yesterday. Find out why and fix it.",
      build: (t) => {
        t.user("The notification preview test fails since yesterday. Find out why and fix it.");
        t.assistant([{ type: "text", text: "I'll read the preview module and its callers first." }], null);
        round(t, { name: "Read", input: { file_path: p("src/index.ts") }, result: "     1→export * from \"./preview\";\n     2→export * from \"./render\";", toolUseResult: { type: "text", file: { filePath: p("src/index.ts"), content: "export * from \"./preview\";\nexport * from \"./render\";\n", numLines: 2, startLine: 1, totalLines: 2 } } });
        round(t, { name: "Read", input: { file_path: p("src/preview/index.ts") }, result: "     1→export { renderPreview } from \"./renderPreview\";", toolUseResult: { type: "text", file: { filePath: p("src/preview/index.ts"), content: "export { renderPreview } from \"./renderPreview\";\n", numLines: 1, startLine: 1, totalLines: 1 } } });
        round(t, { name: "Grep", input: { pattern: "renderPreview", path: p("src"), output_mode: "files_with_matches" }, result: "src/preview/renderPreview.ts\nsrc/preview/index.ts\nsrc/render/index.ts", toolUseResult: { mode: "files_with_matches", numFiles: 3, filenames: ["src/preview/renderPreview.ts", "src/preview/index.ts", "src/render/index.ts"] } });
        round(t, { name: "Read", input: { file_path: p(`${longDir}/order-shipped/index.ts`) }, result: "     1→export const subject = (o: Order) => `Shipped: ${o.id}`;", toolUseResult: { type: "text", file: { filePath: p(`${longDir}/order-shipped/index.ts`), content: "export const subject = (o: Order) => `Shipped: ${o.id}`;\n", numLines: 1, startLine: 1, totalLines: 1 } } });
        const before = "export function renderPreview(input: string) {\n  return input.trim();\n}\n";
        const after = "export function renderPreview(input: string) {\n  return input.trim().replace(/\\s+/g, \" \");\n}\n";
        round(t, {
          name: "Edit",
          text: "The preview collapses whitespace in the template but not in the test input. Fixing the renderer:",
          input: { file_path: p("src/preview/renderPreview.ts"), old_string: "  return input.trim();\n", new_string: "  return input.trim().replace(/\\s+/g, \" \");\n" },
          result: `The file ${p("src/preview/renderPreview.ts")} has been updated.`,
          toolUseResult: {
            filePath: p("src/preview/renderPreview.ts"),
            oldString: "  return input.trim();\n",
            newString: "  return input.trim().replace(/\\s+/g, \" \");\n",
            originalFile: before,
            structuredPatch: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [" export function renderPreview(input: string) {", "-  return input.trim();", "+  return input.trim().replace(/\\s+/g, \" \");", " }"] }],
            userModified: false,
            replaceAll: false,
          },
        });
        const stdout = " FAIL  src/preview/renderPreview.test.ts > collapses whitespace\nAssertionError: expected 'a b' to be 'a  b'\n Test Files  1 failed | 13 passed (14)\n      Tests  1 failed | 211 passed (212)";
        round(t, {
          name: "Bash",
          input: { command: "pnpm vitest run src/preview", description: "Run the preview tests" },
          result: `Exit code 1\n${stdout}`,
          isError: true,
          toolUseResult: { stdout, stderr: "", interrupted: false, isImage: false, exitCode: 1 },
        });
        t.assistant([{ type: "text", text: "The test itself expects the old double space. I'll update the expectation next - the renderer change is right." }], "end_turn");
      },
      edits: { [p("src/preview/renderPreview.ts")]: "export function renderPreview(input: string) {\n  return input.trim().replace(/\\s+/g, \" \");\n}\n" },
    },
    {
      key: "outcomes",
      title: "Run the release checks and tell me what failed.",
      build: (t) => {
        t.user("Run the release checks and tell me what failed.");
        if (process.env.CCHV_CAPTURE_PRODUCER_CONTEXT === "1") {
          t.user("<bash-input>printf synthetic</bash-input>");
          t.user("<bash-stdout>synthetic</bash-stdout><bash-stderr></bash-stderr>");
          t.user("<task-notification><task-id>synthetic-auto</task-id><status>completed</status><summary>Synthetic automatic notification</summary></task-notification>");
        }
        round(t, { name: "Bash", input: { command: "pnpm build", description: "Build" }, result: "Exit code 1\nerror TS2322: Type 'string' is not assignable to type 'number'.", isError: true, toolUseResult: { stdout: "", stderr: "error TS2322: Type 'string' is not assignable to type 'number'.", interrupted: false, isImage: false, exitCode: 1 } });
        round(t, { name: "Bash", input: { command: "pnpm lint", description: "Lint" }, result: "warning: React version not specified in eslint-plugin-react settings\n✔ No problems found", toolUseResult: { stdout: "✔ No problems found", stderr: "warning: React version not specified in eslint-plugin-react settings", interrupted: false, isImage: false, exitCode: 0 } });
        round(t, { name: "WebFetch", input: { url: "https://status.example.com/api", prompt: "Is the API up?" }, result: [{ type: "text", text: "{\"error_code\":\"url_not_accessible\"}" }], toolUseResult: { error_code: "url_not_accessible" } });
        // A second, successful fetch: WebFetch must not tie with another tool's global count.
        round(t, { name: "WebFetch", input: { url: "https://example.com/changelog", prompt: "What changed in 2.3?" }, result: "2.3 adds retry headers.", toolUseResult: { code: 200, codeText: "OK", result: "2.3 adds retry headers.", bytes: 2048, durationMs: 120, url: "https://example.com/changelog" } });
        round(t, { name: "Bash", input: { command: "git merge origin/main", description: "Merge main" }, result: "CONFLICT (content): Merge conflict in src/index.ts\nAutomatic merge failed; fix conflicts and then commit the result.", isError: false, toolUseResult: { stdout: "CONFLICT (content): Merge conflict in src/index.ts\nAutomatic merge failed; fix conflicts and then commit the result.", stderr: "", interrupted: false, isImage: false, exitCode: 2 } });
        round(t, { name: "Bash", input: { command: "pnpm e2e", description: "End-to-end tests" }, result: "[Request interrupted by user for tool use]", isError: true, toolUseResult: { stdout: "Running 48 tests using 4 workers", stderr: "", interrupted: true, isImage: false, exitCode: 130 } });
        // A tool call that never got a result.
        round(t, { name: "Bash", input: { command: "pnpm release --dry-run", description: "Dry-run the release" } });
        // A result whose call is not in this session (page-boundary orphan).
        t.toolResultFull("toolu_orphan_000000000000000000", "ok: 3 files changed", { stdout: "ok: 3 files changed", stderr: "", interrupted: false, isImage: false }, false);
        t.assistant([{ type: "text", text: "Build failed, lint passed with a warning, the status page was unreachable, the merge has a conflict, e2e was interrupted and the release dry-run never returned." }], "end_turn");
      },
    },
    {
      key: "unknown-outcome",
      title: "Is the working tree clean before I tag the release?",
      build: (t) => {
        t.user("Is the working tree clean before I tag the release?");
        round(t, { name: "Bash", input: { command: "git status --porcelain", description: "Check the working tree" }, result: E15_RESULT.stderr, toolUseResult: { ...E15_RESULT } });
        t.assistant([{ type: "text", text: "This directory is not a git repository, so I can't tell." }], "end_turn");
      },
    },
    ...CJK_CASES.map(([key, title, body]) => ({
      key,
      title,
      build: (t) => {
        t.user(title);
        round(t, { name: "Read", input: { file_path: p("src/preview/renderPreview.ts") }, result: "     1→export function renderPreview(input: string) {", toolUseResult: { type: "text", file: { filePath: p("src/preview/renderPreview.ts"), content: "export function renderPreview(input: string) {\n", numLines: 1, startLine: 1, totalLines: 1 } } });
        t.assistant([{ type: "text", text: `${body}\n\n${body}` }], "end_turn");
      },
    })),
    {
      key: "blocks",
      title: "Here is the spec page and a screenshot of the error. What changed?",
      build: (t) => {
        t.userContent([
          { type: "text", text: "Here is the spec page and a screenshot of the error. What changed?" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: ONE_PX_PNG } },
          { type: "document", source: { type: "text", media_type: "text/plain", data: "Retry-After may now be an HTTP-date or delta-seconds." }, title: "retry-spec.txt" },
        ]);
        t.assistant(
          [
            { type: "thinking", thinking: "The user wants the change in Retry-After semantics. Search for the RFC text first.", signature: "sig_fixture" },
            { type: "server_tool_use", id: "srvtoolu_fixture_search_01", name: "web_search", input: { query: "Retry-After HTTP-date delta-seconds RFC 9110" } },
            {
              type: "web_search_tool_result",
              tool_use_id: "srvtoolu_fixture_search_01",
              content: [
                { type: "web_search_result", url: "https://www.rfc-editor.org/rfc/rfc9110#field.retry-after", title: "RFC 9110: HTTP Semantics - Retry-After", encrypted_content: "fixture", page_age: "2022-06-01" },
                { type: "web_search_result", url: "https://developer.mozilla.org/docs/Web/HTTP/Headers/Retry-After", title: "Retry-After - HTTP | MDN", encrypted_content: "fixture" },
              ],
            },
            {
              type: "text",
              text: "Retry-After accepts either an HTTP-date or a number of seconds.",
              citations: [{ type: "web_search_result_location", url: "https://www.rfc-editor.org/rfc/rfc9110#field.retry-after", title: "RFC 9110", cited_text: "Retry-After = HTTP-date / delay-seconds", encrypted_index: "fixture" }],
            },
            { type: "fixture_unknown_block", payload: { note: "a block type this viewer does not know" } },
          ],
          "end_turn",
        );
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// meridian-usage: models, tiers, cache
// ---------------------------------------------------------------------------

function meridianSessions() {
  return [
    {
      key: "usage-mix",
      title: "Plan the migration with the big model, then let the small one draft the steps.",
      build: (t) => {
        t.user("Plan the migration with the big model, then let the small one draft the steps.");
        t.assistantWith([{ type: "text", text: "Plan: split the schema change into expand / migrate / contract." }], "end_turn", { model: "claude-opus-4-8", usage: { input_tokens: 1200, cache_creation_input_tokens: 4000, cache_read_input_tokens: 9000, output_tokens: 900, service_tier: "priority" } });
        t.user("Now draft the steps.");
        t.assistantWith([{ type: "text", text: "1. Add the nullable column. 2. Backfill in batches. 3. Switch reads. 4. Drop the old column." }], "end_turn", { model: "claude-haiku-4-5", usage: { input_tokens: 800, cache_creation_input_tokens: 0, cache_read_input_tokens: 12000, output_tokens: 600, service_tier: "standard" } });
      },
    },
    {
      key: "usage-cache",
      title: "Revise section 1 of the design doc.",
      build: (t) => {
        for (let i = 0; i < 6; i += 1) {
          t.user(`Revise section ${i + 1} of the design doc.`);
          t.assistantWith([{ type: "text", text: `Section ${i + 1} revised.` }], "end_turn", { model: "claude-sonnet-4-6", usage: { input_tokens: 12, cache_creation_input_tokens: 200, cache_read_input_tokens: 480_000 + i * 1000, output_tokens: 300, service_tier: "standard" } });
        }
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// quarry-scale: 10k messages, one 2,000-block turn
// ---------------------------------------------------------------------------

function quarrySessions(cwd) {
  return [
    {
      key: "giant-turn",
      title: "Rename `log.debug` to `logger.debug` in every package.",
      build: (t) => {
        t.user("Rename `log.debug` to `logger.debug` in every package.");
        for (let i = 0; i < 1000; i += 1) {
          const file = path.join(cwd, `packages/pkg-${String(Math.floor(i / 10)).padStart(3, "0")}/src/file-${i % 10}.ts`);
          const id = t.toolUseId();
          t.assistantFixed([{ type: "tool_use", id, name: "Read", input: { file_path: file } }], "tool_use", 2000);
          t.toolResultFull(id, "     1→log.debug(\"start\");", { type: "text", file: { filePath: file, content: "log.debug(\"start\");\n", numLines: 1, startLine: 1, totalLines: 1 } }, false, 1000);
        }
        t.assistant([{ type: "text", text: "Read every file; the rename touches 1,000 call sites." }], "end_turn");
      },
    },
    {
      key: "ten-thousand",
      title: "Step 1: check the importer output for batch 1.",
      build: (t) => {
        for (let i = 0; i < 5000; i += 1) {
          t.userFixed(`Step ${i + 1}: check the importer output for batch ${i + 1}.`, 30_000);
          t.assistantFixed([{ type: "text", text: `Batch ${i + 1} imported: ${1000 + (i % 17)} rows, 0 errors.` }], "end_turn", 15_000);
        }
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Adds the inner-UI projects to the file set. `kit` = generate.mjs
 * primitives; `out`/`rel` = its file set and path helper. Returns
 * { projects, namedSessions, providers } for the manifest.
 */
export function addInnerFixture(kit, { home, out, rel, fixedNow }) {
  const projects = [];
  const namedSessions = {};

  const claudeProject = ({ org, name, ageHours, model, sessions }) => {
    const cwd = path.join(home, "work", org, name);
    const projectDir = path.join(home, ".claude", "projects", kit.encodeClaudeProjectDir(cwd));
    const endBase = fixedNow - ageHours * HOUR;
    const listed = [];
    let projectMtime = 0;
    const onDisk = new Map();
    sessions.forEach((spec, index) => {
      const endMs = endBase - index * (3 * HOUR + 11 * MINUTE);
      const sessionId = kit.uuidFor(`inner/claude/${name}/${spec.key}`);
      const built = claudeSession(kit, { label: `${name}/${spec.key}`, cwd, sessionId, model, build: spec.build, endMs });
      const filePath = path.join(projectDir, `${sessionId}.jsonl`);
      out.file(rel(filePath), kit.jsonl(built.records), built.endMs);
      projectMtime = Math.max(projectMtime, built.endMs);
      for (const [file, content] of Object.entries(spec.edits ?? {})) onDisk.set(file, content);
      const session = { id: sessionId, key: spec.key, title: spec.title, filePath, messageCount: built.messageCount, lastModified: kit.iso(built.endMs) };
      listed.push(session);
      namedSessions[spec.key] = { project: name, title: spec.title, messageCount: built.messageCount };
    });
    out.dir(rel(cwd), projectMtime);
    for (const [file, content] of [...onDisk].sort(([a], [b]) => a.localeCompare(b))) out.file(rel(file), content, projectMtime);
    projects.push({ provider: "claude", name, cwd, appPath: projectDir, lastModified: kit.iso(projectMtime), sessions: listed });
  };

  const kilnCwd = path.join(home, "work", "lab", "kiln-renderers");
  claudeProject({ org: "lab", name: "kiln-renderers", ageHours: 250, model: "claude-sonnet-4-6", sessions: kilnSessions(kilnCwd) });
  claudeProject({ org: "lab", name: "meridian-usage", ageHours: 160, model: "claude-opus-4-8", sessions: meridianSessions() });
  const quarryCwd = path.join(home, "work", "lab", "quarry-scale");
  claudeProject({ org: "lab", name: "quarry-scale", ageHours: 300, model: "claude-sonnet-4-6", sessions: quarrySessions(quarryCwd) });

  projects.push(codexPatchProject(kit, { home, out, rel, fixedNow, namedSessions }));
  projects.push(opencodeProject(kit, { home, out, rel, fixedNow, namedSessions }));
  return { projects, namedSessions };
}

/** Codex rollout with apply_patch edits only, one of them a multi-file patch. */
function codexPatchProject(kit, { home, out, rel, fixedNow, namedSessions }) {
  const name = "prism-gateway";
  const cwd = path.join(home, "work", "lab", name);
  const sessionId = kit.uuidFor(`inner/codex/${name}/patch-only`);
  const endMs = fixedNow - 270 * HOUR;
  const title = "Route the health checks through the new gateway";
  const patches = [
    ["*** Begin Patch", "*** Update File: src/routes/health.ts", "@@", "-export const path = \"/health\";", "+export const path = \"/v2/health\";", "*** End Patch"].join("\n"),
    [
      "*** Begin Patch",
      "*** Update File: src/gateway/router.ts",
      "@@",
      "-router.get(\"/health\", health);",
      "+router.get(\"/v2/health\", health);",
      "*** Update File: src/gateway/config.ts",
      "@@",
      "-export const prefix = \"\";",
      "+export const prefix = \"/v2\";",
      "*** Add File: src/gateway/README.md",
      "+# Gateway",
      "+Health checks live under /v2.",
      "*** End Patch",
    ].join("\n"),
  ];
  const lines = [];
  let clock = 0;
  const at = (advance) => {
    clock += advance;
    return clock;
  };
  const push = (t, type, payload) => lines.push({ t, type, payload });
  push(at(0), "session_meta", { id: sessionId, timestamp: null, cwd, originator: "codex_cli_rs", cli_version: "0.46.0", instructions: null, source: "cli", model_provider: "openai" });
  push(at(0), "turn_context", { cwd, approval_policy: "on-request", sandbox_policy: { mode: "workspace-write" }, model: "gpt-5.5", effort: "medium", summary: "auto" });
  push(at(1000), "response_item", { type: "message", role: "user", content: [{ type: "input_text", text: title }] });
  if (process.env.CCHV_CAPTURE_PRODUCER_CONTEXT === "1") {
    // Opt-in synthetic regression fixture only; default CI32 data is unchanged.
    push(at(100), "response_item", { type: "message", role: "user", content: [{ type: "input_text", text: '<codex_internal_context source="user_goal">Synthetic goal context</codex_internal_context>' }] });
    push(at(100), "response_item", { type: "message", role: "user", content: [{ type: "input_text", text: "<recommended_plugins>Synthetic plugin context</recommended_plugins>" }] });
    push(at(100), "response_item", { type: "message", role: "user", content: [{ type: "input_text", text: "<turn_aborted>Synthetic abort context</turn_aborted>" }] });
    push(at(100), "response_item", { type: "message", role: "user", content: [{ type: "input_text", text: "<heartbeat>\n  <automation_id>synthetic</automation_id>\n  <current_time_iso>2026-09-23T00:00:00Z</current_time_iso>\n  <instructions>\nSynthetic client wake\n  </instructions>\n</heartbeat>" }] });
  }
  patches.forEach((patch, i) => {
    const callId = `call_${kit.hexFor(`${sessionId}#patch${i}`, 24)}`;
    push(at(20_000), "response_item", { type: "custom_tool_call", status: "completed", call_id: callId, name: "apply_patch", input: patch });
    push(at(1000), "response_item", { type: "custom_tool_call_output", call_id: callId, output: JSON.stringify({ output: "Success.", metadata: { exit_code: 0, duration_seconds: 0.1 } }) });
  });
  push(at(5000), "response_item", { type: "message", role: "assistant", content: [{ type: "output_text", text: "Moved the health route under /v2 and documented it." }] });
  const shift = endMs - clock;
  const records = lines.map(({ t, type, payload }) => ({ timestamp: kit.iso(t + shift), type, payload: type === "session_meta" ? { ...payload, timestamp: kit.iso(t + shift) } : payload }));
  const start = new Date(Date.parse(records[0].timestamp));
  const ymd = [String(start.getUTCFullYear()), String(start.getUTCMonth() + 1).padStart(2, "0"), String(start.getUTCDate()).padStart(2, "0")];
  const filePath = path.join(home, ".codex", "sessions", ...ymd, `rollout-${records[0].timestamp.slice(0, 19).replaceAll(":", "-")}-${sessionId}.jsonl`);
  out.file(rel(filePath), kit.jsonl(records), endMs);
  out.dir(rel(cwd), endMs);
  for (const [file, content] of [["src/routes/health.ts", "export const path = \"/v2/health\";\n"], ["src/gateway/router.ts", "router.get(\"/v2/health\", health);\n"]]) {
    out.file(rel(path.join(cwd, file)), content, endMs);
  }
  namedSessions["patch-only"] = { project: name, title, messageCount: null };
  return { provider: "codex", name, cwd, appPath: `codex://${cwd}`, lastModified: kit.iso(endMs), sessions: [{ id: sessionId, key: "patch-only", title, filePath }] };
}

/** OpenCode JSON storage (storage/{project,session,message,part}) with three edit shapes and source cost. */
function opencodeProject(kit, { home, out, rel, fixedNow, namedSessions }) {
  const name = "ferry-sync";
  const cwd = path.join(home, "work", "lab", name);
  const storage = path.join(home, ".local", "share", "opencode", "storage");
  const projectId = `prj${kit.hexFor(`inner/opencode/${name}`, 12)}`;
  const sessionId = `ses_${kit.hexFor(`inner/opencode/${name}/s1`, 16)}`;
  const title = "Sync the ferry schedule parser with the new feed";
  const endMs = fixedNow - 280 * HOUR;
  const startMs = endMs - 10 * MINUTE;
  const file = (rel2) => path.join(cwd, rel2);
  const json = (value) => JSON.stringify(value, null, 2) + "\n";
  out.file(rel(path.join(storage, "project", `${projectId}.json`)), json({ id: projectId, worktree: cwd, vcs: "git", time: { created: startMs, updated: endMs } }), endMs);
  out.file(rel(path.join(storage, "session", projectId, `${sessionId}.json`)), json({ id: sessionId, projectID: projectId, directory: cwd, title, version: "0.15.0", time: { created: startMs, updated: endMs } }), endMs);
  const messages = [];
  let serial = 0;
  const message = (role, time, parts, extra = {}) => {
    serial += 1;
    const id = `msg_${String(serial).padStart(4, "0")}${kit.hexFor(`${sessionId}#m${serial}`, 8)}`;
    messages.push({ id, role, time, parts, extra });
  };
  let calls = 0;
  // Call ids from a counter, never from the input (it holds root-dependent paths).
  const tool = (toolName, input, output) => ({ type: "tool", tool: toolName, callID: `call_${kit.hexFor(`${sessionId}#call${(calls += 1)}`, 12)}`, state: { status: "completed", input, output } });
  message("user", startMs + 1000, [{ type: "text", text: title }]);
  message("assistant", startMs + 60_000, [
    { type: "text", text: "Updating the parser in three steps." },
    tool("edit", { filePath: file("src/parser.ts"), oldString: "const SEP = \",\";", newString: "const SEP = \";\";" }, "Edit applied successfully."),
    tool("multiedit", { filePath: file("src/schedule.ts"), edits: [{ oldString: "departs", newString: "departure" }, { oldString: "arrives", newString: "arrival" }] }, "Applied 2 edits."),
    tool("write", { filePath: file("src/.keep"), content: "" }, "Wrote file successfully."),
    // Distinct counts per tool (edit 3 > multiedit 2 > write 1): tied counts reorder between runs.
    tool("edit", { filePath: file("src/parser.ts"), oldString: "const QUOTE = \"'\";", newString: "const QUOTE = '\"';" }, "Edit applied successfully."),
    tool("edit", { filePath: file("src/feed.ts"), oldString: "v1", newString: "v2" }, "Edit applied successfully."),
    tool("multiedit", { filePath: file("src/feed.ts"), edits: [{ oldString: "http:", newString: "https:" }] }, "Applied 1 edit."),
  ], { modelID: "claude-sonnet-4-6", providerID: "anthropic", cost: 0.0421, tokens: { input: 5200, output: 640, reasoning: 0, cache: { read: 12000, write: 0 } }, parentID: null });
  message("assistant", startMs + 120_000, [{ type: "text", text: "Parser, schedule fields and the placeholder file are updated." }], { modelID: "claude-sonnet-4-6", providerID: "anthropic", cost: 0.0113, tokens: { input: 900, output: 120, reasoning: 0, cache: { read: 14000, write: 0 } } });
  for (const m of messages) {
    out.file(rel(path.join(storage, "message", sessionId, `${m.id}.json`)), json({ id: m.id, sessionID: sessionId, role: m.role, time: { created: m.time, completed: m.time + 500 }, ...m.extra }), endMs);
    m.parts.forEach((part, i) => {
      const partId = `prt_${m.id.slice(4)}${String(i).padStart(3, "0")}`;
      out.file(rel(path.join(storage, "part", m.id, `${partId}.json`)), json({ id: partId, messageID: m.id, sessionID: sessionId, ...part }), endMs);
    });
  }
  out.dir(rel(cwd), endMs);
  out.file(rel(file("src/parser.ts")), "const SEP = \";\";\n", endMs);
  out.file(rel(file("src/schedule.ts")), "export type Row = { departure: string; arrival: string };\n", endMs);
  out.file(rel(file("src/.keep")), "", endMs);
  namedSessions["opencode-edits"] = { project: name, title, messageCount: messages.length };
  return { provider: "opencode", name, cwd, appPath: `opencode://${projectId}`, lastModified: kit.iso(endMs), sessions: [{ id: sessionId, key: "opencode-edits", title }] };
}
