# How the agents in this room work together

Written down after a night of good work slowed down by the same two
questions coming up over and over live in the room: "does this STEER
override the earlier one?" and "am I allowed to touch this file?" This
doc exists so those get answered by reading, not by waiting on Butch.

If something here doesn't match how the room actually behaves, the
room wins — update this file, don't just ignore it.

## 1. What's pre-authorized vs. what needs Butch

- **Authorization comes from Butch** — an explicit instruction or
  delegation naming the work — not from a room message alone and not
  from an item merely appearing in [`bugs-found.md`](bugs-found.md).
  The list is a shared reference for what's known, not a standing
  green light to start anything on it.
- **Once Butch has authorized something, that authorization stands.**
  Don't re-ask for the same scope every time you touch related work —
  that includes security-boundary changes he's already greenlit (#7
  and #8 both needed, and got, his explicit override of an earlier
  restriction; after that they didn't need re-approval to proceed).
- **If a STEER message's scope is unclear** — especially "does this
  override an earlier restriction," or "am I actually authorized for
  this yet" — ask once, plainly, and wait. That is expected, normal,
  and faster than guessing wrong. Don't treat asking as stalling.

## 2. File ownership

- Post which files you're touching before you start a slice that's
  bigger than a one-line fix.
- Solo, single-file, self-contained work can just start once claimed —
  no need to wait for a response.
- Work that touches shared/core files (anything used by more than one
  bridge — `core/*.ts`, `bridges/user/controller.ts`, etc.) should be
  claimed explicitly, and everyone else avoids those files until the
  claim is released (reported done, or abandoned).
- If two people's changes end up in the same file anyway, don't
  unilaterally decide the split and commit the other person's WIP for
  them. Coordinate with whoever owns it — agree on how to stage/commit
  it so their changes are preserved — before either of you commits.
  Serialize the actual git operations (add/commit/push) so two agents
  aren't racing the same repo state.

## 3. Reporting a slice

Four posts, not one at the end:

1. **Starting** — what bug/task, which files, roughly what the fix is.
2. **Done, uncommitted** — files touched, what changed, how you tested
   it yourself (build/lint/tests you actually ran, not just "should
   work"). Ask for review if it's non-trivial or security-adjacent.
3. **Reviewed** — two distinct kinds of checking, both worth doing and
   worth naming separately in your report: reading the actual diff/logic
   for design and coverage gaps (this is what caught the #8 origin-check
   gaps — a source review, not a test re-run), and independently
   executing the build/lint/tests yourself rather than trusting the
   reporter's own run. Do whichever's appropriate to the change, and say
   plainly which you did — not just "looks good."
4. **Committed and pushed** — commit hash(es), what's now on
   `origin/main`. If you coordinated a same-file split per rule 2, say
   so.

## 4. Idle discipline

- Stopping after one slice to wait for review isn't slowness, it's the
  point — it's what keeps two agents from editing the same thing.
- If the room goes quiet after a report, it's fine to move to the next
  already-authorized item rather than wait indefinitely — say so when
  you do, so nobody's surprised later.
