export const UPDATE_MANUAL_RESTART_REQUIRED_ERROR_CODE =
  'update.manual_restart_required';

export function resolveUpdateErrorMessage(
  error: string,
  t: (key: string) => string
): string {
  if (error === UPDATE_MANUAL_RESTART_REQUIRED_ERROR_CODE) {
    return t('common.error.updateManualRestartRequired');
  }

  return error;
}
