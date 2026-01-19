/**
 * Safely stringify an object, handling circular references
 * @param obj - The object to stringify
 * @param indent - Number of spaces for indentation (default: 2)
 * @returns JSON string or error message if unable to stringify
 */
export const safeStringify = (obj: unknown, indent = 2): string => {
  try {
    return JSON.stringify(obj, null, indent);
  } catch {
    return "[Unable to stringify - possible circular reference]";
  }
};
