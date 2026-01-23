#!/usr/bin/env node
/**
 * i18n 키 동기화 스크립트
 * 영어(en)를 기준으로 다른 언어에 누락된 키를 추가합니다.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.join(__dirname, '../src/i18n/locales');

const LANGUAGES = ['ko', 'ja', 'zh-CN', 'zh-TW'];

function main() {
  console.log('i18n 키 동기화 시작...\n');

  // 영어 파일 로드 (기준)
  const enPath = path.join(LOCALES_DIR, 'en.json');
  const en = JSON.parse(fs.readFileSync(enPath, 'utf-8'));
  const enKeys = new Set(Object.keys(en));

  console.log(`영어 키 개수: ${enKeys.size}`);

  for (const lang of LANGUAGES) {
    const langPath = path.join(LOCALES_DIR, `${lang}.json`);
    const langData = JSON.parse(fs.readFileSync(langPath, 'utf-8'));
    const langKeys = new Set(Object.keys(langData));

    // 영어에 있지만 해당 언어에 없는 키 찾기
    const missingKeys = [...enKeys].filter(k => !langKeys.has(k));

    // 해당 언어에 있지만 영어에 없는 키 찾기 (삭제 대상)
    const extraKeys = [...langKeys].filter(k => !enKeys.has(k));

    if (missingKeys.length > 0) {
      console.log(`\n${lang}: ${missingKeys.length}개 키 추가`);
      for (const key of missingKeys) {
        langData[key] = en[key]; // 영어 값으로 대체
        console.log(`  + ${key}`);
      }
    }

    if (extraKeys.length > 0) {
      console.log(`\n${lang}: ${extraKeys.length}개 불필요한 키 제거`);
      for (const key of extraKeys) {
        delete langData[key];
        console.log(`  - ${key}`);
      }
    }

    // 키 정렬 (영어 순서 기준)
    const sorted = {};
    for (const key of Object.keys(en)) {
      if (langData[key] !== undefined) {
        sorted[key] = langData[key];
      }
    }

    // 저장
    fs.writeFileSync(langPath, JSON.stringify(sorted, null, 2) + '\n', 'utf-8');
    console.log(`${lang} 저장 완료 (${Object.keys(sorted).length}개 키)`);
  }

  console.log('\n=== 동기화 완료 ===');

  // 최종 검증
  console.log('\n최종 키 개수:');
  for (const lang of ['en', ...LANGUAGES]) {
    const data = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${lang}.json`), 'utf-8'));
    console.log(`  ${lang}: ${Object.keys(data).length}개`);
  }
}

main();
