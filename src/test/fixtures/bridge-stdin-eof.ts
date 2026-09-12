import { writeFileSync } from "node:fs";
import { MeshStore } from "../../core/mesh-store.js";
import { run as runMcp } from "../../bridges/mcp/index.js";
import { run as runCodex } from "../../bridges/codex/tool.js";

// Exercise the real bridges and TLS/web servers without joining port 19876.
// Only redirect the coordinator port; preserve the actual init/shutdown code.
// These saved methods are always invoked with .call(this) below.
// eslint-disable-next-line @typescript-eslint/unbound-method
const originalInit = MeshStore.prototype.init;
// eslint-disable-next-line @typescript-eslint/unbound-method
const originalShutdown = MeshStore.prototype.shutdown;
const stores = new Set<MeshStore>();
let shutdownCalls = 0;
let shutdownCompleted = false;
MeshStore.prototype.init = async function () {
  Object.defineProperty(this, "coordinatorPort", { value: 0 });
  stores.add(this);
  await originalInit.call(this);
};
MeshStore.prototype.shutdown = async function () {
  shutdownCalls++;
  await originalShutdown.call(this);
  shutdownCompleted = true;
};

const harness = process.argv[2];
const reportPath = process.argv[3];
if (!reportPath) throw new Error("Missing report path");
process.on("exit", () => {
  writeFileSync(
    reportPath,
    JSON.stringify({
      shutdownCalls,
      shutdownCompleted,
      agents: [...stores][0]?.serialise().agents,
    }),
  );
});
process.on("message", (message) => {
  if (message === "race") {
    process.stdin.emit("end");
    process.stdin.emit("close");
    process.emit("SIGTERM");
  }
});

await (harness === "mcp" ? runMcp() : runCodex());
process.send?.("ready");
