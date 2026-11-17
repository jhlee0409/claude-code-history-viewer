#!/usr/bin/env node
/**
 * i18n 타입 자동 생성 스크립트
 *
 * namespace별 JSON 파일들을 읽어서 TypeScript 타입을 생성합니다.
 * 구조: locales/{lang}/{namespace}.json
 *
 * 복수형 묶음(`x_one`·`x_other` …)은 바탕 키 `x` 하나가 된다: 코드는
 * `t("x", { count })`로 부르고, i18next가 언어에 맞는 형태를 고른다(plan F4a).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { NAMESPACES } from './i18n-config.mjs';
import { typeKeys } from './i18n-rules.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.join(__dirname, '../src/i18n/locales');
const OUTPUT_PATH = path.join(__dirname, '../src/i18n/types.generated.ts');

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
 * Namespace별 키를 그룹화
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
 * 타입 파일 생성
 */
function generateTypes() {
  const enDir = path.join(LOCALES_DIR, 'en');

  // Namespace별 키 수집
  const namespaceKeys = new Map();
  let allKeys = [];

  for (const ns of NAMESPACES) {
    const nsPath = path.join(enDir, `${ns}.json`);
    if (!fs.existsSync(nsPath)) {
      console.warn(`경고: ${nsPath} 파일이 없습니다.`);
      continue;
    }

    const nsData = JSON.parse(fs.readFileSync(nsPath, 'utf-8'));
    const keys = typeKeys(Object.keys(nsData));
    namespaceKeys.set(ns, keys);
    allKeys = allKeys.concat(keys);
  }

  // 접두사별 그룹화 (기존 호환성)
  const prefixGroups = groupKeysByPrefix(allKeys);

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
 * Namespace 수: ${NAMESPACES.length}
 */

`;

  // Namespace 타입
  output += `/**
 * 사용 가능한 Namespace 목록
 *
 * 각 namespace는 LLM이 한 번에 처리 가능한 크기로 분리됨:
 * - common: 공통 UI 요소 (~99 keys)
 * - analytics: 분석 대시보드 (~132 keys)
 * - session: 세션/프로젝트 (~116 keys)
 * - settings: 설정 관리자 (~501 keys)
 * - tools: 도구 관련 (~69 keys)
 * - error: 에러 메시지 (~37 keys)
 * - message: 메시지 뷰어 (~66 keys)
 * - renderers: 렌더러 컴포넌트 (~255 keys)
 * - update: 업데이트 관련 (~65 keys)
 * - feedback: 피드백 (~32 keys)
 * - recentEdits: 최근 편집 (~20 keys)
 * - archive: 아카이브
 * - webui: WebUI(브라우저 모드)
 */
export type I18nNamespace =
${NAMESPACES.map(ns => `  | '${ns}'`).join('\n')};

`;

  // Namespace별 키 타입
  for (const [ns, keys] of namespaceKeys) {
    const typeName = `${toPascalCase(ns)}Keys`;
    output += `/**
 * ${ns} namespace의 번역 키 (${keys.length}개)
 * 파일: locales/{lang}/${ns}.json
 */
export type ${typeName} =
${keys.sort().map(k => `  | '${k}'`).join('\n')};

`;
  }

  // 모든 키의 유니온 타입
  output += `/**
 * 모든 번역 키의 유니온 타입
 */
export type TranslationKey =
${allKeys.sort().map(k => `  | '${k}'`).join('\n')};

`;

  // 접두사 목록 (기존 호환성)
  const prefixes = Array.from(prefixGroups.keys()).sort();
  output += `/**
 * 사용 가능한 접두사 목록 (기존 호환성)
 */
export type TranslationPrefix =
${prefixes.map(p => `  | '${p}'`).join('\n')};
`;

  // 파일 저장
  fs.writeFileSync(OUTPUT_PATH, output, 'utf-8');
  console.log(`타입 파일 생성 완료: ${OUTPUT_PATH}`);
  console.log(`총 ${allKeys.length}개 키, ${NAMESPACES.length}개 namespace, ${prefixes.length}개 접두사`);

  // Namespace별 통계
  console.log('\n=== Namespace별 키 개수 ===');
  for (const [ns, keys] of namespaceKeys) {
    console.log(`  ${ns}: ${keys.length} keys`);
  }
}

// 실행
generateTypes();
