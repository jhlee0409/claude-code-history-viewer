#!/usr/bin/env node
/**
 * i18n 다중 useTranslation 호출 정리 스크립트
 *
 * 중복된 useTranslation 호출을 단일 호출로 정리합니다.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(__dirname, '../src');

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

let stats = {
  filesProcessed: 0,
  filesModified: 0,
  duplicatesRemoved: 0,
};

function cleanupFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  const original = content;

  // 패턴: const { t: tComponents } = useTranslation();
  // 패턴: const { t: tMessages } = useTranslation();
  // → 제거하고 tComponents, tMessages를 t로 변경

  // 1. 중복 useTranslation 호출 찾기
  const duplicatePattern = /const\s*\{\s*t\s*:\s*(tComponents|tMessages)\s*\}\s*=\s*useTranslation\(\);?\n?/g;

  const aliases = [];
  let match;
  while ((match = duplicatePattern.exec(content)) !== null) {
    aliases.push(match[1]);
    stats.duplicatesRemoved++;
  }

  // 중복 호출 제거
  content = content.replace(duplicatePattern, '');

  // 2. 별칭 사용을 t로 변경
  for (const alias of aliases) {
    // tComponents('key') → t('key')
    // tComponents("key") → t("key")
    const aliasPattern = new RegExp(`\\b${alias}\\(`, 'g');
    content = content.replace(aliasPattern, 't(');
  }

  // 3. 중복 빈 줄 정리
  content = content.replace(/\n{3,}/g, '\n\n');

  stats.filesProcessed++;

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf-8');
    stats.filesModified++;
    return true;
  }

  return false;
}

function main() {
  console.log('i18n 중복 호출 정리 시작...\n');

  const tsxFiles = findFiles(SRC_DIR, '.tsx');
  const tsFiles = findFiles(SRC_DIR, '.ts').filter(f => !f.endsWith('.d.ts'));
  const allFiles = [...tsxFiles, ...tsFiles];

  for (const file of allFiles) {
    const relativePath = path.relative(SRC_DIR, file);
    const modified = cleanupFile(file);
    if (modified) {
      console.log(`✓ ${relativePath}`);
    }
  }

  console.log('\n=== 정리 완료 ===');
  console.log(`처리된 파일: ${stats.filesProcessed}개`);
  console.log(`수정된 파일: ${stats.filesModified}개`);
  console.log(`제거된 중복 호출: ${stats.duplicatesRemoved}개`);
}

main();
