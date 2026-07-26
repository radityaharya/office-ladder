import { describe, expect, it } from "vitest";

import { createRoomDrainScheduler } from "../../src/rooms/drain-scheduler";

/**
 * The per-room slot both server-side actors run inside.
 *
 * It had no tests of its own — it was only ever exercised through the bot driver
 * and the turn-timeout driver, which can each hide a scheduler bug behind their
 * own guards (a second overlapping pass reads the same revision and is refused by
 * the write predicate, so "two passes ran" looks identical to "one pass ran" from
 * outside). These assert the three properties its doc comment claims, plus the
 * two the audit asked for: N concurrent kicks cannot storm it, and the slot is
 * released on every failure path so the map cannot grow without bound.
 */

type Recorder = {
  /** How many passes actually started. */
  runs: number;
  /** The most passes that were ever inside `run` at the same time. */
  peakConcurrency: number;
  readonly crashes: { roomId: string; error: unknown }[];
};

function recorder(): Recorder {
  return { runs: 0, peakConcurrency: 0, crashes: [] };
}

/** A promise the test settles by hand, so a pass can be parked mid-flight. */
function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let settle: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: () => settle() };
}

describe("room drain scheduler: mutual exclusion", () => {
  it("Given overlapping kicks for one room, When they run, Then no two passes are ever inside the room at once", async () => {
    const observed = recorder();
    let inside = 0;
    const gate = deferred();
    const scheduler = createRoomDrainScheduler({
      run: async () => {
        inside += 1;
        observed.peakConcurrency = Math.max(observed.peakConcurrency, inside);
        observed.runs += 1;
        await gate.promise;
        inside -= 1;
      },
      onCrash: (roomId, error) => observed.crashes.push({ roomId, error }),
    });

    const kicks = [
      scheduler.drive("room-a"),
      scheduler.drive("room-a"),
      scheduler.drive("room-a"),
    ];
    gate.resolve();
    await Promise.all(kicks);

    expect(observed.peakConcurrency).toBe(1);
  });

  it("Given many kicks arriving while a pass runs, When it settles, Then they collapse into exactly one rerun", async () => {
    // The self-heal path: every connected client polls GET /:roomId every ~5s and
    // each poll kicks both drivers. Twenty viewers must not mean twenty passes —
    // the flag is a set, so the extra work is bounded by *one* rerun however many
    // kicks pile up, and the rerun still happens (a kick may have arrived after
    // the running pass had already read the room).
    const observed = recorder();
    const gate = deferred();
    const scheduler = createRoomDrainScheduler({
      run: async () => {
        observed.runs += 1;
        if (observed.runs === 1) await gate.promise;
      },
      onCrash: (roomId, error) => observed.crashes.push({ roomId, error }),
    });

    const first = scheduler.drive("room-a");
    const stormed = Array.from({ length: 25 }, () => scheduler.drive("room-a"));
    gate.resolve();
    await Promise.all([first, ...stormed]);

    expect(observed.runs).toBe(2);
  });

  it("Given kicks for different rooms, When they run, Then they are not serialized against each other", async () => {
    // Per-room, not global: one slow room must not hold up every other table.
    const gate = deferred();
    const started: string[] = [];
    const scheduler = createRoomDrainScheduler({
      run: async (roomId) => {
        started.push(roomId);
        await gate.promise;
      },
      onCrash: () => undefined,
    });

    const both = Promise.all([scheduler.drive("room-a"), scheduler.drive("room-b")]);
    await Promise.resolve();
    expect(started).toEqual(["room-a", "room-b"]);
    gate.resolve();
    await both;
  });
});

describe("room drain scheduler: the slot is always released", () => {
  it("Given a pass that rejects, When it settles, Then the room can be driven again", async () => {
    const observed = recorder();
    const scheduler = createRoomDrainScheduler({
      run: async () => {
        observed.runs += 1;
        throw new Error("pass failed");
      },
      onCrash: (roomId, error) => observed.crashes.push({ roomId, error }),
    });

    await expect(scheduler.drive("room-a")).rejects.toThrow("pass failed");
    await expect(scheduler.drive("room-a")).rejects.toThrow("pass failed");

    // A retained entry would be worse than a leak: every later kick would await
    // the same already-rejected promise, so the room would never be driven again.
    expect(observed.runs).toBe(2);
  });

  it("Given a pass that throws before its first await, When it settles, Then the room is not permanently poisoned", async () => {
    // The one ordering that used to break the invariant: `run` failing
    // *synchronously* reached the release before the slot had been recorded, so
    // the rejected promise was stored afterwards and nothing ever cleared it.
    // Both drivers happen to be `async function`s today, which is the only reason
    // this was unreachable in production — a scheduler whose safety depends on
    // how its injected callback was declared is not a safe scheduler.
    const observed = recorder();
    const scheduler = createRoomDrainScheduler({
      run: (roomId: string) => {
        observed.runs += 1;
        throw new Error(`sync failure for ${roomId}`);
      },
      onCrash: (roomId, error) => observed.crashes.push({ roomId, error }),
    });

    await expect(scheduler.drive("room-a")).rejects.toThrow("sync failure");
    await expect(scheduler.drive("room-a")).rejects.toThrow("sync failure");

    expect(observed.runs).toBe(2);
  });

  it("Given a pass that crashes, When it was fire-and-forget, Then schedule reports it and never rejects", async () => {
    const observed = recorder();
    const scheduler = createRoomDrainScheduler({
      run: async () => {
        observed.runs += 1;
        throw new Error("pass failed");
      },
      onCrash: (roomId, error) => observed.crashes.push({ roomId, error }),
    });

    // No await and no catch at the call site: an unhandled rejection here would
    // take the process down in production.
    scheduler.schedule("room-a");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(observed.crashes).toHaveLength(1);
    expect(observed.crashes[0]?.roomId).toBe("room-a");
    // Still driveable afterwards, which is what proves the slot was released.
    await expect(scheduler.drive("room-a")).rejects.toThrow("pass failed");
    expect(observed.runs).toBe(2);
  });

  it("Given a rerun that rejects, When joiners are waiting on it, Then they are released rather than left hanging", async () => {
    const observed = recorder();
    const gate = deferred();
    const scheduler = createRoomDrainScheduler({
      run: async () => {
        observed.runs += 1;
        if (observed.runs === 1) {
          await gate.promise;
          return;
        }
        throw new Error("rerun failed");
      },
      onCrash: (roomId, error) => observed.crashes.push({ roomId, error }),
    });

    const first = scheduler.drive("room-a");
    const joiner = scheduler.drive("room-a");
    gate.resolve();

    await expect(first).rejects.toThrow("rerun failed");
    await expect(joiner).rejects.toThrow("rerun failed");
    expect(observed.runs).toBe(2);
    // And the room is still usable once the failure has been reported.
    await expect(scheduler.drive("room-a")).rejects.toThrow("rerun failed");
    expect(observed.runs).toBe(3);
  });
});
