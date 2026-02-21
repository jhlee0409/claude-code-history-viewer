export const UPDATE_MANUAL_RESTART_REQUIRED_ERROR_CODE =
  'update.manual_restart_required';
export const UPDATE_INSTALL_FAILED_ERROR_CODE = 'update.install_failed';

export function resolveUpdateErrorMessage(
  error: string,
  t: (key: string) => string
): string {
  if (error === UPDATE_MANUAL_RESTART_REQUIRED_ERROR_CODE) {
    return t('common.error.updateManualRestartRequired');
  }
  if (error === UPDATE_INSTALL_FAILED_ERROR_CODE) {
    return t('common.error.updateInstallFailed');
  }

  return error;
}
