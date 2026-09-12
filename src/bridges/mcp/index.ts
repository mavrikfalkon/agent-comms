/**
 * Agent Comms — generic MCP tool server.
 *
 * Standard MCP server that works with any MCP-compatible harness.
 * Uses TCP mesh for state sync. Pending messages are drained and
 * appended to every tool response so the agent sees them.
 *
 * Run via: npx agent-comms bridge mcp
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
import {
  createMcpTrace,
  errorFields,
  observeProcess,
  type McpTrace,
} from "./trace.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function run(): Promise<void> {
  const trace = createMcpTrace(process.env.AGENT_COMMS_TRACE_DIR);
  observeProcess(trace);
  trace("bridge_start", { cwd: process.cwd(), nodeVersion: process.version });
  try {
    await runBridge(trace);
  } catch (error) {
    trace("startup_failed", errorFields(error));
    throw error;
  }
}

async function runBridge(trace: McpTrace): Promise<void> {
  // Persistent identity for this slot: a stable fingerprint means the agent
  // ID survives restarts, so peers can keep targeting us. The stdio server
  // has no graceful shutdown hook; a stale lock self-heals via the pid probe.
  const identitySlot: IdentitySlot = { harness: "mcp", cwd: process.cwd() };
  const identity = loadOrCreateIdentity(identitySlot);
  const store = new MeshStore();
  store.peerId = identity.fingerprint;
  trace("identity_loaded", { peerId: identity.fingerprint });
  const events = store.events;
  store.setTransport(
    new TlsTransport(
      {
        ...events,
        onPeerConnected(handle, info) {
          trace("peer_connected", { peerId: handle.id });
          events.onPeerConnected(handle, info);
        },
        onPeerDisconnected(handle) {
          trace("peer_disconnected", { peerId: handle.id });
          events.onPeerDisconnected(handle);
        },
        onError(error) {
          trace("mesh_error", errorFields(error));
          events.onError?.(error);
        },
      },
      identity,
    ),
  );
  const tool = new CommsTool(store, store.discovery);
  let agentId: string | undefined;
  let requestId = 0;

  const mcp = new McpServer(
    { name: "agent-comms", version: "1.1.0" },
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
      const currentRequest = ++requestId;
      const started = performance.now();
      trace("tool_start", { requestId: currentRequest });
      try {
        const params = isRecord(rawParams) ? rawParams : {};
        const actionParam = params.action;

        if (!agentId) {
          const name =
            actionParam === "register" && typeof params.name === "string"
              ? params.name
              : `mcp-${nanoid(4)}`;
          const reg = await ensureRegistered({
            cwd: process.cwd(),
            store,
            harness: "mcp",
            defaultName: name,
          });
          agentId = reg.agentId;
        }

        const action = buildAction(params);
        const result = await tool.handle(
          { agentId, harness: "mcp", cwd: process.cwd(), pid: process.pid },
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

        trace("tool_end", {
          requestId: currentRequest,
          durationMs: Math.round(performance.now() - started),
          isError: result.isError,
        });
        return { content, isError: result.isError };
      } catch (error) {
        trace("tool_error", {
          requestId: currentRequest,
          ...errorFields(error),
        });
        throw error;
      }
    },
  );

  // -----------------------------------------------------------------------
  // Startup
  // -----------------------------------------------------------------------

  await store.init();
  trace("mesh_ready");

  // Register before starting the web UI so it can share this agent's mesh
  // identity via ChatController.fromExisting — otherwise createWebServer
  // falls back to minting its own "Dashboard" peer.
  const reg = await ensureRegistered({
    cwd: process.cwd(),
    store,
    harness: "mcp",
    defaultName: `mcp-${nanoid(4)}`,
  });
  agentId = reg.agentId;

  await tryStartWebServer(
    ChatController.fromExisting(store, {
      agentId,
      harness: "mcp",
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

  const previousClose = mcp.server.onclose;
  const previousError = mcp.server.onerror;
  mcp.server.onclose = () => {
    trace("mcp_closed");
    previousClose?.();
    void shutdown().finally(() => process.exit(0));
  };
  mcp.server.onerror = (error) => {
    trace("mcp_error", errorFields(error));
    previousError?.(error);
  };

  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.on(signal, () => {
      void shutdown().finally(() => process.exit(0));
    });
  }

  process.on("exit", () => {
    releaseIdentityLock(identitySlot);
  });

  await mcp.connect(new StdioServerTransport());
  trace("mcp_connected");
}
