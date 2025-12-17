// 업데이트 체크 결과 캐싱 유틸리티
import type { GitHubRelease } from '../hooks/useGitHubUpdater';

interface CachedUpdateResult {
  hasUpdate: boolean;
  releaseInfo: GitHubRelease | null;
  timestamp: number;
  currentVersion: string;
  schemaVersion?: number; // 캐시 스키마 버전 추가
}

const CACHE_KEY = 'update_check_cache';
const CACHE_DURATION = 30 * 60 * 1000; // 30분
// 캐시 스키마 버전: 버전 파싱 버그 수정으로 인해 기존 캐시 무효화
// 버전을 올리면 기존 사용자의 캐시가 자동으로 무효화됨
const CACHE_SCHEMA_VERSION = 2;

export function getCachedUpdateResult(currentVersion: string): CachedUpdateResult | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    const result: CachedUpdateResult = JSON.parse(cached);

    // 스키마 버전이 다르면 캐시 무효화 (버전 파싱 버그 수정)
    // 기존 캐시에는 schemaVersion이 없으므로 자동으로 무효화됨
    if (result.schemaVersion !== CACHE_SCHEMA_VERSION) {
      console.log('캐시 스키마 버전 불일치, 캐시 무효화');
      clearAllUpdateRelatedCache();
      return null;
    }

    // 버전이 다르거나 캐시가 만료된 경우 무효화
    if (
      result.currentVersion !== currentVersion ||
      Date.now() - result.timestamp > CACHE_DURATION
    ) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }

    return result;
  } catch {
    // 파싱 오류 시 캐시 삭제
    localStorage.removeItem(CACHE_KEY);
    return null;
  }
}

/**
 * 업데이트 관련 모든 캐시 삭제 (버그 수정 시 사용)
 */
function clearAllUpdateRelatedCache(): void {
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem('postponed_update');

  // skipped_version_* 키 모두 삭제
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('skipped_version_')) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key));
}

export function setCachedUpdateResult(
  hasUpdate: boolean,
  releaseInfo: GitHubRelease | null,
  currentVersion: string
): void {
  try {
    const result: CachedUpdateResult = {
      hasUpdate,
      releaseInfo,
      timestamp: Date.now(),
      currentVersion,
      schemaVersion: CACHE_SCHEMA_VERSION,
    };

    localStorage.setItem(CACHE_KEY, JSON.stringify(result));
  } catch (error) {
    console.warn('업데이트 캐시 저장 실패:', error);
  }
}

export function clearUpdateCache(): void {
  localStorage.removeItem(CACHE_KEY);
}