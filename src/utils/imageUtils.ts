/**
 * Image utility functions shared across capture hooks.
 */

/**
 * Convert a data URL to a Uint8Array of the binary content.
 */
export function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  if (!base64) {
    return new Uint8Array(0);
  }

  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return new Uint8Array(0);
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
