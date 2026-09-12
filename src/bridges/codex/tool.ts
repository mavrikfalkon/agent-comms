/**
 * Agent Comms — Codex MCP tool server.
 *
 * Provides the "agent_comms" tool for Codex to call.
 * Uses TCP mesh for state sync. Pending messages are drained and
 * appended to every tool response so Codex sees them mid-turn.
 *
 * Run via: npx agent-comms bridge codex
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  MeshStore,
  CommsTool,
  buildAction,
  ensureRegistered,
  drainAndFormat,
  MCP_TOOL_PARAMS,
} from "../../core/index.js";
import { TlsTransport } from "../../core/tls-transport.js";
import {
  loadOrCreateIdentity,
  releaseIdentityLock,
  type IdentitySlot,
} from "../../core/identity-store.js";
import { tryStartWebServer } from "../user/web/server.js";
import { ChatController } from "../user/controller.js";
import { nanoid } from "../../core/nanoid.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function run(): Promise<void> {
  // Persistent identity for this slot: a stable fingerprint means the agent
  // ID survives restarts, so peers can keep targeting us. Shutdown releases
  // the slot lock; after a crash, a stale lock self-heals via the pid probe.
  const identitySlot: IdentitySlot = { harness: "codex", cwd: process.cwd() };
  const identity = loadOrCreateIdentity(identitySlot);
  const store = new MeshStore();
  store.peerId = identity.fingerprint;
  store.setTransport(new TlsTransport(store.events, identity));
  const tool = new CommsTool(store, store.discovery);
  let agentId: string | undefined;

  const mcp = new McpServer(
    { name: "agent-comms", version: "0.2.0" },
    { capabilities: {} },
  );

  // -----------------------------------------------------------------------
  // Tool registration
  // -----------------------------------------------------------------------

  mcp.registerTool(
    "agent_comms",
    {
      description: [
        "Cross-harness agent communication mesh. Actions:",
        "register, update, whoami, create_room, list_rooms, join_room, leave_room,",
        "send, dm, list_agents, read_room, invite, decline_invite, kick, destroy_room.",
        "Pending incoming messages are included in every response.",
      ].join(" "),
      inputSchema: MCP_TOOL_PARAMS,
    },
    async (rawParams: unknown) => {
      const params = isRecord(rawParams) ? rawParams : {};
      const actionParam = params.action;
      if (!agentId) {
        const name =
          actionParam === "register" && typeof params.name === "string"
            ? params.name
            : `codex-${nanoid(4)}`;
        const reg = await ensureRegistered({
          cwd: process.cwd(),
          store,
          harness: "codex",
          defaultName: name,
        });
        agentId = reg.agentId;
      }

      const action = buildAction(params);
      const result = await tool.handle(
        { agentId, harness: "codex", cwd: process.cwd(), pid: process.pid },
        action,
      );

      // Drain pending delivery messages and append to response
      const deliveryLines = await drainAndFormat(store, agentId);
      const content: { type: "text"; text: string }[] = [
        { type: "text", text: result.content },
      ];

      if (deliveryLines.length > 0) {
        content.push({
          type: "text",
          text: "📬 Incoming messages:\n" + deliveryLines.join("\n"),
        });
      }

      return { content, isError: result.isError };
    },
  );

  // -----------------------------------------------------------------------
  // Startup
  // -----------------------------------------------------------------------

  await store.init();

  // Register before starting the web UI so it can share this agent's mesh
  // identity via ChatController.fromExisting — otherwise createWebServer
  // falls back to minting its own "Dashboard" peer.
  const reg = await ensureRegistered({
    cwd: process.cwd(),
    store,
    harness: "codex",
    defaultName: `codex-${nanoid(4)}`,
  });
  agentId = reg.agentId;

  await tryStartWebServer(
    ChatController.fromExisting(store, {
      agentId,
      harness: "codex",
      cwd: process.cwd(),
      pid: process.pid,
    }),
  );

  // -----------------------------------------------------------------------
  // Shutdown — clean up mesh state so a closed bridge doesn't linger as a
  // stale "active" peer (stdin EOF alone doesn't exit the process, since
  // the web server and mesh connections keep the event loop alive).
  // -----------------------------------------------------------------------

  async function shutdown(): Promise<void> {
    try {
      if (agentId !== undefined) {
        await store.setAgentOffline(agentId);
      }
      await store.shutdown();
    } catch {
      // best-effort — the process is exiting anyway
    } finally {
      releaseIdentityLock(identitySlot);
    }
  }

  // EOF, stream close, and signals can race: run mesh cleanup only once.
  let shuttingDown = false;
  function triggerShutdown(): void {
    if (shuttingDown) return;
    shuttingDown = true;
    void shutdown().finally(() => process.exit(0));
  }

  // The SDK does not call onclose when stdin ends. Listen directly so
  // open mesh/web sockets cannot strand the bridge after its host exits.
  process.stdin.once("end", triggerShutdown);
  process.stdin.once("close", triggerShutdown);

  const previousClose = mcp.server.onclose;
  mcp.server.onclose = () => {
    previousClose?.();
    triggerShutdown();
  };

  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.on(signal, triggerShutdown);
  }

  process.on("exit", () => {
    releaseIdentityLock(identitySlot);
  });

  await mcp.connect(new StdioServerTransport());
}
