#!/usr/bin/env node
/**
 * i18n 공유 설정
 *
 * 모든 i18n 스크립트에서 사용하는 공통 상수 정의
 * 새 namespace 추가 시 이 파일만 수정하면 됨
 */

export const NAMESPACES = [
  'common',
  'analytics',
  'session',
  'settings',
  'tools',
  'error',
  'message',
  'renderers',
  'update',
  'feedback',
  'recentEdits',
  'archive',
  'antigravity',
  'remoteSources',
];

export const LANGUAGES = ['en', 'ko', 'ja', 'zh-CN', 'zh-TW'];

export const BASE_LANG = 'en';
