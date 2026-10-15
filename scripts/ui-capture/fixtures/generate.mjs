#!/usr/bin/env node
// Deterministic fixture HOME for the UI capture harness.
//
//   node scripts/ui-capture/fixtures/generate.mjs --root <dir>   # write <dir>/home
//   node scripts/ui-capture/fixtures/generate.mjs --verify       # prove byte-reproducibility
//
// Produces synthetic Claude Code projects (<HOME>/.claude/projects/<encoded>/<uuid>.jsonl,
// one with a subagent sidechain) and Codex CLI rollouts
// (<HOME>/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl) in the formats the Rust
// providers parse, plus the app metadata that makes Codex visible on startup
// (<HOME>/.claude-history-viewer/user-data.json → settings.discoveredProviderIds).
//
// Determinism rules: no clock, no Math.random, ids are hashes of stable labels,
// every value comes from the catalog or a seeded PRNG consumed in a fixed order,
// files are written in sorted order and every file/dir mtime is pinned. The only
// input besides the catalog is the root path, which ends up in `cwd` fields and
// in the encoded Claude project folder names (the app needs real absolute
// project directories, see README).

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as C from "./catalog.mjs";

const FIXED_NOW = Date.parse(C.FIXED_NOW_ISO);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const CLAUDE_VERSION = "2.1.9";
const CODEX_CLI_VERSION = "0.46.0";

// ---------------------------------------------------------------------------
// Deterministic primitives
// ---------------------------------------------------------------------------

/** mulberry32: small, fast, good enough for fixture variety. */
function createRng(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
  };
}

const sha256 = (text) => createHash("sha256").update(text).digest();

/** RFC 4122 v4-shaped uuid derived from a stable label. */
function uuidFor(label) {
  const bytes = Buffer.from(sha256(`cchv-ui-capture:${label}`).subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const hexFor = (label, length) =>
  sha256(`cchv-ui-capture:${label}`).toString("hex").slice(0, length);

const iso = (ms) => new Date(ms).toISOString();

/** Claude Code's project folder encoding: every non-alphanumeric char → "-". */
export const encodeClaudeProjectDir = (cwd) => cwd.replace(/[^a-zA-Z0-9]/g, "-");

const fill = (template, file) => template.replaceAll("{file}", file);

// ---------------------------------------------------------------------------
// File set: collect everything in memory, then write sorted with pinned mtimes
// ---------------------------------------------------------------------------

function createFileSet() {
  const files = new Map(); // relPath -> { content: Buffer, mtimeMs }
  const dirs = new Map(); // relPath -> mtimeMs (explicit empty dirs and parents)
  const addDirChain = (relDir, mtimeMs) => {
    let current = relDir;
    while (current && current !== ".") {
      dirs.set(current, Math.max(dirs.get(current) ?? 0, mtimeMs));
      current = path.dirname(current);
    }
  };
  return {
    file(relPath, content, mtimeMs) {
      if (files.has(relPath)) throw new Error(`fixture: duplicate file ${relPath}`);
      files.set(relPath, { content: Buffer.from(content), mtimeMs });
      addDirChain(path.dirname(relPath), mtimeMs);
    },
    dir(relDir, mtimeMs) {
      addDirChain(relDir, mtimeMs);
    },
    files,
    dirs,
  };
}

function writeFileSet(root, fileSet) {
  for (const relPath of [...fileSet.files.keys()].sort()) {
    const { content, mtimeMs } = fileSet.files.get(relPath);
    const abs = path.join(root, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    fs.utimesSync(abs, new Date(mtimeMs), new Date(mtimeMs));
  }
  // Directories last, deepest first, so writing children cannot bump them.
  const relDirs = [...fileSet.dirs.keys()].sort(
    (a, b) => b.split(path.sep).length - a.split(path.sep).length || a.localeCompare(b),
  );
  for (const relDir of relDirs) {
    const abs = path.join(root, relDir);
    fs.mkdirSync(abs, { recursive: true });
    const mtime = new Date(fileSet.dirs.get(relDir));
    fs.utimesSync(abs, mtime, mtime);
  }
}

const jsonl = (records) => records.map((record) => JSON.stringify(record)).join("\n") + "\n";

// ---------------------------------------------------------------------------
// Claude Code sessions
// ---------------------------------------------------------------------------

/**
 * Tool kinds in rank order, with the share each should roughly get.
 *
 * The backend ranks "most used tools" by count alone and leaves ties in
 * HashMap iteration order, which is random per process, so two tools with
 * the same count swap places between runs. Every transcript therefore uses
 * its tools as a strict staircase in this order: among the tools it uses,
 * count(rank i) > count(rank i + 1), and the tools it uses are a prefix of
 * the ranking. Sums of such staircases are strict too, so project and
 * global totals cannot tie either; assertNoToolTies() checks every scope.
 */
const TOOL_RANKING = [
  { kind: "read", weight: 6 },
  { kind: "edit", weight: 5 },
  { kind: "bash", weight: 3 },
  { kind: "grep", weight: 2 },
  { kind: "write", weight: 1 },
];
const TOOL_WEIGHT_TOTAL = TOOL_RANKING.reduce((sum, tool) => sum + tool.weight, 0);

/** Next tool kind for one transcript: the most under-used one the staircase allows. */
function createToolPicker() {
  const counts = TOOL_RANKING.map(() => 0);
  let rounds = 0;
  return () => {
    rounds += 1;
    const byDeficit = TOOL_RANKING.map((tool, i) => ({ i, deficit: (tool.weight * rounds) / TOOL_WEIGHT_TOTAL - counts[i] })).sort(
      (a, b) => b.deficit - a.deficit || a.i - b.i,
    );
    for (const { i } of byDeficit) {
      if (i === 0 || counts[i] + 1 < counts[i - 1]) {
        counts[i] += 1;
        return TOOL_RANKING[i].kind;
      }
    }
    throw new Error("unreachable: the top-ranked tool is always allowed");
  };
}

/**
 * Builds one Claude Code transcript. Message records carry the field order
 * Claude Code writes; `count` tracks viewer-visible messages (user/assistant
 * records) so a session can be sized exactly. Times are relative while
 * building; `finalize(shiftMs)` turns them into ISO timestamps so a session
 * can be anchored to end exactly at its catalog time.
 */
function createClaudeTranscript({ rng, cwd, sessionId, model, startMs = 0, isSidechain = false, agentId }) {
  const entries = []; // { record, uuid, t }
  let parentUuid = null;
  let clock = startMs;
  let serial = 0;
  let count = 0;
  const label = isSidechain ? `${sessionId}/${agentId}` : sessionId;

  const base = (type) => ({
    parentUuid,
    isSidechain,
    userType: "external",
    cwd,
    sessionId,
    version: CLAUDE_VERSION,
    gitBranch: "main",
    ...(agentId ? { agentId } : {}),
    type,
  });

  const push = (record, advanceMs) => {
    clock += advanceMs;
    serial += 1;
    const uuid = uuidFor(`${label}#${serial}`);
    entries.push({ record, uuid, t: clock });
    parentUuid = uuid;
    count += 1;
    return uuid;
  };

  const usage = () => ({
    input_tokens: rng.int(3, 48),
    cache_creation_input_tokens: rng.int(400, 6000),
    cache_read_input_tokens: rng.int(12_000, 96_000),
    output_tokens: rng.int(60, 1400),
    service_tier: "standard",
  });

  return {
    get count() {
      return count;
    },
    get clock() {
      return clock;
    },
    pickTool: createToolPicker(),
    /** Records with absolute timestamps: relative time + shiftMs. */
    finalize(shiftMs) {
      return entries.map(({ record, uuid, t }) => ({ ...record, uuid, timestamp: iso(t + shiftMs) }));
    },
    user(text) {
      return push({ ...base("user"), message: { role: "user", content: text } }, rng.int(40, 600) * 1000);
    },
    /** A user record at a fixed offset (no rng draw, so later data is unchanged). */
    userFixed(text, advanceMs) {
      return push({ ...base("user"), message: { role: "user", content: text } }, advanceMs);
    },
    assistant(content, stopReason) {
      const id = `msg_${hexFor(`${label}#msg${serial + 1}`, 24)}`;
      return push(
        {
          ...base("assistant"),
          message: {
            id,
            type: "message",
            role: "assistant",
            model,
            content,
            stop_reason: stopReason,
            stop_sequence: null,
            usage: usage(),
          },
          requestId: `req_${hexFor(`${label}#req${serial + 1}`, 24)}`,
        },
        rng.int(4, 40) * 1000,
      );
    },
    toolResult(toolUseId, text, toolUseResult, advanceMs) {
      return push(
        {
          ...base("user"),
          message: {
            role: "user",
            content: [{ tool_use_id: toolUseId, type: "tool_result", content: text }],
          },
          toolUseResult,
        },
        advanceMs ?? rng.int(1, 12) * 1000,
      );
    },
    toolUseId() {
      return `toolu_${hexFor(`${label}#tool${serial + 1}`, 24)}`;
    },
  };
}

/** One tool round (assistant tool_use + user tool_result) = 2 messages. */
function claudeToolRound(t, { rng, cwd, file, editsOnDisk, introText }) {
  const absFile = path.join(cwd, file);
  const kind = t.pickTool();
  const id = t.toolUseId();
  const intro = introText ? [{ type: "text", text: introText }] : [];
  if (kind === "read") {
    const content = rng.pick(C.CODE_BEFORE);
    t.assistant([...intro, { type: "tool_use", id, name: "Read", input: { file_path: absFile } }], "tool_use");
    const numbered = content.split("\n").map((line, i) => `${String(i + 1).padStart(6)}→${line}`).join("\n");
    t.toolResult(id, numbered, {
      type: "text",
      file: { filePath: absFile, content, numLines: content.split("\n").length, startLine: 1, totalLines: content.split("\n").length },
    });
  } else if (kind === "edit") {
    const variant = rng.int(0, C.CODE_BEFORE.length - 1);
    const oldString = C.CODE_BEFORE[variant];
    const newString = C.CODE_AFTER[variant];
    const originalFile = `// ${file}\n${oldString}`;
    t.assistant(
      [...intro, { type: "tool_use", id, name: "Edit", input: { file_path: absFile, old_string: oldString, new_string: newString } }],
      "tool_use",
    );
    const oldLines = oldString.trimEnd().split("\n");
    const newLines = newString.trimEnd().split("\n");
    t.toolResult(id, `The file ${absFile} has been updated. Here's the result of running \`cat -n\` on a snippet of the edited file.`, {
      filePath: absFile,
      oldString,
      newString,
      originalFile,
      structuredPatch: [
        {
          oldStart: 2,
          oldLines: oldLines.length,
          newStart: 2,
          newLines: newLines.length,
          lines: [...oldLines.map((l) => `-${l}`), ...newLines.map((l) => `+${l}`)],
        },
      ],
      userModified: false,
      replaceAll: false,
    });
    editsOnDisk.set(absFile, `// ${file}\n${newString}`);
  } else if (kind === "write") {
    const content = `// ${file}\n${rng.pick(C.CODE_AFTER)}`;
    t.assistant([...intro, { type: "tool_use", id, name: "Write", input: { file_path: absFile, content } }], "tool_use");
    t.toolResult(id, `File created successfully at: ${absFile}`, {
      type: "create",
      filePath: absFile,
      content,
      structuredPatch: [],
    });
    editsOnDisk.set(absFile, content);
  } else if (kind === "grep") {
    t.assistant([...intro, { type: "tool_use", id, name: "Grep", input: { pattern: "measureRow", path: path.join(cwd, "src"), output_mode: "content" } }], "tool_use");
    const out = "src/lib/virtualizer.ts:42:export function measureRow(id: string) {\nsrc/components/MessageList.tsx:88:  const height = measureRow(item.id);";
    t.toolResult(id, out, { mode: "content", numFiles: 2, filenames: [], content: out, numLines: 2 });
  } else {
    const cmd = rng.pick(C.BASH_COMMANDS);
    t.assistant([...intro, { type: "tool_use", id, name: "Bash", input: { command: cmd.command, description: "Run a project command" } }], "tool_use");
    t.toolResult(id, cmd.stdout || "(no output)", { stdout: cmd.stdout, stderr: "", interrupted: false, isImage: false });
  }
}

/**
 * Appends one turn of exactly `size` messages (size >= 2): the user prompt,
 * an optional text-only assistant message, k tool rounds and the final answer.
 */
function claudeTurn(t, { rng, cwd, prompt, size, lang, editsOnDisk }) {
  const intros = lang === "ko" ? C.ASSISTANT_INTROS_KO : C.ASSISTANT_INTROS_EN;
  const summaries = lang === "ko" ? C.ASSISTANT_SUMMARIES_KO : C.ASSISTANT_SUMMARIES_EN;
  const file = rng.pick(C.SOURCE_FILES);
  t.user(prompt);
  const rounds = Math.floor((size - 2) / 2);
  if ((size - 2) % 2 === 1) {
    t.assistant([{ type: "text", text: fill(rng.pick(intros), file) }], null);
  }
  for (let r = 0; r < rounds; r += 1) {
    const roundFile = r === 0 ? file : rng.pick(C.SOURCE_FILES);
    claudeToolRound(t, { rng, cwd, file: roundFile, editsOnDisk, introText: r === 0 ? fill(rng.pick(intros), roundFile) : null });
  }
  t.assistant([{ type: "text", text: fill(rng.pick(summaries), file) }], "end_turn");
}

function promptFor(rng, lang) {
  const file = rng.pick(C.SOURCE_FILES);
  return fill(rng.pick(lang === "ko" ? C.USER_PROMPTS_KO : C.USER_PROMPTS_EN), file);
}

/**
 * Builds a Claude session ending exactly at `endMs`; returns its records
 * plus any subagent files (shifted onto the same timeline).
 */
function buildClaudeSession({ rng, cwd, sessionId, model, spec, endMs, editsOnDisk }) {
  const lang = spec.lang ?? "en";
  const anchored = (t, subagents = []) => {
    const shift = endMs - t.clock;
    return {
      records: t.finalize(shift),
      endMs,
      messageCount: t.count,
      subagents: subagents.map(({ transcript, ...rest }) => ({
        ...rest,
        records: transcript.finalize(shift),
        endMs: transcript.clock + shift,
        messageCount: transcript.count,
      })),
    };
  };

  if (spec.kind === "large") {
    const target = C.LARGE_SESSION_MESSAGES;
    const t = createClaudeTranscript({ rng, cwd, sessionId, model });
    let first = true;
    while (t.count < target) {
      const remaining = target - t.count;
      // Turns of 6-14 messages; the last one is sized to land exactly on target.
      let size = rng.int(6, 14);
      if (remaining - size < 2) size = remaining;
      claudeTurn(t, { rng, cwd, prompt: first ? spec.title : promptFor(rng, lang), size, lang, editsOnDisk });
      first = false;
    }
    if (t.count !== target) throw new Error(`fixture: large session has ${t.count} messages, want ${target}`);
    return anchored(t);
  }

  if (spec.kind === "subagent") {
    const t = createClaudeTranscript({ rng, cwd, sessionId, model });
    t.user(spec.title);
    t.assistant([{ type: "text", text: "I'll delegate the bundle audit to a subagent so the main context stays small." }], null);
    const toolUseId = t.toolUseId();
    const agentId = hexFor(`${sessionId}/agent`, 17);
    const prompt = "Audit the production bundle: list the five largest modules, flag anything that is imported eagerly but only used on a secondary route, and suggest a split point for each.";
    t.assistant([{ type: "tool_use", id: toolUseId, name: "Task", input: { description: "Audit the production bundle", prompt, subagent_type: "general-purpose" } }], "tool_use");

    // The sidechain transcript itself, on the parent's timeline.
    const sub = createClaudeTranscript({ rng, cwd, sessionId, model, startMs: t.clock, isSidechain: true, agentId });
    sub.user(prompt);
    claudeToolRound(sub, { rng, cwd, file: "package.json", editsOnDisk: new Map(), introText: "Reading the build manifest first." });
    claudeToolRound(sub, { rng, cwd, file: "src/lib/virtualizer.ts", editsOnDisk: new Map(), introText: null });
    const report = "Top modules: `katex` (412 kB), `prismjs` (288 kB), `react-diff-viewer` (171 kB), `flexsearch` (96 kB), `marked` (61 kB).\n\n`katex` and `react-diff-viewer` are only used on the transcript route; load them with `import()` behind the renderer that needs them.";
    sub.assistant([{ type: "text", text: report }], "end_turn");

    // The Task result lands after the subagent finished.
    t.toolResult(toolUseId, [{ type: "text", text: report }], {
      status: "completed",
      prompt,
      agentId,
      content: [{ type: "text", text: report }],
      totalDurationMs: sub.clock - t.clock,
      totalTokens: 48_211,
      totalToolUseCount: 2,
      usage: { input_tokens: 31, cache_creation_input_tokens: 5120, cache_read_input_tokens: 42_870, output_tokens: 190, service_tier: "standard" },
    }, sub.clock - t.clock);
    // 12 messages = 5 tool rounds (Read 3, Edit 2), so no tool ties with the
    // single Task call above.
    claudeTurn(t, { rng, cwd, prompt: "Great - apply the split for katex and the diff viewer, then rerun the build.", size: 12, lang: "en", editsOnDisk });
    return anchored(t, [{ agentId, toolUseId, transcript: sub }]);
  }

  const t = createClaudeTranscript({ rng, cwd, sessionId, model });
  for (let turn = 0; turn < spec.turns; turn += 1) {
    claudeTurn(t, { rng, cwd, prompt: turn === 0 ? spec.title : promptFor(rng, lang), size: rng.int(4, 9), lang, editsOnDisk });
    // Slash-command records exactly as Claude Code writes them (tag markup in
    // a plain user message), right after the first turn so they sit near the
    // top of the session (visible without scrolling) and the title is kept.
    if (turn === 0 && spec.slashCommands) {
      for (const text of C.SLASH_COMMAND_RECORDS) t.userFixed(text, 45_000);
    }
  }
  return anchored(t);
}

// ---------------------------------------------------------------------------
// Codex CLI rollouts
// ---------------------------------------------------------------------------

/** Builds a Codex rollout ending exactly at `endMs`. */
function buildCodexSession({ rng, cwd, sessionId, model, spec, endMs }) {
  const entries = []; // { t, type, payload }
  let clock = 0;
  let messageCount = 0;
  let serial = 0;
  const totals = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0 };
  const line = (type, payload, advanceMs = 0) => {
    clock += advanceMs;
    entries.push({ t: clock, type, payload });
  };
  const item = (payload, advanceMs, counted = true) => {
    line("response_item", payload, advanceMs);
    if (counted) messageCount += 1;
  };
  const callId = () => {
    serial += 1;
    return `call_${hexFor(`${sessionId}#call${serial}`, 24)}`;
  };

  line("session_meta", {
    id: sessionId,
    timestamp: null, // filled in once the session is anchored
    cwd,
    originator: "codex_cli_rs",
    cli_version: CODEX_CLI_VERSION,
    instructions: null,
    source: "cli",
    model_provider: "openai",
  });
  line("turn_context", { cwd, approval_policy: "on-request", sandbox_policy: { mode: "workspace-write" }, model, effort: "medium", summary: "auto" });
  item(
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: `<environment_context>\n  <cwd>${cwd}</cwd>\n  <approval_policy>on-request</approval_policy>\n  <sandbox_mode>workspace-write</sandbox_mode>\n  <network_access>restricted</network_access>\n  <shell>zsh</shell>\n</environment_context>` }],
    },
    1000,
  );

  for (let turn = 0; turn < spec.turns; turn += 1) {
    const file = rng.pick(C.SOURCE_FILES);
    const prompt = turn === 0 ? spec.title : promptFor(rng, "en");
    item({ type: "message", role: "user", content: [{ type: "input_text", text: prompt }] }, rng.int(30, 300) * 1000);
    line("event_msg", { type: "user_message", message: prompt, images: [] });
    line("response_item", { type: "reasoning", summary: [{ type: "summary_text", text: `**Planning the change**\n\nI need to inspect ${file} and its tests before editing.` }], content: null, encrypted_content: null }, 3000);

    const shell = rng.pick(C.BASH_COMMANDS);
    const shellId = callId();
    item({ type: "function_call", name: "shell", arguments: JSON.stringify({ command: ["bash", "-lc", shell.command], workdir: cwd, timeout_ms: 120_000 }), call_id: shellId }, rng.int(2, 9) * 1000);
    item({ type: "function_call_output", call_id: shellId, output: JSON.stringify({ output: shell.stdout, metadata: { exit_code: 0, duration_seconds: 0.4 } }) }, rng.int(1, 6) * 1000);

    // Patch on two turns in three, never the first, so every session runs
    // shell strictly more often than apply_patch (no tied tool counts).
    if (turn % 3 !== 0) {
      const variant = rng.int(0, C.CODE_BEFORE.length - 1);
      const patch = [
        "*** Begin Patch",
        `*** Update File: ${file}`,
        "@@",
        ...C.CODE_BEFORE[variant].trimEnd().split("\n").map((l) => `-${l}`),
        ...C.CODE_AFTER[variant].trimEnd().split("\n").map((l) => `+${l}`),
        "*** End Patch",
      ].join("\n");
      const patchId = callId();
      item({ type: "custom_tool_call", status: "completed", call_id: patchId, name: "apply_patch", input: patch }, rng.int(4, 20) * 1000);
      item({ type: "custom_tool_call_output", call_id: patchId, output: JSON.stringify({ output: `Success. Updated the following files:\nM ${file}\n`, metadata: { exit_code: 0, duration_seconds: 0.1 } }) }, 1000);
    }

    const answer = `Updated \`${file}\`. ${rng.pick(["Tests pass locally.", "The change is covered by a new unit test.", "No public API changed."])}`;
    item({ type: "message", role: "assistant", content: [{ type: "output_text", text: answer }] }, rng.int(3, 15) * 1000);
    const last = { input_tokens: rng.int(6000, 24_000), cached_input_tokens: rng.int(2000, 6000), output_tokens: rng.int(200, 2400), reasoning_output_tokens: rng.int(64, 900) };
    last.total_tokens = last.input_tokens + last.output_tokens;
    for (const key of Object.keys(totals)) totals[key] += last[key];
    line("event_msg", { type: "token_count", info: { total_token_usage: { ...totals }, last_token_usage: last, model_context_window: 272_000 }, rate_limits: null });
    line("event_msg", { type: "agent_message", message: answer });
  }
  const shift = endMs - clock;
  const lines = entries.map(({ t, type, payload }) => ({
    timestamp: iso(t + shift),
    type,
    payload: type === "session_meta" ? { ...payload, timestamp: iso(t + shift) } : payload,
  }));
  return { lines, endMs, messageCount };
}

// ---------------------------------------------------------------------------
// Fixture assembly
// ---------------------------------------------------------------------------

/** Tool names as the backend counts them: Codex `shell` is reported as Bash. */
const COUNTED_TOOL_NAME = { shell: "Bash" };

function tallyTools(tally, names) {
  for (const name of names) tally.set(name, (tally.get(name) ?? 0) + 1);
  return tally;
}
const claudeToolNames = (records) =>
  records.flatMap((record) =>
    record.type === "assistant" && Array.isArray(record.message?.content)
      ? record.message.content.filter((item) => item.type === "tool_use").map((item) => item.name)
      : [],
  );
const codexToolNames = (lines) =>
  lines
    .filter((line) => line.type === "response_item" && ["function_call", "custom_tool_call"].includes(line.payload.type))
    .map((line) => COUNTED_TOOL_NAME[line.payload.name] ?? line.payload.name);
const addTally = (into, from) => {
  for (const [name, count] of from) into.set(name, (into.get(name) ?? 0) + count);
};

/**
 * Throws when two tools share a usage count in one scope: the backend's
 * "most used tools" ranking would order them randomly per process.
 */
function assertNoToolTies(scope, tally) {
  const byCount = new Map();
  for (const [name, count] of [...tally].sort(([a], [b]) => a.localeCompare(b))) {
    if (byCount.has(count)) {
      throw new Error(`fixture: ${byCount.get(count)} and ${name} are both used ${count} times in ${scope}; tied counts reorder between runs`);
    }
    byCount.set(count, name);
  }
}

/**
 * Writes the fixture under `<root>/home` (the directory is replaced) and
 * returns the manifest the capture runner uses for selectors and checks.
 */
export function generateFixture({ root }) {
  const absRoot = path.resolve(root);
  const home = path.join(absRoot, "home");
  fs.rmSync(home, { recursive: true, force: true });

  const rng = createRng(C.SEED);
  const out = createFileSet();
  const rel = (abs) => path.relative(absRoot, abs);
  const projects = [];
  let largeSession = null;
  let subagentSession = null;
  // Tool usage per stats mode: "conversation" leaves subagent transcripts
  // out, "billing" counts them (the backend's two statsMode values).
  const globalTools = { conversation: new Map(), billing: new Map() };

  for (const project of C.PROJECTS) {
    const cwd = path.join(home, "work", project.org, project.name);
    const projectEnd = FIXED_NOW - project.ageMs;
    const editsOnDisk = new Map();
    const sessions = [];
    const projectTools = { conversation: new Map(), billing: new Map() };
    let projectMtime = 0;

    project.sessions.forEach((spec, index) => {
      // Newest first, ~1-2 days apart, never equal (sort stability).
      const endMs = projectEnd - index * (26 * HOUR + 17 * MINUTE);
      const sessionId = uuidFor(`${project.provider}/${project.name}/${index}`);
      const sessionTools = { conversation: new Map(), billing: new Map() };
      if (project.provider === "claude") {
        const built = buildClaudeSession({ rng, cwd, sessionId, model: project.model, spec, endMs, editsOnDisk });
        tallyTools(sessionTools.conversation, claudeToolNames(built.records));
        tallyTools(sessionTools.billing, [...claudeToolNames(built.records), ...built.subagents.flatMap((sub) => claudeToolNames(sub.records))]);
        const projectDir = path.join(home, ".claude", "projects", encodeClaudeProjectDir(cwd));
        const filePath = path.join(projectDir, `${sessionId}.jsonl`);
        out.file(rel(filePath), jsonl(built.records), built.endMs);
        for (const sub of built.subagents) {
          const subDir = path.join(projectDir, sessionId, "subagents");
          out.file(rel(path.join(subDir, `agent-${sub.agentId}.jsonl`)), jsonl(sub.records), sub.endMs);
          out.file(rel(path.join(subDir, `agent-${sub.agentId}.meta.json`)), JSON.stringify({ toolUseId: sub.toolUseId, agentType: "general-purpose" }) + "\n", sub.endMs);
        }
        projectMtime = Math.max(projectMtime, built.endMs);
        const session = { id: sessionId, title: spec.title, kind: spec.kind ?? "normal", filePath, messageCount: built.messageCount, lastModified: iso(built.endMs), subagents: built.subagents.map((s) => ({ agentId: s.agentId, messageCount: s.messageCount })) };
        sessions.push(session);
        if (spec.kind === "large") largeSession = { ...session, project: project.name };
        if (spec.kind === "subagent") subagentSession = { ...session, project: project.name };
      } else {
        const built = buildCodexSession({ rng, cwd, sessionId, model: project.model, spec, endMs });
        tallyTools(sessionTools.conversation, codexToolNames(built.lines));
        tallyTools(sessionTools.billing, codexToolNames(built.lines));
        const start = new Date(Date.parse(built.lines[0].timestamp));
        const y = String(start.getUTCFullYear());
        const m = String(start.getUTCMonth() + 1).padStart(2, "0");
        const d = String(start.getUTCDate()).padStart(2, "0");
        const stamp = built.lines[0].timestamp.slice(0, 19).replaceAll(":", "-");
        const filePath = path.join(home, ".codex", "sessions", y, m, d, `rollout-${stamp}-${sessionId}.jsonl`);
        out.file(rel(filePath), jsonl(built.lines), built.endMs);
        projectMtime = Math.max(projectMtime, built.endMs);
        sessions.push({ id: sessionId, title: spec.title, kind: "normal", filePath, messageCount: built.messageCount, lastModified: iso(built.endMs), subagents: [] });
      }
      for (const mode of ["conversation", "billing"]) {
        assertNoToolTies(`session ${project.name}#${index} (${mode})`, sessionTools[mode]);
        addTally(projectTools[mode], sessionTools[mode]);
      }
    });
    for (const mode of ["conversation", "billing"]) {
      assertNoToolTies(`project ${project.name} (${mode})`, projectTools[mode]);
      addTally(globalTools[mode], projectTools[mode]);
    }

    // The working directory must exist (otherwise the app flags the project
    // as "location unavailable"). For the featured project, the edited files
    // exist too - except one, so Recent Edits shows both states.
    out.dir(rel(cwd), projectMtime);
    if (project === C.PROJECTS[0]) {
      const keep = [...editsOnDisk.keys()].sort().filter((file) => !file.endsWith(path.join("docs", "architecture.md")));
      for (const file of keep) out.file(rel(file), editsOnDisk.get(file), projectMtime);
    }

    projects.push({
      provider: project.provider,
      name: project.name,
      cwd,
      // What the app reports as ClaudeProject.path (selector key in the sidebar).
      appPath: project.provider === "claude" ? path.join(home, ".claude", "projects", encodeClaudeProjectDir(cwd)) : `codex://${cwd}`,
      lastModified: iso(projectMtime),
      sessions,
    });
  }

  // Claude Code user settings (Settings Manager reads these).
  out.file(
    rel(path.join(home, ".claude", "settings.json")),
    JSON.stringify(
      {
        model: "sonnet",
        cleanupPeriodDays: 30,
        includeCoAuthoredBy: false,
        permissions: { allow: ["Bash(pnpm test:*)", "Bash(git status)", "Read(src/**)"], deny: ["Read(./.env)"] },
        env: { CLAUDE_CODE_ENABLE_TELEMETRY: "0" },
      },
      null,
      2,
    ) + "\n",
    FIXED_NOW - 400 * HOUR,
  );

  // App metadata: opt Codex in so startup scans it without provider discovery
  // (projectSlice.initializeApp reads settings.discoveredProviderIds).
  out.file(
    rel(path.join(home, ".claude-history-viewer", "user-data.json")),
    JSON.stringify({ version: 1, sessions: {}, projects: {}, settings: { discoveredProviderIds: ["claude", "codex"] } }, null, 2) + "\n",
    FIXED_NOW - 400 * HOUR,
  );

  // One archive of two older sessions (Archive view content).
  const archiveProject = projects.find((p) => p.name === C.ARCHIVE.projectName);
  const archiveId = `${C.ARCHIVE.name}_${C.ARCHIVE.shortId}`;
  const archivesDir = path.join(home, ".claude-history-viewer", "archives");
  const archiveDir = path.join(archivesDir, archiveId);
  const createdAt = iso(FIXED_NOW - C.ARCHIVE.createdAgeHours * HOUR);
  const archived = archiveProject.sessions.map((session) => {
    const source = out.files.get(rel(session.filePath));
    const fileName = path.basename(session.filePath);
    out.file(rel(path.join(archiveDir, "sessions", fileName)), source.content, source.mtimeMs);
    const records = source.content.toString("utf8").trimEnd().split("\n").map((l) => JSON.parse(l));
    return {
      sessionId: fileName.replace(/\.jsonl$/, ""),
      fileName,
      originalFilePath: session.filePath,
      messageCount: session.messageCount,
      firstMessageTime: records[0].timestamp,
      lastMessageTime: records.at(-1).timestamp,
      summary: session.title,
      sizeBytes: source.content.length,
      subagentCount: 0,
      subagentSizeBytes: 0,
    };
  });
  const archiveCreatedMs = Date.parse(createdAt);
  out.file(
    rel(path.join(archiveDir, "manifest.json")),
    JSON.stringify(
      {
        version: 2,
        archiveId,
        name: C.ARCHIVE.name,
        description: C.ARCHIVE.description,
        createdAt,
        sourceProvider: "claude",
        sourceProjectPath: archiveProject.appPath,
        sourceProjectName: archiveProject.name,
        includeSubagents: false,
        sessions: archived,
      },
      null,
      2,
    ),
    archiveCreatedMs,
  );
  out.file(
    rel(path.join(archivesDir, "archive-manifest.json")),
    JSON.stringify(
      {
        version: 1,
        archives: [
          {
            id: archiveId,
            name: C.ARCHIVE.name,
            description: C.ARCHIVE.description,
            createdAt,
            sourceProvider: "claude",
            sourceProjectPath: archiveProject.appPath,
            sourceProjectName: archiveProject.name,
            sessionCount: archived.length,
            totalSizeBytes: archived.reduce((sum, s) => sum + s.sizeBytes, 0),
            includeSubagents: false,
          },
        ],
      },
      null,
      2,
    ),
    archiveCreatedMs,
  );

  const toolTotals = {};
  for (const mode of ["conversation", "billing"]) {
    assertNoToolTies(`all projects (${mode})`, globalTools[mode]);
    toolTotals[mode] = Object.fromEntries([...globalTools[mode]].sort(([, a], [, b]) => b - a));
  }

  writeFileSet(absRoot, out);

  const manifest = {
    fixtureVersion: C.FIXTURE_VERSION,
    fixedNow: C.FIXED_NOW_ISO,
    home,
    projects,
    largeSession,
    subagentSession,
    archive: { id: archiveId, name: C.ARCHIVE.name },
    toolTotals,
    digest: digestFileSet(out, absRoot),
  };
  fs.writeFileSync(path.join(absRoot, "fixture-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

/**
 * Digest over relative paths, bytes and mtimes, with the root path (and its
 * Claude folder encoding) replaced by placeholders, so two roots compare.
 */
function digestFileSet(fileSet, absRoot) {
  const normalize = (text) =>
    text.replaceAll(absRoot, "<ROOT>").replaceAll(encodeClaudeProjectDir(absRoot), "<ENCODED_ROOT>");
  const hash = createHash("sha256");
  for (const relPath of [...fileSet.files.keys()].sort()) {
    const { content, mtimeMs } = fileSet.files.get(relPath);
    hash.update(`${normalize(relPath)}\0${mtimeMs}\0`);
    hash.update(normalize(content.toString("utf8")));
    hash.update("\0");
  }
  for (const relDir of [...fileSet.dirs.keys()].sort()) {
    hash.update(`dir:${normalize(relDir)}\0${fileSet.dirs.get(relDir)}\0`);
  }
  return hash.digest("hex");
}

/**
 * Snapshot of what is on disk (paths, bytes, mtimes) - root-independent.
 * Directory mtimes are left out and `ignore(relPath)` drops files, so the
 * run's own cache writes (e.g. the app's `.session_cache.json`) can be told
 * apart from real fixture changes. Returns { digest, files } where `files`
 * maps each relative path to its own hash.
 */
export function snapshotTree(absRoot, ignore = () => false) {
  const hash = createHash("sha256");
  const files = {};
  const encodedRoot = encodeClaudeProjectDir(absRoot);
  const normalize = (text) => text.replaceAll(absRoot, "<ROOT>").replaceAll(encodedRoot, "<ENCODED_ROOT>");
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const stat = fs.statSync(abs);
      const relPath = path.relative(absRoot, abs);
      if (stat.isDirectory()) {
        walk(abs);
      } else if (!ignore(relPath)) {
        const fileHash = createHash("sha256")
          .update(`${stat.mtimeMs}\0`)
          .update(normalize(fs.readFileSync(abs, "utf8")))
          .digest("hex");
        files[relPath] = fileHash;
        hash.update(`${normalize(relPath)}\0${fileHash}\0`);
      }
    }
  };
  walk(path.join(absRoot, "home"));
  return { digest: hash.digest("hex"), files };
}

/** Root-independent digest of the generated tree, directory mtimes included. */
export function digestTree(absRoot) {
  const hash = createHash("sha256");
  const encodedRoot = encodeClaudeProjectDir(absRoot);
  const normalize = (text) => text.replaceAll(absRoot, "<ROOT>").replaceAll(encodedRoot, "<ENCODED_ROOT>");
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const stat = fs.statSync(abs);
      const relPath = normalize(path.relative(absRoot, abs));
      if (stat.isDirectory()) {
        hash.update(`dir:${relPath}\0${stat.mtimeMs}\0`);
        walk(abs);
      } else {
        hash.update(`${relPath}\0${stat.mtimeMs}\0`);
        hash.update(normalize(fs.readFileSync(abs, "utf8")));
        hash.update("\0");
      }
    }
  };
  walk(path.join(absRoot, "home"));
  return hash.digest("hex");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { root: null, verify: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--root") args.root = argv[(i += 1)];
    else if (argv[i] === "--verify") args.verify = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.verify) {
    // Two generations into two different roots must produce the same tree
    // (modulo the root itself), and the same root twice the same bytes.
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cchv-fixture-verify-"));
    const a = path.join(scratch, "a");
    const b = path.join(scratch, "b");
    const first = generateFixture({ root: a });
    const second = generateFixture({ root: b });
    const third = generateFixture({ root: a });
    const digests = { a: digestTree(a), b: digestTree(b), aAgain: digestTree(a) };
    fs.rmSync(scratch, { recursive: true, force: true });
    const same = new Set([first.digest, second.digest, third.digest]).size === 1 && new Set(Object.values(digests)).size === 1;
    console.log(JSON.stringify({ reproducible: same, manifestDigest: first.digest, treeDigests: digests }, null, 2));
    process.exit(same ? 0 : 1);
  }
  if (!args.root) throw new Error("usage: generate.mjs --root <dir> | --verify");
  const manifest = generateFixture({ root: args.root });
  console.log(JSON.stringify({ home: manifest.home, digest: manifest.digest, projects: manifest.projects.length, largeSession: manifest.largeSession.messageCount }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
