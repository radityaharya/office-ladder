import type { RngStreamState } from "../model";
import {
  SEEDED_RANDOM_ALGORITHM,
  SEEDED_RANDOM_VERSION,
  SeededRandomSource,
  restoreSeededRandomSource,
  type RandomSource,
} from "../random";

export type TrackedRandom = {
  readonly source: RandomSource;
  readonly consumed: () => number;
};

export function trackRandom(source: RandomSource): TrackedRandom {
  let consumed = 0;
  return {
    source: {
      next: () => {
        consumed += 1;
        return source.next();
      },
    },
    consumed: () => consumed,
  };
}

export function restoreDiceSource(
  stream: RngStreamState,
): SeededRandomSource | null {
  if (
    stream.algorithm !== SEEDED_RANDOM_ALGORITHM ||
    stream.version !== SEEDED_RANDOM_VERSION
  ) {
    return null;
  }

  try {
    return restoreSeededRandomSource({
      algorithm: SEEDED_RANDOM_ALGORITHM,
      version: SEEDED_RANDOM_VERSION,
      state: stream.state,
      cursor: stream.cursor,
    });
  } catch (error) {
    if (error instanceof RangeError) {
      return null;
    }
    throw error;
  }
}

export function persistedDiceStream(
  random: RandomSource,
  previous: RngStreamState,
  consumed: number,
): RngStreamState {
  return random instanceof SeededRandomSource
    ? random.getStreamState()
    : { ...previous, cursor: previous.cursor + consumed };
}

export function diceCursor(
  random: RandomSource,
  previous: RngStreamState,
  consumed: number,
): number {
  return random instanceof SeededRandomSource
    ? random.getCursor()
    : previous.cursor + consumed;
}
