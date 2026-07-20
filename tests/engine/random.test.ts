import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  createScriptedRandomSource,
  createSeededRandomSource,
  randomInt,
  restoreSeededRandomSource,
  rollDice,
  rollDie,
} from "../../src/engine/random";

describe("random sources", () => {
  it("produces identical sequences and state transitions for the same seed", () => {
    const first = createSeededRandomSource("deadline-dash-replay");
    const second = createSeededRandomSource("deadline-dash-replay");

    expect(first.getState()).toBe(second.getState());
    for (let index = 0; index < 20; index += 1) {
      expect(first.next()).toBe(second.next());
      expect(first.getState()).toBe(second.getState());
    }
  });

  it("restores the exact next value from serialized stream state", () => {
    const original = createSeededRandomSource("resume-this-game");
    original.next();
    original.next();

    const restored = restoreSeededRandomSource(original.getStreamState());

    expect(restored.getCursor()).toBe(2);
    expect(restored.next()).toBe(original.next());
    expect(restored.getStreamState()).toEqual(original.getStreamState());
  });

  it("rejects the invalid zero state instead of restoring another stream", () => {
    expect(() =>
      restoreSeededRandomSource({
        algorithm: "xorshift32",
        version: "1",
        state: "0",
        cursor: 0,
      }),
    ).toThrow("non-zero unsigned 32-bit integer");
  });

  it("keeps seeded values and generated integers within their documented bounds", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.string()),
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        (seed, min, width) => {
          const random = createSeededRandomSource(seed);
          const raw = random.next();
          const integer = randomInt(random, min, min + width);

          expect(raw).toBeGreaterThanOrEqual(0);
          expect(raw).toBeLessThan(1);
          expect(integer).toBeGreaterThanOrEqual(min);
          expect(integer).toBeLessThanOrEqual(min + width);
          expect(Number.isInteger(integer)).toBe(true);
        },
      ),
    );
  });

  it("maps scripted boundary values to exact die and integer outcomes", () => {
    const random = createScriptedRandomSource([0, 0.999_999, 0.5, 0.25]);

    expect(rollDie(random)).toBe(1);
    expect(rollDie(random)).toBe(6);
    expect(randomInt(random, -2, 2)).toBe(0);
    expect(rollDice(random, 1, 4)).toEqual([2]);
  });

  it("consumes a scripted sequence in order and exposes cursor state", () => {
    const values = [0.125, 0.5, 0.875] as const;
    const random = createScriptedRandomSource(values);

    expect(random.getCursor()).toBe(0);
    expect(random.remaining).toBe(3);
    expect([random.next(), random.next(), random.next()]).toEqual(values);
    expect(random.getCursor()).toBe(3);
    expect(random.remaining).toBe(0);
  });

  it("throws on scripted exhaustion without advancing state", () => {
    const random = createScriptedRandomSource([0.25]);

    expect(random.next()).toBe(0.25);
    expect(() => random.next()).toThrowError(
      new RangeError("Scripted random source is exhausted"),
    );
    expect(random.getCursor()).toBe(1);
    expect(random.remaining).toBe(0);
  });

  it("rejects invalid scripted values and invalid values from arbitrary sources", () => {
    expect(() => createScriptedRandomSource([1])).toThrow(RangeError);
    expect(() => randomInt({ next: () => -0.01 }, 1, 6)).toThrow(RangeError);
    expect(() => randomInt({ next: () => Number.NaN }, 1, 6)).toThrow(
      RangeError,
    );
  });
});
