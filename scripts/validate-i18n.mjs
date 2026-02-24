#!/usr/bin/env node

/**
 * i18n 검증 스크립트 (Namespace 기반)
 * - 중복 키 감지
 * - 언어 간 키 수 불일치 감지
 * - 미번역(영어 잔류) 문자열 감지
 *
 * Usage: node scripts/validate-i18n.mjs
 */

import fs, { readFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { NAMESPACES, BASE_LANG } from './i18n-config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, "../src/i18n/locales");

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
  /^common\.provider\.(claude|codex|opencode)$/,
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

// === Step 2: 키 수 동기화 검사 ===
console.log("\n📋 2. 키 수 동기화 검사");
for (const lang of langDirs) {
  if (lang === BASE_LANG) continue;

  const langDir = join(LOCALES_DIR, lang);
  const targetKeys = getKeys(langDir);

  const missingInTarget = [...baseKeys].filter((k) => !targetKeys.has(k));
  const extraInTarget = [...targetKeys].filter((k) => !baseKeys.has(k));

  if (missingInTarget.length > 0) {
    error(
      `${lang}: en 대비 누락 키 ${missingInTarget.length}개 → ${missingInTarget.slice(0, 5).join(", ")}${missingInTarget.length > 5 ? "..." : ""}`
    );
  }
  if (extraInTarget.length > 0) {
    warn(
      `${lang}: en에 없는 추가 키 ${extraInTarget.length}개 → ${extraInTarget.slice(0, 5).join(", ")}${extraInTarget.length > 5 ? "..." : ""}`
    );
  }
  if (missingInTarget.length === 0 && extraInTarget.length === 0) {
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

console.log(
  `\n${hasErrors ? "❌ 검증 실패 — 위의 에러를 수정하세요." : "✅ 모든 검증 통과!"}`
);
process.exit(hasErrors ? 1 : 0);
