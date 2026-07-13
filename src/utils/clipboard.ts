function legacyCopy(text: string): void {
  let copied = false;

  const handleCopy = (event: ClipboardEvent) => {
    event.preventDefault();
    if (!event.clipboardData) {
      return;
    }

    event.clipboardData.setData("text/plain", text);
    copied = true;
  };

  try {
    document.addEventListener("copy", handleCopy);
    if (typeof document.execCommand !== "function" || !document.execCommand("copy")) {
      throw new Error("Clipboard unavailable");
    }
    if (!copied) {
      throw new Error("Clipboard payload unavailable");
    }
  } finally {
    document.removeEventListener("copy", handleCopy);
  }
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      legacyCopy(text);
      return;
    }
  }

  legacyCopy(text);
}
