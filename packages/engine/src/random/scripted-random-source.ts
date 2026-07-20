import type { RandomSource } from "./random-source";

export class ScriptedRandomSource implements RandomSource {
  private cursor = 0;
  private readonly values: readonly number[];

  constructor(values: readonly number[]) {
    if (
      values.some(
        (value) => !Number.isFinite(value) || value < 0 || value >= 1,
      )
    ) {
      throw new RangeError("Scripted random values must be in [0, 1)");
    }

    this.values = [...values];
  }

  next(): number {
    if (this.cursor >= this.values.length) {
      throw new RangeError("Scripted random source is exhausted");
    }

    const value = this.values[this.cursor];
    this.cursor += 1;

    return value;
  }

  getCursor(): number {
    return this.cursor;
  }

  get remaining(): number {
    return this.values.length - this.cursor;
  }
}

export function createScriptedRandomSource(
  values: readonly number[],
): ScriptedRandomSource {
  return new ScriptedRandomSource(values);
}
