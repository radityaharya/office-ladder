export interface RandomSource {
  /** Returns a value in the half-open interval [0, 1). */
  next(): number;
}

function assertRandomValue(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError("RandomSource.next() must return a value in [0, 1)");
  }
}

export function randomInt(
  random: RandomSource,
  minInclusive: number,
  maxInclusive: number,
): number {
  if (!Number.isSafeInteger(minInclusive) || !Number.isSafeInteger(maxInclusive)) {
    throw new TypeError("Random integer bounds must be safe integers");
  }

  if (maxInclusive < minInclusive) {
    throw new RangeError("Maximum random integer bound must not be below minimum");
  }

  const range = maxInclusive - minInclusive + 1;

  if (!Number.isSafeInteger(range)) {
    throw new RangeError("Random integer range is too large");
  }

  const value = random.next();
  assertRandomValue(value);

  return minInclusive + Math.floor(value * range);
}

export function rollDie(random: RandomSource, sides = 6): number {
  if (!Number.isSafeInteger(sides) || sides < 1) {
    throw new RangeError("Die sides must be a positive safe integer");
  }

  return randomInt(random, 1, sides);
}

export function rollDice(
  random: RandomSource,
  count: number,
  sides = 6,
): readonly number[] {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError("Dice count must be a non-negative safe integer");
  }

  return Array.from({ length: count }, () => rollDie(random, sides));
}
