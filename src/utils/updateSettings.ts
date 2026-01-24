// 업데이트 설정 관리 유틸리티
import type { UpdateSettings } from '../types/updateSettings';
import { DEFAULT_UPDATE_SETTINGS } from '../types/updateSettings';

const SETTINGS_KEY = 'update_settings';

const VALID_CHECK_INTERVALS = ['startup', 'daily', 'weekly', 'never'] as const;

/**
 * Validate and sanitize parsed settings from localStorage
 */
function validateSettings(parsed: unknown): Partial<UpdateSettings> {
  if (typeof parsed !== 'object' || parsed === null) return {};

  const obj = parsed as Record<string, unknown>;
  const result: Partial<UpdateSettings> = {};

  if (typeof obj.autoCheck === 'boolean') {
    result.autoCheck = obj.autoCheck;
  }
  if (typeof obj.checkInterval === 'string' &&
      VALID_CHECK_INTERVALS.includes(obj.checkInterval as typeof VALID_CHECK_INTERVALS[number])) {
    result.checkInterval = obj.checkInterval as UpdateSettings['checkInterval'];
  }
  if (Array.isArray(obj.skippedVersions) &&
      obj.skippedVersions.every((v): v is string => typeof v === 'string')) {
    result.skippedVersions = obj.skippedVersions;
  }
  if (typeof obj.lastPostponedAt === 'number') {
    result.lastPostponedAt = obj.lastPostponedAt;
  }
  if (typeof obj.postponeInterval === 'number' && obj.postponeInterval > 0) {
    result.postponeInterval = obj.postponeInterval;
  }
  if (typeof obj.hasSeenIntroduction === 'boolean') {
    result.hasSeenIntroduction = obj.hasSeenIntroduction;
  }
  if (typeof obj.respectOfflineStatus === 'boolean') {
    result.respectOfflineStatus = obj.respectOfflineStatus;
  }
  if (typeof obj.allowCriticalUpdates === 'boolean') {
    result.allowCriticalUpdates = obj.allowCriticalUpdates;
  }

  return result;
}

export function getUpdateSettings(): UpdateSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) return { ...DEFAULT_UPDATE_SETTINGS };

    const parsed: unknown = JSON.parse(stored);
    const validated = validateSettings(parsed);
    // 기본값과 병합하여 새로운 설정이 추가되어도 호환성 유지
    return { ...DEFAULT_UPDATE_SETTINGS, ...validated };
  } catch {
    return { ...DEFAULT_UPDATE_SETTINGS };
  }
}

export function setUpdateSettings(settings: Partial<UpdateSettings>): void {
  try {
    const current = getUpdateSettings();
    const updated = { ...current, ...settings };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  } catch (error) {
    console.warn('업데이트 설정 저장 실패:', error);
  }
}

export function shouldCheckForUpdates(): boolean {
  const settings = getUpdateSettings();
  
  // 자동 체크가 비활성화된 경우
  if (!settings.autoCheck) {
    return false;
  }
  
  // never로 설정된 경우
  if (settings.checkInterval === 'never') {
    return false;
  }
  
  // 오프라인 상태를 존중하는 설정이고 현재 오프라인인 경우
  if (settings.respectOfflineStatus && !isOnline()) {
    return false;
  }
  
  // 연기된 업데이트가 있는지 확인
  if (settings.lastPostponedAt) {
    const now = Date.now();
    const timeSincePostpone = now - settings.lastPostponedAt;
    if (timeSincePostpone < settings.postponeInterval) {
      return false; // 아직 연기 기간
    }
  }
  
  return true;
}

export function shouldShowUpdateForVersion(version: string): boolean {
  const settings = getUpdateSettings();
  return !settings.skippedVersions.includes(version);
}

export function skipVersion(version: string): void {
  const settings = getUpdateSettings();
  if (!settings.skippedVersions.includes(version)) {
    // Immutable update pattern
    setUpdateSettings({
      skippedVersions: [...settings.skippedVersions, version],
    });
  }
}

export function postponeUpdate(): void {
  setUpdateSettings({
    lastPostponedAt: Date.now()
  });
}

export function isOnline(): boolean {
  return navigator.onLine;
}