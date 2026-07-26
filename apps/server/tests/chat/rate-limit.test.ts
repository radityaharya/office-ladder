import { describe, expect, it } from "vitest";

import { createSlidingWindowRateLimiter } from "../../src/rooms/chat/rate-limit";

function limiter(options: { readonly max: number; readonly windowMs: number }) {
  let clock = 0;
  const rateLimiter = createSlidingWindowRateLimiter({
    windowMs: options.windowMs,
    max: options.max,
    now: () => clock,
  });
  return {
    consume: (key: string) => rateLimiter.consume(key),
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("sliding window rate limiter", () => {
  it("Given a window, When the allowance is spent, Then the next attempt is refused", () => {
    const bucket = limiter({ max: 2, windowMs: 1000 });

    expect(bucket.consume("a")).toBe(true);
    expect(bucket.consume("a")).toBe(true);
    expect(bucket.consume("a")).toBe(false);
  });

  it("Given attempts that have aged out, When another arrives, Then it is allowed again", () => {
    const bucket = limiter({ max: 2, windowMs: 1000 });
    bucket.consume("a");
    bucket.consume("a");

    bucket.advance(1001);

    expect(bucket.consume("a")).toBe(true);
  });

  it("Given a burst straddling what a fixed window would call a boundary, When it is measured, Then the sliding window still refuses", () => {
    const bucket = limiter({ max: 2, windowMs: 1000 });
    bucket.advance(900);
    expect(bucket.consume("a")).toBe(true);
    expect(bucket.consume("a")).toBe(true);

    // A fixed window resetting at 1000ms would hand out a fresh allowance here
    // and let four through in 200ms, which for chat is the visible failure: a
    // wall of lines arriving at once.
    bucket.advance(200);
    expect(bucket.consume("a")).toBe(false);
  });

  it("Given a refused attempt, When it keeps being retried, Then it extends its own cooldown", () => {
    const bucket = limiter({ max: 1, windowMs: 1000 });
    expect(bucket.consume("a")).toBe(true);

    bucket.advance(900);
    expect(bucket.consume("a")).toBe(false);

    // The refusal at t=900 still counts, so the allowance returns at t=1900
    // rather than t=1000: hammering the endpoint cannot shorten the wait.
    bucket.advance(200);
    expect(bucket.consume("a")).toBe(false);
    bucket.advance(1000);
    expect(bucket.consume("a")).toBe(true);
  });

  it("Given two keys, When one is exhausted, Then the other is untouched", () => {
    const bucket = limiter({ max: 1, windowMs: 1000 });

    expect(bucket.consume("room:alice")).toBe(true);
    expect(bucket.consume("room:alice")).toBe(false);
    expect(bucket.consume("room:bob")).toBe(true);
  });
});
