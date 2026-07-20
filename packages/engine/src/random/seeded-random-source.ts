import type { RandomSource } from "./random-source";

const UINT32_RANGE = 0x1_0000_0000;
const DEFAULT_NON_ZERO_SEED = 0x6d2b79f5;
export const SEEDED_RANDOM_ALGORITHM = "xorshift32";
export const SEEDED_RANDOM_VERSION = "1";

export interface SeededRandomState {
  readonly algorithm: typeof SEEDED_RANDOM_ALGORITHM;
  readonly version: typeof SEEDED_RANDOM_VERSION;
  readonly state: string;
  readonly cursor: number;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function normalizeSeed(seed: number | string): number {
  if (typeof seed === "string") {
    return hashSeed(seed) || DEFAULT_NON_ZERO_SEED;
  }

  if (!Number.isSafeInteger(seed)) {
    throw new TypeError("Random seed must be a safe integer or string");
  }

  return (seed >>> 0) || DEFAULT_NON_ZERO_SEED;
}

/** A compact deterministic source suitable for tests, replays, and simulations. */
export class SeededRandomSource implements RandomSource {
  private state: number;
  private cursor: number;

  constructor(seed: number | string, cursor = 0) {
    this.state = normalizeSeed(seed);
    if (!Number.isSafeInteger(cursor) || cursor < 0) {
      throw new RangeError("Random cursor must be a non-negative safe integer");
    }
    this.cursor = cursor;
  }

  next(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    this.cursor += 1;

    return this.state / UINT32_RANGE;
  }

  getState(): number {
    return this.state;
  }

  getCursor(): number {
    return this.cursor;
  }

  getStreamState(): SeededRandomState {
    return {
      algorithm: SEEDED_RANDOM_ALGORITHM,
      version: SEEDED_RANDOM_VERSION,
      state: String(this.state),
      cursor: this.cursor,
    };
  }
}

export function createSeededRandomSource(
  seed: number | string,
): SeededRandomSource {
  return new SeededRandomSource(seed);
}

export function restoreSeededRandomSource(
  stream: SeededRandomState,
): SeededRandomSource {
  if (
    stream.algorithm !== SEEDED_RANDOM_ALGORITHM ||
    stream.version !== SEEDED_RANDOM_VERSION
  ) {
    throw new RangeError("Unsupported seeded random algorithm or version");
  }

  const state = Number(stream.state);
  if (!Number.isSafeInteger(state) || state < 1 || state > 0xffff_ffff) {
    throw new RangeError("Seeded random state must be a non-zero unsigned 32-bit integer");
  }

  return new SeededRandomSource(state, stream.cursor);
}
