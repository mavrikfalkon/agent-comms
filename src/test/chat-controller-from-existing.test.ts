import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MeshStore } from "../core/mesh-store.js";
import { TlsTransport } from "../core/tls-transport.js";
import { generateIdentity } from "../core/identity.js";
import { ChatController } from "../bridges/user/controller.js";
import type { CommsContext } from "../core/tool.js";
import type { DeliveryEvent } from "../core/types.js";

// Regression test for bug #6: fromExisting used to call `new ChatController("")`
// first, which runs the full constructor and claims a real harness="user"
// identity lock at this cwd — a lock nothing then releases, since the object
// claiming it is discarded on the next line. Every bridge that shares its
// mesh identity with the web UI (mcp, codex, claude-code, opencode) hit this
// on every startup.
test("ChatController.fromExisting does not touch the harness=user identity slot", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "comms-from-existing-"));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;

  let store: MeshStore | undefined;
  try {
    const identity = generateIdentity();
    store = new MeshStore(0);
    store.peerId = identity.fingerprint;
    store.setTransport(new TlsTransport(store.events, identity));
    await store.init();

    const ctx: CommsContext = {
      agentId: identity.fingerprint,
      harness: "mcp",
      cwd: process.cwd(),
      pid: process.pid,
    };

    const ctrl = ChatController.fromExisting(store, ctx);

    const agentCommsDir = path.join(home, ".agent-comms");
    const entries = fs.existsSync(agentCommsDir)
      ? fs.readdirSync(agentCommsDir)
      : [];
    assert.ok(
      !entries.some((name) => name.startsWith("identity-user--")),
      `fromExisting must not create a harness=user identity file, found: ${entries.join(", ")}`,
    );

    // The controller must still actually work — EventEmitter state and the
    // onDelivery wiring both need real initialization, not skipped work.
    const result = await ctrl.listAgents();
    assert.equal(result.isError, false);

    let received: DeliveryEvent | undefined;
    ctrl.on("message", (event: DeliveryEvent) => {
      received = event;
    });
    const event: DeliveryEvent = {
      type: "member_joined",
      room: "test-room",
      agent: identity.fingerprint,
    };
    store.onDelivery?.(ctx.agentId, event);
    assert.deepEqual(received, event);
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    await store?.shutdown();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
