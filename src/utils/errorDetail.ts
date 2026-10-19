/** What a failure says, for a notification's `{{detail}}`. */
export const errorDetail = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
