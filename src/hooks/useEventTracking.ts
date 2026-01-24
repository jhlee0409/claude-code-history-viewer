import { trackEvent } from '@aptabase/tauri';

/**
 * Event Tracking Hook (Aptabase)
 *
 * 익명 분석만 수집 - 개인정보 없음
 * GDPR 동의 불필요 (익명 데이터)
 */

export const TrackingEvents = {
  // App lifecycle
  APP_LAUNCHED: 'app_launched',

  // Navigation
  PROJECT_OPENED: 'project_opened',
  SESSION_OPENED: 'session_opened',

  // Features
  SEARCH_PERFORMED: 'search_performed',
  MESSAGE_EXPANDED: 'message_expanded',
  FILE_RESTORED: 'file_restored',

  // Analytics dashboard
  ANALYTICS_VIEWED: 'analytics_viewed',
  TOKEN_STATS_VIEWED: 'token_stats_viewed',
  RECENT_EDITS_VIEWED: 'recent_edits_viewed',

  // Settings
  THEME_CHANGED: 'theme_changed',
  LANGUAGE_CHANGED: 'language_changed',

  // Export
  EXPORT_USED: 'export_used',

  // Update
  UPDATE_CHECKED: 'update_checked',
  UPDATE_INSTALLED: 'update_installed',
} as const;

type EventName = (typeof TrackingEvents)[keyof typeof TrackingEvents];

/**
 * Track an analytics event (production only)
 * All data is anonymous - no personal information collected
 */
export async function track(
  event: EventName,
  props?: Record<string, string | number>
): Promise<void> {
  // Only track in production
  if (!import.meta.env.PROD) {
    return;
  }

  try {
    await trackEvent(event, props);
  } catch (error) {
    // Silently fail - analytics should never break the app
    console.debug('Event tracking failed:', error);
  }
}

/**
 * Hook for event tracking
 */
export function useEventTracking() {
  return {
    track,
    events: TrackingEvents,
  };
}
