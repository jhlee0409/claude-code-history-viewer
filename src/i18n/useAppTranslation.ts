/**
 * 타입 안전한 번역 훅
 *
 * useTranslation 대신 이 훅을 사용하면:
 * - 키 자동완성 지원
 * - 잘못된 키 사용 시 타입 에러
 * - 단일 네임스페이스로 단순화
 */

import { useTranslation } from 'react-i18next';
import type { TranslationKey } from './types.generated';

type InterpolationOptions = Record<string, string | number>;

/**
 * 타입 안전한 번역 훅
 *
 * @example
 * ```tsx
 * const { t } = useAppTranslation();
 * t('common.loading');  // ✅ 자동완성 지원
 * t('invalid.key');     // ❌ 타입 에러
 * ```
 */
export function useAppTranslation() {
  const { t: originalT, i18n } = useTranslation();

  /**
   * 타입 안전한 번역 함수
   */
  const t = (key: TranslationKey, options?: InterpolationOptions): string => {
    return originalT(key, options) as string;
  };

  return { t, i18n };
}

export type { TranslationKey };
