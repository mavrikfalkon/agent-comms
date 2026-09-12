# How the agents in this room work together

Written down after a night of good work slowed down by the same two
questions coming up over and over live in the room: "does this STEER
override the earlier one?" and "am I allowed to touch this file?" This
doc exists so those get answered by reading, not by waiting on Butch.

If something here doesn't match how the room actually behaves, the
room wins — update this file, don't just ignore it.

## 1. What's pre-authorized vs. what needs Butch

- **Pre-authorized:** claiming and fixing any item already listed in
  [`bugs-found.md`](bugs-found.md), once you've said in the room which
  one you're taking. No need to wait for a fresh "go ahead" on those —
  the list itself is the authorization.
- **Needs an explicit okay first:** anything that changes a trust or
  security boundary (who can reach what, what's authenticated, what's
  pinned/verified), anything not already on the bugs list, and
  anything destructive (force-push, deleting mesh state, killing other
  agents' processes).
- **If a STEER message's scope is unclear** — especially "does this
  override an earlier restriction" — ask once, plainly, and wait. That
  is expected, normal, and faster than guessing wrong. Don't treat
  asking as stalling.

## 2. File ownership

- Post which files you're touching before you start a slice that's
  bigger than a one-line fix.
- Solo, single-file, self-contained work can just start once claimed —
  no need to wait for a response.
- Work that touches shared/core files (anything used by more than one
  bridge — `core/*.ts`, `bridges/user/controller.ts`, etc.) should be
  claimed explicitly, and everyone else avoids those files until the
  claim is released (reported done, or abandoned).
- If two people's changes end up in the same file anyway (a file gets
  modified by someone else while you're mid-edit), split the commit:
  reconstruct the other person's version, commit it in isolation
  first, then commit yours on top. Don't let one commit blend two
  people's unrelated work.

## 3. Reporting a slice

Four posts, not one at the end:

1. **Starting** — what bug/task, which files, roughly what the fix is.
2. **Done, uncommitted** — files touched, what changed, how you tested
   it yourself (build/lint/tests you actually ran, not just "should
   work"). Ask for review if it's non-trivial or security-adjacent.
3. **Reviewed** — the reviewer re-runs the checks independently before
   approving. Trusting a report without re-running it has already
   missed real bugs tonight (twice, both directions). Say plainly what
   you checked, not just "looks good."
4. **Committed and pushed** — commit hash(es), what's now on
   `origin/main`. If you split a commit per rule 2, say so.

## 4. Idle discipline

- Stopping after one slice to wait for review isn't slowness, it's the
  point — it's what keeps two agents from editing the same thing.
- If the room goes quiet after a report, it's fine to move to the next
  pre-authorized item rather than wait indefinitely — say so when you
  do, so nobody's surprised later.
