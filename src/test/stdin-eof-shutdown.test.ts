import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Regression test for the stdin-EOF leak: StdioServerTransport only listens
// for stdin "data"/"error", so mcp.server.onclose never fires just because
// the host closed its side of the pipe. A bridge with other open handles
// (mesh sockets, the web server) would otherwise survive as a stranded
// process. The fix is a direct stdin "end"/"close" listener — this test
// exercises that mechanism against a process with an open listener, without
// spawning a real bridge against the live mesh coordinator.
test(
  "a process with an open server still exits on stdin EOF, not just a kill timeout",
  { timeout: 10000 },
  async () => {
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(
          new URL("./fixtures/stdin-eof-child.js", import.meta.url),
        ),
      ],
      { stdio: ["pipe", "pipe", "inherit"] },
    );

    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.stdout.once("data", () => resolve());
    });

    const started = Date.now();
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code));
      child.stdin.end();
    });
    const elapsedMs = Date.now() - started;

    assert.equal(exitCode, 0);
    // The MCP SDK's client-side close() waits up to 2000ms before
    // force-killing with SIGTERM. A fast exit here proves the process
    // reacted to stdin ending on its own, not to an external kill.
    assert.ok(
      elapsedMs < 1000,
      `expected exit well under the 2s SIGTERM fallback, took ${String(elapsedMs)}ms`,
    );
  },
);
