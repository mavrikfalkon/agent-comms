/**
 * Integration tests for the web server — HTTP routes and WebSocket.
 *
 * Tests the server layer without a browser, using raw HTTP and WS clients.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createWebServer, type WebServerHandle } from "../server.js";
import WS from "ws";

let handle: WebServerHandle | undefined;

async function setup(): Promise<{
  port: number;
  cleanup: () => Promise<void>;
}> {
  handle = await createWebServer(0);

  // Wait for the server to actually be listening
  await new Promise<void>((resolve) => {
    if (handle?.server.listening) {
      resolve();
      return;
    }
    handle?.server.once("listening", () => resolve());
  });

  const addr = handle.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    port,
    cleanup: async () => {
      if (handle) {
        handle.wss.close();
        handle.server.close();
        await handle.controller.shutdown();
        handle = undefined;
      }
    },
  };
}

function fetchJson(
  port: number,
  path: string,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method: "GET" },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on("end", () => {
          let body: unknown;
          try {
            body = JSON.parse(data);
          } catch {
            body = data;
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function postAction(
  port: number,
  action: Record<string, string>,
  contentType = "application/json",
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(action);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/action",
        method: "POST",
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(body.length),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on("end", () => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function openWs(
  port: number,
  path: string,
  origin?: string,
): Promise<{ ok: boolean; code?: number }> {
  return new Promise((resolve) => {
    const ws = new WS(`ws://127.0.0.1:${String(port)}${path}`, {
      headers: origin ? { Origin: origin } : {},
    });
    ws.on("open", () => {
      ws.close();
      resolve({ ok: true });
    });
    ws.on("unexpected-response", (_req, res) => {
      resolve(
        res.statusCode === undefined
          ? { ok: false }
          : { ok: false, code: res.statusCode },
      );
    });
    ws.on("error", () => {
      resolve({ ok: false });
    });
  });
}

describe("Web server integration", () => {
  it("serves the HTML page at /", async () => {
    const { port, cleanup } = await setup();
    try {
      const { status, body } = await fetchJson(port, "/");
      assert.strictEqual(status, 200);
      assert.ok(
        typeof body === "string" && body.includes("Agent Comms"),
        "HTML should contain 'Agent Comms'",
      );
    } finally {
      await cleanup();
    }
  });

  it("lists agents via GET /api/agents", async () => {
    const { port, cleanup } = await setup();
    try {
      const { status, body } = await fetchJson(port, "/api/agents");
      assert.strictEqual(status, 200);
      assert.ok(Array.isArray(body));
    } finally {
      await cleanup();
    }
  });

  it("lists rooms via GET /api/rooms", async () => {
    const { port, cleanup } = await setup();
    try {
      const { status, body } = await fetchJson(port, "/api/rooms");
      assert.strictEqual(status, 200);
      assert.ok(Array.isArray(body));
    } finally {
      await cleanup();
    }
  });

  it("creates a room via POST /api/action", async () => {
    const { port, cleanup } = await setup();
    try {
      const { status, body } = await postAction(port, {
        action: "create_room",
        name: "integration-test-room",
        type: "public",
      });
      assert.strictEqual(status, 200);
      assert.ok(
        typeof body === "object" && body !== null && "content" in body,
        "should return a result object",
      );
    } finally {
      await cleanup();
    }
  });

  it("accepts WebSocket connections", async () => {
    const { port, cleanup } = await setup();
    try {
      await new Promise<void>((resolve, reject) => {
        const ws = new WS(`ws://127.0.0.1:${String(port)}`);
        ws.on("open", () => {
          ws.close();
          resolve();
        });
        ws.on("error", reject);
      });
    } finally {
      await cleanup();
    }
  });

  it("sends state frame on WebSocket connect", async () => {
    const { port, cleanup } = await setup();
    try {
      const frame = await new Promise<unknown>((resolve, reject) => {
        const ws = new WS(`ws://127.0.0.1:${String(port)}`);
        ws.on("message", (data: WS.Data) => {
          const parsed: unknown = JSON.parse(data.toString());
          resolve(parsed);
          ws.close();
        });
        ws.on("error", reject);
      });
      assert.ok(
        typeof frame === "object" && frame !== null && "type" in frame,
        "should receive a JSON frame",
      );
      const typed = frame as { type: string };
      assert.strictEqual(typed.type, "state");
    } finally {
      await cleanup();
    }
  });

  it("returns 404 for unknown routes", async () => {
    const { port, cleanup } = await setup();
    try {
      const { status } = await fetchJson(port, "/nonexistent");
      assert.strictEqual(status, 404);
    } finally {
      await cleanup();
    }
  });

  it("rejects a disguised cross-origin POST /api/action and never executes it", async () => {
    const { port, cleanup } = await setup();
    try {
      // A cross-origin page can't set Content-Type: application/json without
      // triggering a CORS preflight (which fails once permissive CORS
      // headers are gone) — but a CORS-"simple" type like text/plain skips
      // the preflight entirely, so the browser sends this whether or not
      // CORS allows it. The server must reject on Content-Type alone.
      const { status } = await postAction(
        port,
        { action: "create_room", name: "should-not-exist", type: "public" },
        "text/plain",
      );
      assert.strictEqual(status, 415);
      const { body: rooms } = await fetchJson(port, "/api/rooms");
      assert.ok(Array.isArray(rooms));
      assert.ok(
        !rooms.some(
          (r) =>
            typeof r === "object" &&
            r !== null &&
            "name" in r &&
            r.name === "should-not-exist",
        ),
        "the disguised request must not have created the room",
      );
    } finally {
      await cleanup();
    }
  });

  it("still accepts a same-origin JSON POST after the Content-Type check", async () => {
    const { port, cleanup } = await setup();
    try {
      const { status } = await postAction(port, {
        action: "create_room",
        name: "content-type-ok-room",
        type: "public",
      });
      assert.strictEqual(status, 200);
    } finally {
      await cleanup();
    }
  });

  it("rejects a cross-origin WebSocket connection to the dashboard chat WS", async () => {
    const { port, cleanup } = await setup();
    try {
      const result = await openWs(port, "/", "https://evil.example");
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.code, 403);
    } finally {
      await cleanup();
    }
  });

  it("still accepts a same-origin (or originless) dashboard WebSocket connection", async () => {
    const { port, cleanup } = await setup();
    try {
      const result = await openWs(port, "/");
      assert.strictEqual(result.ok, true);
    } finally {
      await cleanup();
    }
  });

  it("intentionally still accepts /ws/mesh from another origin (standalone-PWA case)", async () => {
    const { port, cleanup } = await setup();
    try {
      const result = await openWs(port, "/ws/mesh", "https://evil.example");
      assert.strictEqual(
        result.ok,
        true,
        "documents that /ws/mesh is open-by-design; only real auth closes this",
      );
    } finally {
      await cleanup();
    }
  });

  it("does not send permissive CORS headers", async () => {
    const { port, cleanup } = await setup();
    try {
      const headers = await new Promise<http.IncomingHttpHeaders>(
        (resolve, reject) => {
          const req = http.request(
            { hostname: "127.0.0.1", port, path: "/api/agents", method: "GET" },
            (res) => {
              res.resume();
              res.on("end", () => resolve(res.headers));
            },
          );
          req.on("error", reject);
          req.end();
        },
      );
      assert.strictEqual(headers["access-control-allow-origin"], undefined);
      assert.strictEqual(headers["access-control-allow-methods"], undefined);
      assert.strictEqual(headers["access-control-allow-headers"], undefined);
    } finally {
      await cleanup();
    }
  });
});
