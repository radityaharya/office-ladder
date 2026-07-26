/**
 * A per-key sliding-window rate limiter, for chat only.
 *
 * Chat is the one endpoint in this server a player may call as fast as they can
 * type, and every accepted call writes a row and fans out to every socket in the
 * room. Without a limit, one authenticated member can fill a room's history and
 * every other member's screen at line speed — the cost is entirely borne by
 * everyone else, which is what makes it worth a limiter rather than a comment.
 *
 * Sliding rather than fixed-window because a fixed window lets a burst of `2 ×
 * max` straddle the boundary, which for chat is precisely the visible failure:
 * ten lines arriving at once.
 *
 * In-process, so it is per server instance rather than global. That is a real
 * limitation and an accepted one: the cheap shared alternative is a database
 * round trip on the hot path of the chattiest endpoint, and the limit is a spam
 * ceiling, not an authorization boundary. Nothing downstream trusts it for
 * correctness.
 */

export type RateLimiter = {
  /**
   * Records an attempt against `key` and reports whether it is allowed.
   *
   * Consuming on *attempt* rather than on success is deliberate: a client that
   * hammers the endpoint with bodies that fail validation is exactly as
   * expensive to serve as one sending valid messages, so refused requests must
   * count too.
   */
  consume(key: string): boolean;
};

export type SlidingWindowRateLimiterOptions = {
  readonly windowMs: number;
  readonly max: number;
  /** Milliseconds since the epoch. Injected so tests are not real-time. */
  readonly now: () => number;
};

/**
 * How many keys may be tracked before a full sweep runs.
 *
 * Every key is one room-member pair and is dropped as soon as its window empties,
 * so steady-state size is "people who chatted in the last few seconds". The
 * sweep exists for the pathological case — an attacker cycling rooms to plant
 * keys — where without it the map is an unbounded memory leak driven by request
 * volume.
 */
const SWEEP_THRESHOLD = 4096;

export function createSlidingWindowRateLimiter(
  options: SlidingWindowRateLimiterOptions,
): RateLimiter {
  const attempts = new Map<string, number[]>();

  function prune(key: string, cutoff: number): number[] {
    const kept = (attempts.get(key) ?? []).filter((at) => at > cutoff);
    if (kept.length === 0) {
      attempts.delete(key);
    } else {
      attempts.set(key, kept);
    }
    return kept;
  }

  function sweep(cutoff: number): void {
    for (const [key, timestamps] of attempts) {
      if (timestamps.every((at) => at <= cutoff)) attempts.delete(key);
    }
  }

  return {
    consume(key) {
      const at = options.now();
      const cutoff = at - options.windowMs;
      if (attempts.size > SWEEP_THRESHOLD) sweep(cutoff);

      const recent = prune(key, cutoff);
      // Over the limit still records the attempt: a client that keeps calling
      // while refused extends its own cooldown instead of being handed a fresh
      // allowance the moment the window rolls.
      recent.push(at);
      attempts.set(key, recent);
      return recent.length <= options.max;
    },
  };
}

/**
 * Messages per player per room. Five in ten seconds is faster than anyone types
 * a sentence and slower than a script, which is the only distinction this needs
 * to make.
 */
export const CHAT_MESSAGE_RATE_LIMIT = { windowMs: 10_000, max: 5 } as const;

/**
 * Emotes per player per room. Higher than messages because a reaction is one
 * click on an existing message and a burst of them is ordinary use, and because
 * the one-emote-per-player-per-message cap already bounds how much a single
 * message can be piled on.
 */
export const CHAT_REACTION_RATE_LIMIT = { windowMs: 10_000, max: 20 } as const;
