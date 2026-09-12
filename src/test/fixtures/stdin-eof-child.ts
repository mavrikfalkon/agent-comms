import * as http from "node:http";

// Minimal stand-in for a bridge process: an open server keeps the event
// loop alive (like the mesh + web-server sockets in a real bridge), so the
// only way this exits promptly is if shutdown reacts to stdin ending
// rather than waiting for a signal or a forced kill.
const server = http.createServer();
server.listen(0, () => {
  console.log("READY");
});

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  process.exit(0);
}

process.stdin.once("end", shutdown);
process.stdin.once("close", shutdown);
process.stdin.resume();
