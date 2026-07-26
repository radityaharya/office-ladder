/**
 * Per-room serialization for a background actor that commits commands on a
 * player's behalf.
 *
 * Extracted from the bot driver, unchanged, because the turn-timeout driver needs
 * exactly the same three properties and they are subtle enough that a second
 * hand-written copy would drift:
 *
 * 1. **One pass per room at a time.** Two overlapping passes would read the same
 *    revision and both try to act for the same seat.
 * 2. **A kick that arrives mid-pass is honoured.** A pass decides "nothing to do"
 *    from a snapshot it read *before* the caller that piggybacks on it existed:
 *    its last act is a repository read, and a human command can commit — and call
 *    schedule() — while that read is still on the wire. Awaiting the running pass
 *    would drop the kick and leave a seat with nobody driving it until some
 *    client's next poll. Requesting a rerun instead re-reads after it settles.
 *    Each pass clears the flag first, so the number of extra passes is bounded by
 *    the number of kicks that actually arrived: it cannot spin.
 * 3. **The slot is always released**, on success or on throw, before anybody
 *    awaiting the stored promise resumes.
 */
export type RoomDrainSchedulerDependencies = {
  /** One pass. Must not throw for ordinary "nothing to do" outcomes. */
  readonly run: (roomId: string) => Promise<void>;
  /** A pass threw. There is nowhere else for this to go. */
  readonly onCrash: (roomId: string, error: unknown) => void;
};

export type RoomDrainScheduler = {
  /** Runs until there is provably nothing left to do, or joins a running pass. */
  readonly drive: (roomId: string) => Promise<void>;
  /** Fire-and-forget drive(): never throws, never returns a rejected promise. */
  readonly schedule: (roomId: string) => void;
};

export function createRoomDrainScheduler(
  deps: RoomDrainSchedulerDependencies,
): RoomDrainScheduler {
  const inFlight = new Map<string, Promise<void>>();
  const rerunRequested = new Set<string>();

  async function runUntilSettled(roomId: string, release: () => void): Promise<void> {
    try {
      do {
        rerunRequested.delete(roomId);
        await deps.run(roomId);
      } while (rerunRequested.has(roomId));
    } finally {
      release();
    }
  }

  async function drive(roomId: string): Promise<void> {
    const existing = inFlight.get(roomId);
    if (existing !== undefined) {
      // Do not interleave with the running pass — but do make it look again,
      // because it may already have read the pre-command snapshot.
      rerunRequested.add(roomId);
      await existing;
      return;
    }

    // The pass starts synchronously, so a kick arriving before its first await
    // cannot slip past unnoticed — but that also means a `run` which fails
    // *before* its first await reaches `release` while the map entry below has
    // not been written yet. Storing the promise unconditionally then left an
    // already-rejected entry that nothing ever cleared: every later kick awaited
    // that same rejection, so the room could never be driven again. Recording
    // whether the pass already released is what keeps "the slot is always
    // released" true regardless of how `run` was declared — both production
    // drivers are `async function`s, which is the only reason this was
    // unreachable rather than a live wedge.
    let settled = false;
    const run = runUntilSettled(roomId, () => {
      settled = true;
      inFlight.delete(roomId);
      rerunRequested.delete(roomId);
    });
    if (!settled) inFlight.set(roomId, run);
    await run;
  }

  return {
    drive,
    schedule(roomId) {
      void drive(roomId).catch((error: unknown) => {
        deps.onCrash(roomId, error);
      });
    },
  };
}
