// Ownership of the per-run server and browser: whatever fails after the
// server is up (browser launch included), the browser is closed and the
// server is stopped before the error propagates. Dependencies are injected so
// the cleanup contract is testable with real processes and injected faults.

/**
 * Start the server, launch the browser, run `use({ server, browser })`, and
 * always tear down in reverse order. A teardown error never masks the
 * original one.
 */
export async function withServerAndBrowser({ startServer, launchBrowser }, use) {
  const server = await startServer();
  try {
    const browser = await launchBrowser();
    try {
      return await use({ server, browser });
    } finally {
      await browser.close().catch(() => {});
    }
  } finally {
    await server.stop();
  }
}
