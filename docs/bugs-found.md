# Bugs found (before the UI-lockup)

Recorded 2026-09-11 from CommsRelay discussion. Not a license to implement everything at once.

## Do next (Butch: Claude goes through code first)

1. **Extra Dashboard peer per MCP**  
   `src/bridges/mcp/index.ts` calls `tryStartWebServer()` with no controller. `createWebServer` then `new ChatController("Dashboard")` — a second mesh identity. Keep the web UI (phone app later). Pass the existing agent controller (or skip only the *peer*, not the HTTP server).

2. **Identity churn**  
   Slot `~/.agent-comms/identity-mcp--<cwd>.json` + `.lock`. Second live process on same harness+cwd gets an **ephemeral** fingerprint (`identity-store.ts`). MCP has no graceful unlock. Stdin EOF can leave a Node child on the mesh (stranded slot). Also cwd drift (System32 vs project) mints a new slot.

3. **Dual `ensureRegistered` in MCP**  
   Lazy call in the tool handler and an unconditional one after `mcp.connect()`. Possible race / random `mcp-*` names. Confirm whether `ensureRegistered` is idempotent.

## Tracing slice (ChatGPT owned; uncommitted / in dist)

4. **MCP stdout banner** — `createWebServer` used `console.log` for `Agent Comms web UI: http://…`. Stdio MCP uses stdout for JSON-RPC. Moved to `console.error`. `runWeb()` still `console.log`s `Connected as …` (CLI only).

5. **Trace JSONL** — `AGENT_COMMS_TRACE_DIR`; launcher defaults `%LOCALAPPDATA%\CommsRelay\logs`. No cross-process cleanup. `identity_loaded` cannot tell persisted vs ephemeral. Disconnect close vs error collapsed.

6. **Stdout test fixture** — `ChatController` constructor still hits identity files/lock even if `init()` is skipped. Isolated home asserted later; comment was wrong.

## Security (Claude’s earlier review; not started)

7. Missing cert-fingerprint check on `connect_request` / remote-connect.  
8. Wildcard CORS + unauthenticated local web server.

## Tests / Windows

9. Default suite 49/50: Unix `0600` identity file mode on Windows.  
10. Upstream `pnpm build` shebang (`printf|cat|mv`) fails on Windows; `node dist\cli.js` is enough.

## AHK poke (this repo `commsrelay-poke.ahk`)

11. Screen-absolute clicks locked the PC — **removed**. Client-relative / SendText only. Terminal must not Ctrl+A.
