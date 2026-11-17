// Exit a harness CLI without losing output.

/**
 * process.exit() drops writes still queued on stdout/stderr. That happens
 * whenever they are pipes or sockets that are not drained fast enough: on a
 * Linux CI runner a child's stdout is a socket and ~200 short lines fill its
 * send buffer, so `run.mjs --list` printed 202 of 259 ids. An empty write's
 * callback runs after every earlier write on that stream has flushed, so exit
 * from there.
 */
export function exitAfterFlush(code) {
  process.exitCode = code;
  process.stdout.write("", () => {
    process.stderr.write("", () => process.exit(code));
  });
}
