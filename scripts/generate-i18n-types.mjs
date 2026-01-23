#!/usr/bin/env node
/**
 * i18n 타입 자동 생성 스크립트
 *
 * en.json을 읽어서 TypeScript 타입을 생성합니다.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.join(__dirname, '../src/i18n/locales');
const OUTPUT_PATH = path.join(__dirname, '../src/i18n/types.generated.ts');

/**
 * 접두사별로 키 그룹화
 */
function groupKeysByPrefix(keys) {
  const groups = new Map();

  for (const key of keys) {
    const prefix = key.split('.')[0];
    if (!groups.has(prefix)) {
      groups.set(prefix, []);
    }
    groups.get(prefix).push(key);
  }

  return groups;
}

/**
 * 접두사를 PascalCase로 변환
 */
function toPascalCase(str) {
  return str
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/**
 * 타입 파일 생성
 */
function generateTypes() {
  // en.json 로드
  const enPath = path.join(LOCALES_DIR, 'en.json');
  const enData = JSON.parse(fs.readFileSync(enPath, 'utf-8'));
  const allKeys = Object.keys(enData);

  // 접두사별 그룹화
  const groups = groupKeysByPrefix(allKeys);

  // 타입 파일 생성
  let output = `/**
 * i18n 타입 정의 (자동 생성)
 *
 * 이 파일은 scripts/generate-i18n-types.mjs에 의해 자동 생성됩니다.
 * 직접 수정하지 마세요.
 *
 * 생성 명령: pnpm run generate:i18n-types
 * 생성 시간: ${new Date().toISOString()}
 * 총 키 개수: ${allKeys.length}
 */

`;

  // 모든 키의 유니온 타입
  output += `/**
 * 모든 번역 키의 유니온 타입
 */
export type TranslationKey =
${allKeys.map(k => `  | '${k}'`).join('\n')};

`;

  // 접두사 목록
  const prefixes = Array.from(groups.keys()).sort();
  output += `/**
 * 사용 가능한 접두사 목록
 */
export type TranslationPrefix =
${prefixes.map(p => `  | '${p}'`).join('\n')};

`;

  // 접두사별 키 타입
  for (const [prefix, keys] of groups) {
    const typeName = `${toPascalCase(prefix)}Keys`;
    const subKeys = keys.map(k => k.substring(prefix.length + 1));

    output += `/**
 * ${prefix} 네임스페이스 키
 */
export type ${typeName} =
${subKeys.map(k => `  | '${k}'`).join('\n')};

`;
  }

  // 파일 저장
  fs.writeFileSync(OUTPUT_PATH, output, 'utf-8');
  console.log(`타입 파일 생성 완료: ${OUTPUT_PATH}`);
  console.log(`총 ${allKeys.length}개 키, ${prefixes.length}개 접두사`);
}

// 실행
generateTypes();
