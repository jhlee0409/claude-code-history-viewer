// Preload (`node --import`) that makes stdout/stderr flush late, the way a
// socket stdout does on a loaded Linux runner once its send buffer is full:
// each write lands on a later timer tick, in order. A process that calls
// process.exit() right after printing loses everything still queued.
for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream);
  stream.write = (chunk, encoding, callback) => {
    setTimeout(() => write(chunk, encoding, callback), 5);
    return false;
  };
}
