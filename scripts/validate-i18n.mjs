#!/usr/bin/env node

/**
 * i18n 검증 스크립트 (Namespace 기반)
 * - 중복 키 감지
 * - 언어 간 키 수 불일치 감지 (복수형 묶음 단위: 언어마다 필요한 형태만, plan F4a)
 * - 미번역(영어 잔류) 문자열 감지
 * - 문구 형식: `{{count}}`는 복수형 묶음, `(s)` 금지, 산문 `...` 금지
 *   (코드 리터럴 제외, 기존 위반은 i18n-copy-allowlist.json — 줄어들기만 함)
 *
 * Usage:
 *   node scripts/validate-i18n.mjs
 *   node scripts/validate-i18n.mjs --prune-allowlist   # 고쳐진 항목만 허용 목록에서 지움
 */

import fs, { readFileSync, readdirSync, existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { NAMESPACES, BASE_LANG } from './i18n-config.mjs';
import {
  checkAllowlist,
  collectCopyViolations,
  compareLocaleKeys,
  pruneAllowlist,
} from './i18n-rules.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, "../src/i18n/locales");
const COPY_POLICY_PATH = join(__dirname, "i18n-copy-allowlist.json");
const PRUNE = process.argv.includes("--prune-allowlist");

let hasErrors = false;

function error(msg) {
  console.error(`❌ ${msg}`);
  hasErrors = true;
}

function warn(msg) {
  console.warn(`⚠️  ${msg}`);
}

const INTENTIONAL_UNTRANSLATED_KEY_PATTERNS = [
  /^common\.appName$/,
  /^common\.provider\.(claude|codex|kimi|opencode)$/,
  /^error\.copyTemplate\.separator$/,
  /^messageViewer\.(codex|opencode)$/,
  /^progressRenderer\.types\.bash$/,
  /^rendererLabels\.glob$/,
  /^terminalExecutionResultRenderer\.(stderr|stdout)$/,
  /^settingsManager\.mcp\.(argsPlaceholder|serverNamePlaceholder)$/,
  /^settingsManager\.mcp\.source\.[^.]+\.file$/,
  /^settingsManager\.mcp\.(sourceProjectMcp|sourceSettings|sourceUserMcp)$/,
  /^settingsManager\.permissions\.directoryPlaceholder$/,
  /^settingsManager\.presets\.badge\.mcpCount$/,
  /^settingsManager\.scope\.(local|project|user)\.file$/,
  /^settingsManager\.unified\.env\.keyPlaceholder$/,
];

function isIntentionallyUntranslated(key, value) {
  if (
    INTENTIONAL_UNTRANSLATED_KEY_PATTERNS.some((pattern) => pattern.test(key))
  ) {
    return true;
  }

  // CLI args, file paths, env vars, and command tokens are intentionally kept as-is.
  if (
    /^[A-Z0-9_]+$/.test(value) ||
    /(^~\/|\/|\\|\.json|\.jsonl|->|→)/.test(value)
  ) {
    return true;
  }

  return false;
}

// 1. 중복 키 감지 (JSON.parse는 중복 키를 조용히 덮어쓰므로 직접 파싱)
function findDuplicateKeys(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const keyRegex = /^\s*"([^"]+)"\s*:/gm;
  const seen = new Map();
  const duplicates = [];
  let match;

  while ((match = keyRegex.exec(content)) !== null) {
    const key = match[1];
    if (seen.has(key)) {
      duplicates.push(key);
    }
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  return duplicates;
}

// 2. 키 수집
function getKeys(langDir) {
  const allKeys = new Set();
  for (const ns of NAMESPACES) {
    const filePath = join(langDir, `${ns}.json`);
    if (!existsSync(filePath)) continue;
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    for (const key of Object.keys(content)) {
      allKeys.add(key);
    }
  }
  return allKeys;
}

// 3. Namespace별 데이터 로드
function loadNamespaceData(langDir) {
  const data = {};
  for (const ns of NAMESPACES) {
    const filePath = join(langDir, `${ns}.json`);
    if (!existsSync(filePath)) continue;
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    Object.assign(data, content);
  }
  return data;
}

// 4. 미번역 감지 (en과 동일한 값인 키 찾기)
function findUntranslated(baseData, targetData) {
  const untranslated = [];

  for (const [key, value] of Object.entries(targetData)) {
    if (
      baseData[key] === value &&
      typeof value === "string" &&
      value.length > 3 &&
      !isIntentionallyUntranslated(key, value) &&
      // 고유명사/기술용어 제외
      !/^(Claude|GitHub|Tauri|JSON|MCP|JSONL|API|URL|ID|CSV|PDF|HTML|CSS|TypeScript|JavaScript|Rust|React|Vite|ESLint|Zustand)$/i.test(
        value
      ) &&
      // 키 자체가 이름인 경우 제외
      !key.startsWith("tools.") &&
      !key.endsWith(".name")
    ) {
      untranslated.push(key);
    }
  }
  return untranslated;
}

console.log("🔍 i18n 검증 시작 (Namespace 기반)...\n");

const langDirs = readdirSync(LOCALES_DIR).filter((f) => {
  const fullPath = join(LOCALES_DIR, f);
  try {
    const stat = fs.statSync(fullPath);
    if (!stat.isDirectory()) return false;
    return readdirSync(fullPath).some((file) => file.endsWith(".json"));
  } catch {
    return false;
  }
});

const baseDir = join(LOCALES_DIR, BASE_LANG);
const baseKeys = getKeys(baseDir);
const baseData = loadNamespaceData(baseDir);

console.log(`📁 감지된 언어: ${langDirs.join(", ")}`);
console.log(`📊 기준 언어(${BASE_LANG}) 키 개수: ${baseKeys.size}\n`);

// === Step 1: 중복 키 검사 ===
console.log("📋 1. 중복 키 검사");
for (const lang of langDirs) {
  const langDir = join(LOCALES_DIR, lang);
  let langHasDupes = false;

  for (const ns of NAMESPACES) {
    const filePath = join(langDir, `${ns}.json`);
    if (!existsSync(filePath)) continue;

    const dupes = findDuplicateKeys(filePath);
    if (dupes.length > 0) {
      error(`${lang}/${ns}.json: 중복 키 ${dupes.length}개 → ${dupes.join(", ")}`);
      langHasDupes = true;
    }
  }

  if (!langHasDupes) {
    console.log(`  ✅ ${lang}: 중복 없음`);
  }
}

// === Step 2: 키 수 동기화 검사 (복수형 묶음 단위) ===
console.log("\n📋 2. 키 수 동기화 검사 (복수형 묶음 단위)");
const formsText = (items) => items.map(({ base, forms }) => `${base}(_${forms.join(", _")})`);
const listText = (items) => `${items.slice(0, 5).join(", ")}${items.length > 5 ? "..." : ""}`;
for (const lang of langDirs) {
  const langDir = join(LOCALES_DIR, lang);
  const targetKeys = getKeys(langDir);
  const { missing, extra, missingPluralForms, unusedPluralForms } = compareLocaleKeys({
    baseKeys,
    targetKeys,
    lang,
  });

  if (missing.length > 0) {
    error(`${lang}: en 대비 누락 키 ${missing.length}개 → ${listText(missing)}`);
  }
  if (missingPluralForms.length > 0) {
    error(
      `${lang}: 복수형 묶음에 필요한 형태 누락 ${missingPluralForms.length}개 → ${listText(formsText(missingPluralForms))}`
    );
  }
  if (extra.length > 0) {
    warn(`${lang}: en에 없는 추가 키 ${extra.length}개 → ${listText(extra)}`);
  }
  if (unusedPluralForms.length > 0) {
    warn(
      `${lang}: 이 언어의 복수형 규칙이 쓰지 않는 형태 ${unusedPluralForms.length}개 → ${listText(formsText(unusedPluralForms))}`
    );
  }
  if (missing.length === 0 && missingPluralForms.length === 0 && extra.length === 0) {
    console.log(`  ✅ ${lang}: ${targetKeys.size}개 키 동기화 완료`);
  }
}

// === Step 3: 미번역 검사 (en 제외) ===
console.log("\n📋 3. 미번역 문자열 검사");
for (const lang of langDirs) {
  if (lang === BASE_LANG) continue;

  const langDir = join(LOCALES_DIR, lang);
  const targetData = loadNamespaceData(langDir);
  const untranslated = findUntranslated(baseData, targetData);

  if (untranslated.length > 0) {
    warn(
      `${lang}: 미번역 의심 ${untranslated.length}개 → ${untranslated.slice(0, 5).join(", ")}${untranslated.length > 5 ? "..." : ""}`
    );
  } else {
    console.log(`  ✅ ${lang}: 미번역 문자열 없음`);
  }
}

// === Step 4: 문구 형식 (복수형 · (s) · ...) ===
console.log("\n📋 4. 문구 형식 검사 ({{count}} 복수형 묶음 · (s) · ...)");
const policy = JSON.parse(readFileSync(COPY_POLICY_PATH, "utf-8"));
// Every rule runs on every locale's own values (the count rule too: a
// translation can add `{{count}}` to a key that is plain in English).
const violations = collectCopyViolations(
  Object.fromEntries(langDirs.map((lang) => [lang, loadNamespaceData(join(LOCALES_DIR, lang))])),
  { codeLiteralKeys: policy.codeLiteralKeys },
);
if (PRUNE) {
  const pruned = { ...policy, allow: pruneAllowlist(violations, policy.allow) };
  writeFileSync(COPY_POLICY_PATH, `${JSON.stringify(pruned, null, 2)}\n`, "utf-8");
  console.log(`  ✂️  허용 목록 정리: ${COPY_POLICY_PATH}`);
  policy.allow = pruned.allow;
}
const { unlisted, stale } = checkAllowlist(violations, policy.allow);
const ruleHint = {
  "count-without-plural": "{{count}}가 있으면 _one/_other 복수형 묶음으로",
  "parenthetical-plural": "(s) 대신 복수형 묶음으로",
  "ascii-ellipsis": "... 대신 …",
};
for (const v of unlisted) {
  error(`${v.lang}: ${v.key} — ${v.rule} (${ruleHint[v.rule]})`);
}
if (stale.length > 0) {
  error(
    `허용 목록에 고쳐진 항목 ${stale.length}개가 남아 있음 → ${listText(stale.map((v) => `${v.rule}/${v.lang}/${v.key}`))} — \`node scripts/validate-i18n.mjs --prune-allowlist\` 실행`
  );
}
if (unlisted.length === 0 && stale.length === 0) {
  const byRule = {};
  for (const v of violations) byRule[v.rule] = (byRule[v.rule] ?? 0) + 1;
  console.log(
    `  ✅ 새 위반 없음 (시작 허용 목록 남은 항목: ${Object.entries(byRule).map(([r, n]) => `${r} ${n}`).join(", ") || "0"})`
  );
}

console.log(
  `\n${hasErrors ? "❌ 검증 실패 — 위의 에러를 수정하세요." : "✅ 모든 검증 통과!"}`
);
process.exit(hasErrors ? 1 : 0);
