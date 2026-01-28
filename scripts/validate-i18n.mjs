#!/usr/bin/env node

/**
 * i18n 검증 스크립트
 * - 중복 키 감지
 * - 언어 간 키 수 불일치 감지
 * - 미번역(영어 잔류) 문자열 감지
 *
 * Usage: node scripts/validate-i18n.mjs
 */

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, "../src/i18n/locales");
const BASE_LANG = "en.json";

let hasErrors = false;

function error(msg) {
  console.error(`❌ ${msg}`);
  hasErrors = true;
}

function warn(msg) {
  console.warn(`⚠️  ${msg}`);
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

// 2. 키 수 동기화 검증
function getKeys(filePath) {
  const content = JSON.parse(readFileSync(filePath, "utf-8"));
  return new Set(Object.keys(content));
}

// 3. 미번역 감지 (en과 동일한 값인 키 찾기)
function findUntranslated(basePath, targetPath) {
  const base = JSON.parse(readFileSync(basePath, "utf-8"));
  const target = JSON.parse(readFileSync(targetPath, "utf-8"));
  const untranslated = [];

  for (const [key, value] of Object.entries(target)) {
    if (
      base[key] === value &&
      typeof value === "string" &&
      value.length > 3 &&
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

console.log("🔍 i18n 검증 시작...\n");

const files = readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json"));
const basePath = join(LOCALES_DIR, BASE_LANG);
const baseKeys = getKeys(basePath);

// === Step 1: 중복 키 검사 ===
console.log("📋 1. 중복 키 검사");
for (const file of files) {
  const filePath = join(LOCALES_DIR, file);
  const dupes = findDuplicateKeys(filePath);
  if (dupes.length > 0) {
    error(`${file}: 중복 키 ${dupes.length}개 → ${dupes.join(", ")}`);
  } else {
    console.log(`  ✅ ${file}: 중복 없음`);
  }
}

// === Step 2: 키 수 동기화 검사 ===
console.log("\n📋 2. 키 수 동기화 검사");
for (const file of files) {
  if (file === BASE_LANG) continue;
  const targetKeys = getKeys(join(LOCALES_DIR, file));

  const missingInTarget = [...baseKeys].filter((k) => !targetKeys.has(k));
  const extraInTarget = [...targetKeys].filter((k) => !baseKeys.has(k));

  if (missingInTarget.length > 0) {
    error(
      `${file}: en.json 대비 누락 키 ${missingInTarget.length}개 → ${missingInTarget.slice(0, 5).join(", ")}${missingInTarget.length > 5 ? "..." : ""}`
    );
  }
  if (extraInTarget.length > 0) {
    warn(
      `${file}: en.json에 없는 추가 키 ${extraInTarget.length}개 → ${extraInTarget.slice(0, 5).join(", ")}${extraInTarget.length > 5 ? "..." : ""}`
    );
  }
  if (missingInTarget.length === 0 && extraInTarget.length === 0) {
    console.log(`  ✅ ${file}: ${targetKeys.size}개 키 동기화 완료`);
  }
}

// === Step 3: 미번역 검사 (en 제외) ===
console.log("\n📋 3. 미번역 문자열 검사");
for (const file of files) {
  if (file === BASE_LANG) continue;
  const untranslated = findUntranslated(basePath, join(LOCALES_DIR, file));
  if (untranslated.length > 0) {
    warn(
      `${file}: 미번역 의심 ${untranslated.length}개 → ${untranslated.slice(0, 5).join(", ")}${untranslated.length > 5 ? "..." : ""}`
    );
  } else {
    console.log(`  ✅ ${file}: 미번역 문자열 없음`);
  }
}

console.log(
  `\n${hasErrors ? "❌ 검증 실패 — 위의 에러를 수정하세요." : "✅ 모든 검증 통과!"}`
);
process.exit(hasErrors ? 1 : 0);
