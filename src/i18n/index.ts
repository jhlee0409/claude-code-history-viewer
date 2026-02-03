import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Namespace별 JSON import - LLM 친화적 구조
// 각 namespace는 2-40KB로 단일 컨텍스트에서 처리 가능

// English
import enCommon from './locales/en/common.json';
import enAnalytics from './locales/en/analytics.json';
import enSession from './locales/en/session.json';
import enSettings from './locales/en/settings.json';
import enTools from './locales/en/tools.json';
import enError from './locales/en/error.json';
import enMessage from './locales/en/message.json';
import enRenderers from './locales/en/renderers.json';
import enUpdate from './locales/en/update.json';
import enFeedback from './locales/en/feedback.json';
import enRecentEdits from './locales/en/recentEdits.json';

// Korean
import koCommon from './locales/ko/common.json';
import koAnalytics from './locales/ko/analytics.json';
import koSession from './locales/ko/session.json';
import koSettings from './locales/ko/settings.json';
import koTools from './locales/ko/tools.json';
import koError from './locales/ko/error.json';
import koMessage from './locales/ko/message.json';
import koRenderers from './locales/ko/renderers.json';
import koUpdate from './locales/ko/update.json';
import koFeedback from './locales/ko/feedback.json';
import koRecentEdits from './locales/ko/recentEdits.json';

// Japanese
import jaCommon from './locales/ja/common.json';
import jaAnalytics from './locales/ja/analytics.json';
import jaSession from './locales/ja/session.json';
import jaSettings from './locales/ja/settings.json';
import jaTools from './locales/ja/tools.json';
import jaError from './locales/ja/error.json';
import jaMessage from './locales/ja/message.json';
import jaRenderers from './locales/ja/renderers.json';
import jaUpdate from './locales/ja/update.json';
import jaFeedback from './locales/ja/feedback.json';
import jaRecentEdits from './locales/ja/recentEdits.json';

// Simplified Chinese
import zhCNCommon from './locales/zh-CN/common.json';
import zhCNAnalytics from './locales/zh-CN/analytics.json';
import zhCNSession from './locales/zh-CN/session.json';
import zhCNSettings from './locales/zh-CN/settings.json';
import zhCNTools from './locales/zh-CN/tools.json';
import zhCNError from './locales/zh-CN/error.json';
import zhCNMessage from './locales/zh-CN/message.json';
import zhCNRenderers from './locales/zh-CN/renderers.json';
import zhCNUpdate from './locales/zh-CN/update.json';
import zhCNFeedback from './locales/zh-CN/feedback.json';
import zhCNRecentEdits from './locales/zh-CN/recentEdits.json';

// Traditional Chinese
import zhTWCommon from './locales/zh-TW/common.json';
import zhTWAnalytics from './locales/zh-TW/analytics.json';
import zhTWSession from './locales/zh-TW/session.json';
import zhTWSettings from './locales/zh-TW/settings.json';
import zhTWTools from './locales/zh-TW/tools.json';
import zhTWError from './locales/zh-TW/error.json';
import zhTWMessage from './locales/zh-TW/message.json';
import zhTWRenderers from './locales/zh-TW/renderers.json';
import zhTWUpdate from './locales/zh-TW/update.json';
import zhTWFeedback from './locales/zh-TW/feedback.json';
import zhTWRecentEdits from './locales/zh-TW/recentEdits.json';

export const supportedLanguages = {
  en: 'English',
  ko: '한국어',
  ja: '日本語',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
} as const;

export type SupportedLanguage = keyof typeof supportedLanguages;

export const languageLocaleMap: Record<string, string> = {
  en: 'en-US',
  ko: 'ko-KR',
  ja: 'ja-JP',
  'zh-CN': 'zh-CN',
  'zh-TW': 'zh-TW',
  'zh-HK': 'zh-HK',
  'zh-MO': 'zh-MO',
};

/**
 * Namespace 목록
 *
 * LLM이 특정 기능의 번역만 수정할 때 해당 namespace 파일만 참조 가능
 */
export const namespaces = [
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
] as const;

export type Namespace = (typeof namespaces)[number];

/**
 * Namespace별 리소스 병합 함수
 * i18next는 returnObjects 옵션으로 배열을 반환할 수 있으므로 string | string[] 허용
 */
type TranslationValue = string | string[];
function mergeNamespaces(
  ...nsObjects: Record<string, TranslationValue>[]
): Record<string, TranslationValue> {
  return Object.assign({}, ...nsObjects);
}

// 단일 'translation' namespace로 병합 (기존 호환성 유지)
// 기존 t('prefix.key') 형식이 그대로 동작함
const resources = {
  en: {
    translation: mergeNamespaces(
      enCommon,
      enAnalytics,
      enSession,
      enSettings,
      enTools,
      enError,
      enMessage,
      enRenderers,
      enUpdate,
      enFeedback,
      enRecentEdits
    ),
  },
  ko: {
    translation: mergeNamespaces(
      koCommon,
      koAnalytics,
      koSession,
      koSettings,
      koTools,
      koError,
      koMessage,
      koRenderers,
      koUpdate,
      koFeedback,
      koRecentEdits
    ),
  },
  ja: {
    translation: mergeNamespaces(
      jaCommon,
      jaAnalytics,
      jaSession,
      jaSettings,
      jaTools,
      jaError,
      jaMessage,
      jaRenderers,
      jaUpdate,
      jaFeedback,
      jaRecentEdits
    ),
  },
  'zh-CN': {
    translation: mergeNamespaces(
      zhCNCommon,
      zhCNAnalytics,
      zhCNSession,
      zhCNSettings,
      zhCNTools,
      zhCNError,
      zhCNMessage,
      zhCNRenderers,
      zhCNUpdate,
      zhCNFeedback,
      zhCNRecentEdits
    ),
  },
  'zh-TW': {
    translation: mergeNamespaces(
      zhTWCommon,
      zhTWAnalytics,
      zhTWSession,
      zhTWSettings,
      zhTWTools,
      zhTWError,
      zhTWMessage,
      zhTWRenderers,
      zhTWUpdate,
      zhTWFeedback,
      zhTWRecentEdits
    ),
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    defaultNS: 'translation',
    ns: ['translation'],

    interpolation: {
      escapeValue: false,
    },

    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
    },
  });

export default i18n;

// 타입 및 훅 re-export
export { useAppTranslation } from './useAppTranslation';
export type { TranslationKey, TranslationPrefix } from './types.generated';
