#!/usr/bin/env node
/**
 * i18n 키 마이그레이션 스크립트
 *
 * 기존 useTranslation 호출을 새 구조에 맞게 변환합니다.
 *
 * 변환 규칙:
 * 1. useTranslation("common") → useTranslation(), 키에 'common.' 접두사 추가
 * 2. useTranslation("components") → useTranslation(), 키 그대로 유지
 * 3. useTranslation("messages") → useTranslation(), 키에 'messages.' 접두사 추가
 * 4. useTranslation() (네임스페이스 없음) → 유지, 키에 적절한 접두사 추가 필요
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(__dirname, '../src');

// 파일 찾기 함수
function findFiles(dir, ext) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.includes('node_modules')) {
      files.push(...findFiles(fullPath, ext));
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      files.push(fullPath);
    }
  }

  return files;
}

// 변환 통계
const stats = {
  filesProcessed: 0,
  filesModified: 0,
  commonMigrated: 0,
  messagesMigrated: 0,
  componentsKept: 0,
};

/**
 * 파일 내용 변환
 */
function migrateFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  let modified = false;

  // 1. useTranslation("common") 또는 useTranslation('common') 처리
  // t("key") → t("common.key")
  const commonPattern = /const\s*\{\s*t(?:\s*:\s*(\w+))?\s*(?:,\s*i18n(?:\s*:\s*\w+)?)?\s*\}\s*=\s*useTranslation\(\s*["']common["']\s*\)/g;
  let commonMatch;

  while ((commonMatch = commonPattern.exec(content)) !== null) {
    const tAlias = commonMatch[1] || 't';

    // 이 t 함수의 호출 찾아서 common. 접두사 추가
    // t('key') 또는 t("key") 형태
    const tCallPattern = new RegExp(`${tAlias}\\(\\s*["']([^"']+)["']`, 'g');
    content = content.replace(tCallPattern, (match, key) => {
      // 이미 접두사가 있는지 확인
      if (!key.startsWith('common.') && !key.startsWith('components.') && !key.startsWith('messages.')) {
        stats.commonMigrated++;
        return `${tAlias}('common.${key}'`;
      }
      return match;
    });

    modified = true;
  }

  // 2. useTranslation("messages") 처리
  const messagesPattern = /const\s*\{\s*t(?:\s*:\s*(\w+))?\s*(?:,\s*i18n(?:\s*:\s*\w+)?)?\s*\}\s*=\s*useTranslation\(\s*["']messages["']\s*\)/g;
  let messagesMatch;

  while ((messagesMatch = messagesPattern.exec(content)) !== null) {
    const tAlias = messagesMatch[1] || 't';

    const tCallPattern = new RegExp(`${tAlias}\\(\\s*["']([^"']+)["']`, 'g');
    content = content.replace(tCallPattern, (match, key) => {
      if (!key.startsWith('messages.')) {
        stats.messagesMigrated++;
        return `${tAlias}('messages.${key}'`;
      }
      return match;
    });

    modified = true;
  }

  // 3. useTranslation("components") → useTranslation()
  // 키는 그대로 유지 (이미 접두사가 있음)
  if (content.includes('useTranslation("components")') || content.includes("useTranslation('components')")) {
    stats.componentsKept++;
    modified = true;
  }

  // 4. 네임스페이스 제거: useTranslation("xxx") → useTranslation()
  content = content.replace(/useTranslation\(\s*["'](common|components|messages)["']\s*\)/g, 'useTranslation()');

  // 5. 다중 useTranslation 호출 정리
  // const { t } = useTranslation();
  // const { t: tComponents } = useTranslation();
  // → const { t } = useTranslation();

  stats.filesProcessed++;

  if (modified || content !== fs.readFileSync(filePath, 'utf-8')) {
    fs.writeFileSync(filePath, content, 'utf-8');
    stats.filesModified++;
    return true;
  }

  return false;
}

/**
 * 메인 실행
 */
function main() {
  console.log('i18n 키 마이그레이션 시작...\n');

  const tsxFiles = findFiles(SRC_DIR, '.tsx');
  const tsFiles = findFiles(SRC_DIR, '.ts').filter(f => !f.endsWith('.d.ts'));
  const allFiles = [...tsxFiles, ...tsFiles];

  console.log(`처리할 파일: ${allFiles.length}개\n`);

  for (const file of allFiles) {
    const relativePath = path.relative(SRC_DIR, file);
    const modified = migrateFile(file);
    if (modified) {
      console.log(`✓ ${relativePath}`);
    }
  }

  console.log('\n=== 마이그레이션 완료 ===');
  console.log(`처리된 파일: ${stats.filesProcessed}개`);
  console.log(`수정된 파일: ${stats.filesModified}개`);
  console.log(`common 키 마이그레이션: ${stats.commonMigrated}개`);
  console.log(`messages 키 마이그레이션: ${stats.messagesMigrated}개`);
  console.log(`components 키 유지: ${stats.componentsKept}개`);
}

main();
