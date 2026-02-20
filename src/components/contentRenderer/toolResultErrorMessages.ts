type TranslateFn = (
  key: string,
  options?: Record<string, unknown>
) => string;

export const getCommonToolErrorMessages = (t: TranslateFn): Record<string, string> => ({
  invalid_tool_input: t("toolError.invalidToolInput"),
  unavailable: t("toolError.unavailable"),
  too_many_requests: t("toolError.tooManyRequests"),
  execution_time_exceeded: t("toolError.executionTimeExceeded"),
});
