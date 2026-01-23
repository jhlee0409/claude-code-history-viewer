#!/usr/bin/env node
/**
 * i18n 파일 병합 및 평탄화 스크립트
 *
 * 기존 구조: locales/{lang}/{common,components,messages}.json
 * 새 구조: locales/{lang}.json (도트 표기법으로 평탄화)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.join(__dirname, '../src/i18n/locales');

const LANGUAGES = ['en', 'ko', 'ja', 'zh-CN', 'zh-TW'];

// 네임스페이스별 접두사 매핑
const NAMESPACE_PREFIX = {
  common: '', // common은 그대로 유지하되 일부 키는 접두사 추가
  components: '', // components 키는 이미 구조화되어 있음
  messages: 'messages.' // messages 네임스페이스
};

/**
 * 중첩 객체를 도트 표기법으로 평탄화
 */
function flattenObject(obj, prefix = '', result = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenObject(value, newKey, result);
    } else {
      result[newKey] = value;
    }
  }
  return result;
}

/**
 * common.json의 키에 'common.' 접두사 추가
 * 단, 일부 키는 그대로 유지 (이미 구조화된 키)
 */
function processCommonKeys(obj) {
  const flattened = flattenObject(obj);
  const result = {};

  for (const [key, value] of Object.entries(flattened)) {
    // common 네임스페이스의 모든 키에 'common.' 접두사 추가
    result[`common.${key}`] = value;
  }

  return result;
}

/**
 * components.json의 키 처리
 * 이미 구조화된 키들이므로 그대로 평탄화
 */
function processComponentsKeys(obj) {
  return flattenObject(obj);
}

/**
 * messages.json의 키 처리
 */
function processMessagesKeys(obj) {
  const flattened = flattenObject(obj);
  const result = {};

  for (const [key, value] of Object.entries(flattened)) {
    result[`messages.${key}`] = value;
  }

  return result;
}

/**
 * 키를 알파벳 순으로 정렬 (접두사 기준 그룹화)
 */
function sortKeys(obj) {
  const sorted = {};
  const keys = Object.keys(obj).sort((a, b) => {
    // 접두사 추출
    const prefixA = a.split('.')[0];
    const prefixB = b.split('.')[0];

    // 접두사 우선순위
    const prefixOrder = [
      'common', 'analytics', 'session', 'project', 'message', 'messageViewer',
      'tools', 'toolResult', 'toolUseRenderer', 'error', 'status', 'settings',
      'update', 'updateModal', 'updateSettingsModal', 'updateIntroModal',
      'feedback', 'time', 'folderPicker', 'diffViewer', 'advancedTextDiff',
      'structuredPatch', 'contentArray', 'fileContent', 'fileEditRenderer',
      'messageContentDisplay', 'codebaseContextRenderer', 'fileListRenderer',
      'mcpRenderer', 'gitWorkflowRenderer', 'assistantMessageDetails',
      'claudeSessionHistoryRenderer', 'terminalStreamRenderer', 'webSearchRenderer',
      'thinkingRenderer', 'copyButton', 'imageRenderer', 'upToDateNotification',
      'commandRenderer', 'taskNotification', 'recentEdits', 'messages'
    ];

    const orderA = prefixOrder.indexOf(prefixA);
    const orderB = prefixOrder.indexOf(prefixB);

    if (orderA !== -1 && orderB !== -1) {
      if (orderA !== orderB) return orderA - orderB;
    } else if (orderA !== -1) {
      return -1;
    } else if (orderB !== -1) {
      return 1;
    }

    return a.localeCompare(b);
  });

  for (const key of keys) {
    sorted[key] = obj[key];
  }

  return sorted;
}

/**
 * 언어별 파일 병합 및 평탄화
 */
function processLanguage(lang) {
  const langDir = path.join(LOCALES_DIR, lang);

  // 파일 읽기
  const commonPath = path.join(langDir, 'common.json');
  const componentsPath = path.join(langDir, 'components.json');
  const messagesPath = path.join(langDir, 'messages.json');

  let common = {};
  let components = {};
  let messages = {};

  if (fs.existsSync(commonPath)) {
    common = JSON.parse(fs.readFileSync(commonPath, 'utf-8'));
  }
  if (fs.existsSync(componentsPath)) {
    components = JSON.parse(fs.readFileSync(componentsPath, 'utf-8'));
  }
  if (fs.existsSync(messagesPath)) {
    messages = JSON.parse(fs.readFileSync(messagesPath, 'utf-8'));
  }

  // 각 네임스페이스 처리
  const processedCommon = processCommonKeys(common);
  const processedComponents = processComponentsKeys(components);
  const processedMessages = processMessagesKeys(messages);

  // 병합
  const merged = {
    ...processedCommon,
    ...processedComponents,
    ...processedMessages
  };

  // 정렬
  const sorted = sortKeys(merged);

  return sorted;
}

/**
 * 메인 실행
 */
function main() {
  console.log('i18n 파일 병합 및 평탄화 시작...\n');

  const stats = {};

  for (const lang of LANGUAGES) {
    console.log(`처리 중: ${lang}`);

    const flattened = processLanguage(lang);
    const keyCount = Object.keys(flattened).length;

    // 새 파일로 저장
    const outputPath = path.join(LOCALES_DIR, `${lang}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(flattened, null, 2) + '\n', 'utf-8');

    stats[lang] = keyCount;
    console.log(`  → ${outputPath} (${keyCount}개 키)`);
  }

  console.log('\n=== 결과 요약 ===');
  for (const [lang, count] of Object.entries(stats)) {
    console.log(`${lang}: ${count}개 키`);
  }

  // 키 개수 일치 확인
  const counts = Object.values(stats);
  const allEqual = counts.every(c => c === counts[0]);

  if (allEqual) {
    console.log('\n✅ 모든 언어의 키 개수가 일치합니다.');
  } else {
    console.log('\n⚠️ 경고: 언어별 키 개수가 다릅니다!');
    console.log('   누락된 번역이 있을 수 있습니다.');
  }
}

main();
