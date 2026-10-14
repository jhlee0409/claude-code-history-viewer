// Stand-in for cchv-server in lifecycle tests: serves 200 on --port until
// killed. --exit-on-start makes it exit during startup instead.
import http from "node:http";

if (process.argv.includes("--exit-on-start")) process.exit(3);
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
http.createServer((_, res) => res.end("ok")).listen(port, "127.0.0.1");
