/**
 * Persistent bridge identity: load-or-create the TLS key material for a (harness, cwd, instance) slot so the certificate fingerprint — and therefore the peer and agent ID — survives restarts.
 *
 * `instance` (from the AGENT_COMMS_INSTANCE env var, or the slot's explicit `instance` field for tests) exists because `harness` alone is too coarse: every generic-MCP client — Claude Code, grok-tui, anything else configured to run `bridge mcp` — shares the literal harness string "mcp", and Start-AgentCommsMcp.cmd always launches from this same project directory. Without a discriminator, those genuinely distinct concurrent clients collide on one (harness, cwd) slot; only whichever gets there first holds the real persisted identity; every other one is forced onto a disposable identity every single time it connects. Leaving `instance` empty reproduces the original one-slot-per-(harness,cwd) behaviour exactly, filenames included, so identities already on disk are untouched until a launcher opts in by setting the env var.
 *
 * Mesh state stays in memory and on the wire; the only thing on disk is this local credential, the same trust model as an SSH key. A lock file holding a PID and a last-refresh timestamp keeps two live bridges in one slot from sharing an identity, which would put duplicate peer IDs on the mesh; the second bridge runs with an ephemeral identity (the behaviour before persistence) instead. Bridges without a graceful shutdown hook can skip releasing the lock: a stale lock self-heals once its timestamp goes quiet (the holder stops heartbeating) or its recorded PID is confirmed dead — checking the PID alone is not enough, since the OS can recycle that PID number onto an unrelated live process before the successor starts.
 *
 * Persisting the key material rather than a bare agent ID is what makes restarts work: delivery routing fires when agentId === peerId, and peerId is the live certificate fingerprint, so an ID without its key can never match the running peer.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  generateIdentity,
  getCertificateFingerprint,
  CERTIFICATE_VALIDITY_MS,
} from "./identity.js";
import type { PeerIdentity } from "./identity.js";

/** A bridge's identity slot: one persisted identity per (harness, cwd, instance). */
export interface IdentitySlot {
  harness: string;
  cwd: string;
  /**
   * Distinguishes concurrent clients that would otherwise share (harness, cwd)
   * — e.g. Claude Code and grok-tui both running the generic "mcp" harness
   * from this same project directory. Defaults to the AGENT_COMMS_INSTANCE
   * environment variable when unset; explicit here mainly so tests don't need
   * to mutate process.env. Empty/unset keeps the original single-slot
   * behaviour, on-disk file names included.
   */
  instance?: string;
  /** Directory override for tests. */
  dir?: string;
}

/** Renew during the final twelfth of the certificate's validity. */
const RENEWAL_MARGIN_MS = CERTIFICATE_VALIDITY_MS / 12;

/** How often a live lock holder refreshes its lock's timestamp. */
const LOCK_HEARTBEAT_MS = 10_000;

/**
 * A lock not refreshed within this window is treated as abandoned, even if
 * its recorded PID happens to belong to a live process. PIDs get recycled by
 * the OS (fast on Windows), so a bare "is this PID alive" check can find an
 * unrelated process that just happens to have inherited the dead holder's
 * PID number and falsely conclude the slot is still held.
 */
const LOCK_STALE_MS = LOCK_HEARTBEAT_MS * 3;

interface StoredIdentity {
  privateKey: string;
  certificate: string;
  expiresAt: string;
}

function isStoredIdentity(value: unknown): value is StoredIdentity {
  if (typeof value !== "object" || value === null) return false;
  if (
    !("privateKey" in value) ||
    !("certificate" in value) ||
    !("expiresAt" in value)
  )
    return false;
  return (
    typeof value.privateKey === "string" &&
    typeof value.certificate === "string" &&
    typeof value.expiresAt === "string"
  );
}

/** Replace path separators and other filesystem-hostile characters. */
function slugify(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "_");
}

/** Explicit slot value, else AGENT_COMMS_INSTANCE, else none (original behaviour). */
function resolveInstance(slot: IdentitySlot): string {
  return slot.instance ?? process.env.AGENT_COMMS_INSTANCE ?? "";
}

function slotPaths(slot: IdentitySlot): {
  dir: string;
  identityFile: string;
  lockFile: string;
} {
  const dir = slot.dir ?? path.join(os.homedir(), ".agent-comms");
  const instance = resolveInstance(slot);
  const base =
    `identity-${slot.harness}--${slugify(slot.cwd)}` +
    (instance ? `--${slugify(instance)}` : "");
  return {
    dir,
    identityFile: path.join(dir, `${base}.json`),
    lockFile: path.join(dir, `${base}.lock`),
  };
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

interface LockState {
  pid: number;
  /** Epoch ms the lock was last written or heartbeat-refreshed. */
  updatedAt: number;
}

/** Read the lock's holder PID and last-refresh time, or undefined when absent or unreadable. */
function readLock(lockFile: string): LockState | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(lockFile, "utf-8");
  } catch {
    return undefined;
  }
  const [pidLine, updatedAtLine] = raw.split("\n");
  const pid = Number.parseInt((pidLine ?? "").trim(), 10);
  if (!Number.isInteger(pid)) return undefined;
  const updatedAt = Date.parse((updatedAtLine ?? "").trim());
  return { pid, updatedAt: Number.isNaN(updatedAt) ? 0 : updatedAt };
}

/** Read the PID holding the lock, or undefined when absent or unreadable. */
function readLockPid(lockFile: string): number | undefined {
  return readLock(lockFile)?.pid;
}

function writeLock(lockFile: string): void {
  fs.writeFileSync(
    lockFile,
    `${String(process.pid)}\n${new Date().toISOString()}\n`,
    "utf-8",
  );
}

/** Per-lock-file heartbeat timers, so a held slot keeps proving it's alive. */
const heartbeats = new Map<string, ReturnType<typeof setInterval>>();

function startHeartbeat(lockFile: string): void {
  stopHeartbeat(lockFile);
  const timer = setInterval(() => {
    // Only refresh while we still own the lock: a slot taken over by a
    // successor after we crashed should not have its new lock clobbered.
    if (readLockPid(lockFile) === process.pid) {
      writeLock(lockFile);
    }
  }, LOCK_HEARTBEAT_MS);
  timer.unref();
  heartbeats.set(lockFile, timer);
}

function stopHeartbeat(lockFile: string): void {
  const timer = heartbeats.get(lockFile);
  if (timer !== undefined) {
    clearInterval(timer);
    heartbeats.delete(lockFile);
  }
}

function persistIdentity(identityFile: string, identity: PeerIdentity): void {
  const stored: StoredIdentity = {
    privateKey: identity.privateKey,
    certificate: identity.certificate,
    expiresAt: new Date(Date.now() + CERTIFICATE_VALIDITY_MS).toISOString(),
  };
  fs.writeFileSync(identityFile, `${JSON.stringify(stored, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
}

/**
 * Load the persisted identity for the slot, creating it on first use, and take the slot lock. Returns an ephemeral identity when the slot is already held by another live process.
 */
export function loadOrCreateIdentity(slot: IdentitySlot): PeerIdentity {
  const { dir, identityFile, lockFile } = slotPaths(slot);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const instance = resolveInstance(slot);
  const held = readLock(lockFile);
  if (held !== undefined && held.pid !== process.pid) {
    const stale = Date.now() - held.updatedAt > LOCK_STALE_MS;
    if (!stale && isPidAlive(held.pid)) {
      const slotDesc = instance
        ? `${slot.harness} (${slot.cwd}, instance=${instance})`
        : `${slot.harness} (${slot.cwd})`;
      console.error(
        `agent-comms: identity slot ${slotDesc} is held by live pid ${String(held.pid)}; running with an ephemeral identity`,
      );
      return generateIdentity();
    }
  }

  const identity =
    loadStoredIdentity(identityFile) ?? createIdentity(identityFile);
  writeLock(lockFile);
  startHeartbeat(lockFile);
  return identity;
}

/** Load and validate the stored key material, renewing near certificate expiry. */
function loadStoredIdentity(identityFile: string): PeerIdentity | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(identityFile, "utf-8"));
  } catch {
    return undefined;
  }
  if (!isStoredIdentity(parsed)) return undefined;

  const expiresAt = Date.parse(parsed.expiresAt);
  if (Number.isNaN(expiresAt) || Date.now() > expiresAt - RENEWAL_MARGIN_MS) {
    return undefined;
  }

  try {
    return {
      privateKey: parsed.privateKey,
      certificate: parsed.certificate,
      fingerprint: getCertificateFingerprint(parsed.certificate),
    };
  } catch (err) {
    console.error(
      `agent-comms: stored identity at ${identityFile} is unreadable (${err instanceof Error ? err.message : String(err)}); generating a fresh identity`,
    );
    return undefined;
  }
}

function createIdentity(identityFile: string): PeerIdentity {
  const identity = generateIdentity();
  persistIdentity(identityFile, identity);
  return identity;
}

/**
 * Release the slot lock on graceful shutdown. A lock held by another PID (taken over after this process crashed and restarted) is left alone.
 */
export function releaseIdentityLock(slot: IdentitySlot): void {
  const { lockFile } = slotPaths(slot);
  stopHeartbeat(lockFile);
  if (readLockPid(lockFile) === process.pid) {
    fs.rmSync(lockFile, { force: true });
  }
}
