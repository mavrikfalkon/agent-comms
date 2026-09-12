/**
 * Peer ID verification integration test (#40) — a socket claiming a peer ID that doesn't match the certificate it actually presents must be rejected, on every path where TlsTransport learns a remote peer's identity from a self-reported wire message: the coordinator's `introduce` handler, the data server's `pong` handler, and the client's own `connectToPeer` dial.
 *
 * Run: node dist/test/peer-id-verification.integration.test.js [test-name] With no argument, every scenario runs in order.
 */

import * as net from "node:net";
import * as tls from "node:tls";
import * as assert from "node:assert/strict";
import { TlsTransport } from "../core/tls-transport.js";
import { generateIdentity } from "../core/identity.js";
import { encode } from "../core/wire-protocol.js";
import type { PeerInfo } from "../core/wire-protocol.js";
import type { TransportEvents } from "../core/transport.js";
import { buildAction } from "../core/bridge.js";
import { MeshStore } from "../core/mesh-store.js";
import { CommsTool } from "../core/tool.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function allocFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function noopEvents(overrides: Partial<TransportEvents> = {}): TransportEvents {
  return {
    onMessage: () => undefined,
    onPeerConnected: () => undefined,
    onPeerDisconnected: () => undefined,
    onIntroduction: () => undefined,
    onConnectionRequest: () => undefined,
    onPeerList: () => undefined,
    onPeerJoined: () => undefined,
    onBecomeCoordinator: () => undefined,
    ...overrides,
  };
}

async function testSpoofedIntroduceRejected(): Promise<void> {
  const identityCoordinator = generateIdentity();
  const identityAttacker = generateIdentity();

  let introduced = false;
  let sawError = false;
  const transport = new TlsTransport(
    noopEvents({
      onIntroduction: () => {
        introduced = true;
      },
      onError: () => {
        sawError = true;
      },
    }),
    identityCoordinator,
  );
  const port = await allocFreePort();
  await transport.becomeCoordinator("127.0.0.1", port);

  // The attacker connects with its own genuine certificate, but sends an `introduce` claiming the coordinator's own peer ID — self-reported identity that doesn't match the certificate on this connection.
  const socket = tls.connect({
    key: identityAttacker.privateKey,
    cert: identityAttacker.certificate,
    host: "127.0.0.1",
    port,
    rejectUnauthorized: false,
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("secureConnect", () => {
      socket.write(
        encode({
          method: "introduce",
          peerId: identityCoordinator.fingerprint,
          dataPort: 12345,
        }),
      );
      resolve();
    });
    socket.once("error", reject);
  });

  await sleep(300);

  assert.strictEqual(
    introduced,
    false,
    "onIntroduction must not fire for a spoofed peer ID",
  );
  assert.ok(sawError, "the rejection should be reported via onError");
  assert.ok(socket.destroyed, "the spoofing socket should be destroyed");

  await transport.shutdown();
  console.log("  ✓ introduce with mismatched certificate is rejected");
}

async function testSpoofedPongRejected(): Promise<void> {
  const identityListener = generateIdentity();
  const identityAttacker = generateIdentity();

  let connected = false;
  let sawError = false;
  const transport = new TlsTransport(
    noopEvents({
      onPeerConnected: () => {
        connected = true;
      },
      onError: () => {
        sawError = true;
      },
    }),
    identityListener,
  );
  await transport.startDataServer();

  // The attacker connects to the data server with its own certificate, but sends a `pong` claiming an arbitrary, unrelated peer ID.
  const socket = tls.connect({
    key: identityAttacker.privateKey,
    cert: identityAttacker.certificate,
    host: "127.0.0.1",
    port: transport.dataPort,
    rejectUnauthorized: false,
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("secureConnect", () => {
      socket.write(encode({ method: "pong", peerId: "NOT-MY-CERTIFICATE" }));
      resolve();
    });
    socket.once("error", reject);
  });

  await sleep(300);

  assert.strictEqual(
    connected,
    false,
    "onPeerConnected must not fire for a spoofed peer ID",
  );
  assert.ok(sawError, "the rejection should be reported via onError");
  assert.ok(socket.destroyed, "the spoofing socket should be destroyed");

  await transport.shutdown();
  console.log("  ✓ pong with mismatched certificate is rejected");
}

async function testConnectToPeerCertMismatchRejected(): Promise<void> {
  // The real peer B is listening under its own genuine identity...
  const identityB = generateIdentity();
  const transportB = new TlsTransport(noopEvents(), identityB);
  await transportB.startDataServer();

  // ...but the peer list entry a compromised or misbehaving coordinator could hand to a dialling client claims a completely different ID for that same host:port.
  const claimedPeer: PeerInfo = {
    id: "CLAIMED-BUT-WRONG-ID",
    port: transportB.dataPort,
    startedAt: new Date().toISOString(),
  };

  let sawError = false;
  const identityDialer = generateIdentity();
  const transportDialer = new TlsTransport(
    noopEvents({
      onError: () => {
        sawError = true;
      },
    }),
    identityDialer,
  );

  await transportDialer.connectToPeer(claimedPeer, identityDialer.fingerprint);
  await sleep(200);

  assert.ok(
    sawError,
    "the rejection should be reported via onError when the dialled peer's certificate doesn't match the claimed ID",
  );
  await assert.rejects(
    () =>
      transportDialer.send(
        { id: claimedPeer.id },
        { method: "pong", peerId: identityDialer.fingerprint },
      ),
    /No connection for handle/,
    "no peer connection should have been registered under the falsely claimed ID",
  );

  await transportDialer.shutdown();
  await transportB.shutdown();
  console.log(
    "  ✓ connectToPeer rejects a certificate that doesn't match the claimed peer ID",
  );
}

async function testSpoofedConnectRequestRejected(): Promise<void> {
  for (const claim of ["peerId", "fingerprint"]) {
    const coordinator = generateIdentity();
    const attacker = generateIdentity();
    let requested = false;
    let sawError = false;
    const transport = new TlsTransport(
      noopEvents({
        onConnectionRequest: () => {
          requested = true;
        },
        onError: () => {
          sawError = true;
        },
      }),
      coordinator,
    );
    await transport.becomeCoordinator("127.0.0.1", 0);
    const port = transport.listListeners()[0]?.port;
    assert.ok(port);
    const socket = tls.connect({
      key: attacker.privateKey,
      cert: attacker.certificate,
      host: "127.0.0.1",
      port,
      rejectUnauthorized: false,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("error", reject);
        socket.once("secureConnect", () => {
          socket.write(
            encode({
              method: "connect_request",
              peerId:
                claim === "peerId"
                  ? coordinator.fingerprint
                  : attacker.fingerprint,
              fingerprint:
                claim === "fingerprint"
                  ? coordinator.fingerprint
                  : attacker.fingerprint,
              dataPort: 12345,
              name: "spoofed request",
            }),
          );
          resolve();
        });
      });
      await sleep(200);
      assert.equal(
        requested,
        false,
        `spoofed ${claim} must not reach approval`,
      );
      assert.ok(sawError, "rejection must be reported");
      assert.ok(socket.destroyed, "spoofing socket must be destroyed");
    } finally {
      socket.destroy();
      await transport.shutdown();
    }
  }
}

async function testRemoteFingerprintPin(): Promise<void> {
  const remoteIdentity = generateIdentity();
  const localIdentity = generateIdentity();
  let requests = 0;
  const remote = new TlsTransport(
    noopEvents({
      onConnectionRequest: (handle, request) => {
        requests++;
        assert.equal(request.fingerprint, localIdentity.fingerprint);
        void remote.acceptConnection(handle);
      },
    }),
    remoteIdentity,
  );
  await remote.becomeCoordinator("127.0.0.1", 0);
  const port = remote.listListeners()[0]?.port;
  assert.ok(port);
  try {
    for (const pin of [
      undefined,
      "",
      localIdentity.fingerprint,
      remoteIdentity.fingerprint,
    ]) {
      const local = new TlsTransport(noopEvents(), localIdentity);
      try {
        const attempt = local.connectToRemote(
          "127.0.0.1",
          port,
          localIdentity.fingerprint,
          12345,
          "pin-test",
          localIdentity.fingerprint,
          pin,
        );
        if (pin === remoteIdentity.fingerprint) {
          await attempt;
          assert.equal(
            requests,
            1,
            "the correctly pinned request reaches approval",
          );
          assert.ok(local.hasCoordinatorConnection);
        } else {
          await assert.rejects(attempt, /fingerprint|certificate/i);
          assert.equal(
            requests,
            0,
            "no request is sent to an unverified server",
          );
          assert.equal(local.hasCoordinatorConnection, false);
        }
      } finally {
        await local.shutdown();
      }
    }
  } finally {
    await remote.shutdown();
  }
}

async function testMeshConnectFingerprintParsing(): Promise<void> {
  for (const fingerprint of [undefined, "", "   "]) {
    assert.throws(
      () =>
        buildAction({
          action: "mesh_connect",
          host: "127.0.0.1",
          port: 12345,
          fingerprint,
        }),
      /fingerprint/,
    );
  }
  const fingerprint = generateIdentity().fingerprint;
  assert.deepEqual(
    buildAction({
      action: "mesh_connect",
      host: "127.0.0.1",
      port: 12345,
      fingerprint,
    }),
    { action: "mesh_connect", host: "127.0.0.1", port: 12345, fingerprint },
  );
}

async function testPinnedMeshConnectTool(): Promise<void> {
  const remoteIdentity = generateIdentity();
  const localIdentity = generateIdentity();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let received: (() => void) | undefined;
  let failed: ((error: unknown) => void) | undefined;
  let requestedFingerprint: string | undefined;
  const request = new Promise<void>((resolve, reject) => {
    received = resolve;
    failed = reject;
    timer = setTimeout(
      () => reject(new Error("Pinned tool request did not reach approval")),
      2000,
    );
  });
  const remote = new TlsTransport(
    noopEvents({
      onConnectionRequest: (handle, info) => {
        requestedFingerprint = info.fingerprint;
        void remote.acceptConnection(handle).then(
          () => received?.(),
          (error: unknown) => failed?.(error),
        );
      },
    }),
    remoteIdentity,
  );
  const store = new MeshStore(0);
  store.peerId = localIdentity.fingerprint;
  store.setTransport(new TlsTransport(store.events, localIdentity));
  try {
    await remote.becomeCoordinator("127.0.0.1", 0);
    await store.startDataServerOnly();
    const port = remote.listListeners()[0]?.port;
    assert.ok(port);
    const tool = new CommsTool(store);
    const result = await tool.handle(
      {
        agentId: store.peerId,
        harness: "test",
        cwd: "/test",
        pid: process.pid,
      },
      buildAction({
        action: "mesh_connect",
        host: "127.0.0.1",
        port,
        fingerprint: remoteIdentity.fingerprint,
      }),
    );
    assert.equal(result.isError, false, result.content);
    await request;
    assert.equal(requestedFingerprint, localIdentity.fingerprint);
  } finally {
    clearTimeout(timer);
    await store.shutdown();
    await remote.shutdown();
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const testName = process.argv[2];

const tests: Record<string, () => Promise<void>> = {
  "spoofed-connect-request-rejected": testSpoofedConnectRequestRejected,
  "remote-fingerprint-pin": testRemoteFingerprintPin,
  "mesh-connect-fingerprint-parsing": testMeshConnectFingerprintParsing,
  "pinned-mesh-connect-tool": testPinnedMeshConnectTool,
  "spoofed-introduce-rejected": testSpoofedIntroduceRejected,
  "spoofed-pong-rejected": testSpoofedPongRejected,
  "connect-to-peer-cert-mismatch-rejected":
    testConnectToPeerCertMismatchRejected,
};

const selected =
  testName === undefined
    ? Object.entries(tests)
    : Object.entries(tests).filter(([name]) => name === testName);
if (selected.length === 0) {
  console.error(`Unknown test: ${testName}`);
  console.error(`Available: ${Object.keys(tests).join(", ")}`);
  process.exit(1);
}

async function run(): Promise<void> {
  for (const [name, fn] of selected) {
    console.log(`Running ${name}:`);
    await fn();
  }

  const maxWait = 2000;
  const start = Date.now();
  while (
    ((
      process as unknown as { _getActiveHandles?: () => unknown[] }
    )._getActiveHandles?.()?.length ?? 0) > 0 &&
    Date.now() - start < maxWait
  ) {
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  process.exit(0);
}

run().catch((err: unknown) => {
  console.error(`FAIL [${testName ?? "all"}]:`, err);
  process.exit(1);
});
