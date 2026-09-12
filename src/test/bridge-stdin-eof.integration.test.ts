import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

for (const harness of ["mcp", "codex"]) {
  for (const trigger of ["eof", "race"]) {
    test(
      `${harness}: ${trigger} exits once, marks offline, and releases the identity lock`,
      { timeout: 15000 },
      async () => {
        const home = await mkdtemp(join(tmpdir(), "comms-bridge-eof-"));
        const report = join(home, "shutdown.json");
        const child = spawn(
          process.execPath,
          [
            fileURLToPath(
              new URL("./fixtures/bridge-stdin-eof.js", import.meta.url),
            ),
            harness,
            report,
          ],
          {
            cwd: home,
            env: {
              ...process.env,
              HOME: home,
              USERPROFILE: home,
              AGENT_COMMS_TRACE_DIR: "",
            },
            stdio: ["pipe", "pipe", "pipe", "ipc"],
          },
        );
        assert.ok(child.stderr);
        assert.ok(child.stdin);
        let stderr = "";
        const webReady = new Promise<void>((resolve) => {
          child.stderr?.on("data", (data: Buffer) => {
            stderr += data.toString();
            if (stderr.includes("Agent Comms web UI: http:")) resolve();
          });
        });
        const exited = once(child, "exit");
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const ready = await Promise.race([
            Promise.all([once(child, "message"), webReady]).then(
              ([message]) => message,
            ),
            exited.then(() => {
              throw new Error(`Bridge exited before ready: ${stderr}`);
            }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(`Startup timeout: ${stderr}`)),
                10000,
              );
            }),
          ]);
          clearTimeout(timer);
          assert.equal(ready[0], "ready");
          assert.match(stderr, /Agent Comms web UI: http:/);
          const locks = (await readdir(join(home, ".agent-comms"))).filter(
            (name) =>
              name.startsWith(`identity-${harness}--`) &&
              name.endsWith(".lock"),
          );
          assert.equal(locks.length, 1);
          const lock = locks[0];
          assert.ok(lock);
          if (trigger === "eof") child.stdin.end();
          else child.send("race");
          const result = await Promise.race([
            exited,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(`${harness} survived stdin ${trigger}`)),
                1500,
              );
            }),
          ]);
          assert.equal(result[0], 0);
          const state: {
            shutdownCalls: number;
            shutdownCompleted: boolean;
            agents: Record<string, { status: string; harness: string }>;
          } = JSON.parse(await readFile(report, "utf8"));
          assert.equal(state.shutdownCalls, 1);
          assert.equal(state.shutdownCompleted, true);
          const agents = Object.values(state.agents);
          assert.equal(agents.length, 1, "web UI must share the bridge agent");
          const agent = agents[0];
          assert.ok(agent);
          assert.equal(agent.harness, harness);
          assert.equal(agent.status, "offline");
          assert.ok(
            !(await readdir(join(home, ".agent-comms"))).includes(lock),
          );
        } finally {
          clearTimeout(timer);
          if (child.exitCode === null && child.signalCode === null)
            child.kill();
          await exited;
          await rm(home, { recursive: true, force: true });
        }
      },
    );
  }
}
