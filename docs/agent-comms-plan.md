# Agent Comms in CommsRelay — Design Review

**Status:** Phase 1 done. Phase 2 not chosen.  
**Goal:** This folder becomes a fork of ExaDev/agent-comms, and Claude Code plus Cursor/Grok Bots join the localhost mesh.

---

## 1. Problem

Different AI tools on this PC cannot talk to each other. This folder is an empty Grok scaffold. The product we want is [ExaDev/agent-comms](https://github.com/ExaDev/agent-comms): a TCP mesh on localhost (port 19876) with rooms, DMs, and presence.

A one-off `npx` in one harness is not enough: we want the source here (our fork) and two other agents wired.

## 2. Current model

| Thing | Path / fact |
|---|---|
| This folder | `C:\Users\mavri\Projects\CommsRelay` — template git only (`README.md`, `AGENTS.md`, `.gitignore`) |
| Upstream | `https://github.com/ExaDev/agent-comms` (npm `agent-comms`, MCP `npx agent-comms bridge mcp`) |
| Our GitHub | `mavrikfalkon` — no `agent-comms` fork yet |
| Claude Code | `claude.exe` installed. MCP **connected** (local scope): `node C:\Users\mavri\Projects\CommsRelay\dist\cli.js bridge mcp`. `npx -y agent-comms` does **not** work here (npm wants git+SSH for `@exadev/wire-mesh-core`, which is not on the registry; this PC has no GitHub SSH key). |
| Cursor / Grok Bots | Cursor installed; no user `mcp.json` yet |
| This Grok TUI | Has MCP; **stays off the mesh for now** |
| pnpm | Via Corepack (`corepack pnpm`, shims in `%LOCALAPPDATA%\Programs\corepack-shims`). Do not `corepack enable` into `C:\Program Files\nodejs` (EPERM). |
| Sibling `Relay` | `C:\Users\mavri\Projects\Relay` — different product. Do not mix |
| G: Drive | Shadow-back is later. Do not copy there while Butch is copying |

Simple path: published npm package via `npx -y agent-comms bridge mcp`. Clone is for owning the source, not for running the first MCP.

## 3. Target

- Folder `CommsRelay` is a git working tree of `github.com/mavrikfalkon/agent-comms`.
- `origin` = that fork. `upstream` = `ExaDev/agent-comms`.
- Claude Code has an `agent-comms` MCP server.
- Cursor has user-level MCP so Grok Bots see the same server.
- One agent can `register` and `list_agents` and see the other.
- This Grok TUI is not on the mesh yet.

## 4. Phases

| Phase | What | Done when |
|---|---|---|
| **0** | Fork ExaDev/agent-comms to `mavrikfalkon/agent-comms`. Replace this template git with a clone of the fork. Set `origin` + `upstream`. Put this plan file back on the fork as a local commit (do not push unless asked). | `git remote -v` shows origin = mavrikfalkon, upstream = ExaDev. `README.md` is Agent Comms. This plan file still exists. |
| **1** | Wire Claude Code to the **local** CLI. `pnpm install` + `pnpm build` (Unix shebang step fails on Windows; `node dist/cli.js` is enough). Then `claude mcp add agent-comms -- node C:\Users\mavri\Projects\CommsRelay\dist\cli.js bridge mcp`. Removed the cloned `.mcp.json` Joe/Mac paths. | `claude mcp list` shows `agent-comms` **Connected**. (One-shot `claude -p` is not logged in; open an interactive Claude in this folder to call the tool.) |
| **2** | Wire Cursor / Grok Bots: create `C:\Users\mavri\.cursor\mcp.json` with the same `npx -y agent-comms bridge mcp` command | File exists. Cursor MCP list shows `agent-comms`. A Grok Bot can see the tool. |
| **3** | Prove the mesh: both agents register; one `list_agents` sees the other | A DM or room message from one arrives at the other. Then stop. |

## 5. Must not break

- Rule #1: simple existing path first — `npx` is blocked on this PC; MCP runs via the local `dist/cli.js` build.
- One home per fact — live projects stay under `C:\Users\mavri\Projects`.
- Do not `git init` in the parent `Projects` folder.
- Do not push unless asked.
- Do not wire this Grok TUI in these phases.
- Do not touch sibling `Relay` or GrokOnPC `coop/`.
- Do not write into `G:\My Drive\Grok\Projects` while the complete copy is running.
- Do not install pnpm into Program Files. User Corepack shims only.
- Keep the folder name `CommsRelay`.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Scope creep | One phase, stop, re-review |
| Clone wipes this plan | Copy `docs/agent-comms-plan.md` aside, clone, copy it back, commit on the fork |
| `npx` mesh ≠ local checkout | That is intended. Local tree is for later patches |
| Cursor MCP is user-wide | Wanted so Grok Bots see it without this folder being the Cursor workspace |
| Two MCP processes on port 19876 | First becomes coordinator; second joins. Normal. |
| Fork under the wrong account | Locked: `mavrikfalkon` |

## 7. Non-goals (this slice)

- This Grok TUI on the mesh
- LM Studio
- Renaming the folder to `agent-comms`
- Pushing the fork
- Shadow to G:
- Changing sibling `Relay`
- Restoring `npx` until `@exadev/wire-mesh-core` is installable without git+SSH

## 8. Recommended first slice

**Phase 0** and **Phase 1** done. Next is **Phase 2** (Cursor `~\.cursor\mcp.json`) when you say so.

## 9. Approval checklist

- [x] Which phase? **0** and **1** done. Next is 2 when you say so.
- [ ] Tiny work — skip this doc? No. Multi-step, keep this file.

## Post-production 2026-09-10

- **npx is not the simple path on this PC.** npm resolves `@exadev/wire-mesh-core` to git+SSH; package is not on the registry; no GitHub SSH key. Phase 1 used local `pnpm` + `dist/cli.js`.
- **Upstream `pnpm build` shebang line uses `printf`/`cat`/`mv`.** Fails on Windows. `tsc` already wrote `dist/cli.js`; Node does not need the shebang.
- **`corepack enable` into Program Files is EPERM.** User shims: `%LOCALAPPDATA%\Programs\corepack-shims`.
- **Cloned `.mcp.json` had `/Users/joe/...` paths.** Cleared. Live server is local-scope in `~/.claude.json`.
- **`claude -p` is not logged in.** MCP health-check is Connected; a real Claude window in this folder is the remaining human check.
- Nothing else new. Stop.
