type TranslateFn = (
  key: string,
  options?: Record<string, unknown>
) => string;

export const getCommonToolErrorMessages = (t: TranslateFn): Record<string, string> => ({
  // SDK cb5fba419808e3844fa6407e59577ab7ba346b79 messages.ts:7154–7165.
  file_not_found: t("toolError.fileNotFound"),
  invalid_tool_input: t("toolError.invalidToolInput"),
  unavailable: t("toolError.unavailable"),
  too_many_requests: t("toolError.tooManyRequests"),
  execution_time_exceeded: t("toolError.executionTimeExceeded"),
});
