/**
 * How long the bot driver pauses before each bot command, as a pure function of
 * one environment string.
 *
 * Split out of default-driver.ts on purpose, and for exactly the reason
 * bot-driver-log.ts is: default-driver.ts transitively imports the Postgres
 * repository (and therefore packages/db, which throws at module load without
 * DATABASE_URL), so nothing declared there can be unit-tested. The rules below
 * decide how followable the game is, so they need to be provable.
 *
 * Deliberately mirrors turn-timer/turn-timer.ts's `parseTurnTimeoutSeconds`
 * (pure parser here, single env read in configured-delay.ts): the two knobs are
 * siblings — one paces the bots, the other bounds a human's turn — and somebody
 * tuning either should find the same shape.
 */

/**
 * The pause before each bot command. **Read the arithmetic before changing it.**
 *
 * This number is one half of a budget whose other half lives in the client
 * (`apps/web/src/lib/motion.ts` and the event presentation queue that consumes
 * it). Committing a bot turn is atomic — one `turn.roll` produces the roll, the
 * move, every resource change, any card draw and the turn hand-off as a single
 * batch of event summaries sharing one `occurredAt` — so the client plays that
 * batch out over time rather than rendering it in one frame. The two have to
 * agree, or the pacing lives in the wrong place:
 *
 * - A committed bot turn carries roughly 2–6 summarized events.
 * - The client plays them at ~180–320ms each, so a turn takes ~0.7–1.9s to
 *   render, with a typical four-event turn landing near 1.0–1.3s.
 * - **1500ms therefore sits just above the top of that typical band.** The next
 *   bot's events arrive a few hundred milliseconds *after* the previous turn has
 *   finished rendering, which is the beat of stillness a player needs to register
 *   what happened before the next thing starts.
 *
 * Set it materially lower and the beat disappears: the client's queue goes into
 * permanent backlog, the queue rather than this value becomes the pacer, and the
 * original complaint (five log lines appearing at once, "I genuinely cannot
 * follow the game") comes back with added latency on top. Set it materially
 * higher and a full six-seat table spends ten seconds a round watching nothing.
 *
 * `0` switches the pause off completely and is a supported configuration (tests,
 * load work, a deliberately fast local loop) — it is not a degraded mode, it is
 * "no pacing", and the burst behaviour it produces is the documented consequence.
 *
 * Was 900ms, which predates the client having any presentation queue at all: at
 * 900ms each bot's whole turn arrived in one frame and the *next* bot arrived
 * before the player had read the last one. A measured round (one human roll plus
 * two complete bot turns) took 2.74s and arrived as three bursts.
 */
export const DEFAULT_BOT_TURN_DELAY_MS = 1_500;

/** No pause at all: bot turns commit as fast as the engine can apply them. */
export const BOT_TURN_DELAY_DISABLED_MS = 0;

/**
 * Ceiling, clamped-and-reported rather than accepted.
 *
 * The pause is taken inside the bot driver's per-room drain slot, and the
 * turn-timeout driver *awaits* that drain when a timeout hands the turn to a bot
 * (see turn-timer/turn-timeout-driver.ts's `driveBots`). So a runaway value does
 * not merely feel slow, it parks both server-side actors for the whole bot chain:
 * a mistyped `15000` in a six-seat room is a 75-second room-wide stall in which
 * nothing a player does can help. Ten seconds per bot turn is already far past
 * any pacing anybody wants; beyond it this stops being a pause and becomes a
 * hang, so the intent is honoured in direction ("slower") and bounded in degree.
 */
export const MAXIMUM_BOT_TURN_DELAY_MS = 10_000;

/**
 * Whether `BOT_TURN_DELAY_MS` was set at all, as opposed to what it resolves to.
 *
 * The distinction became load-bearing once a mode could pace its own bots
 * (`ModeRules.bots.thinkMsRange`, spec §4.1). An *unset* variable must let the
 * mode decide; an explicitly set one — including `0` — is an operator override
 * that outranks the mode, because an override a room could quietly ignore is not
 * an override. Before this, {@link parseBotTurnDelayMs} answered
 * {@link DEFAULT_BOT_TURN_DELAY_MS} for both cases, which would have made every
 * mode's range dead configuration on any deployment.
 */
export function isBotTurnDelayConfigured(
  configured: string | undefined,
): configured is string {
  return configured !== undefined && configured.trim().length > 0;
}

export type BotTurnDelayConfigResult =
  | { readonly ok: true; readonly delayMs: number }
  | {
      readonly ok: false;
      readonly error: { readonly code: "INVALID_BOT_TURN_DELAY" };
      /** What to use anyway — a bad knob must not take the server down. */
      readonly fallbackMs: number;
    };

/**
 * Reads `BOT_TURN_DELAY_MS`.
 *
 * Unset takes {@link DEFAULT_BOT_TURN_DELAY_MS}, because a default of "off" would
 * look exactly like the pacing feature not working. `0` is first-class off.
 *
 * Everything else — a negative, a fraction, a non-number, a value past
 * {@link MAXIMUM_BOT_TURN_DELAY_MS} — is *reported* rather than quietly
 * substituted. Silently falling back made a typo'd delay indistinguishable from
 * an unset one, and bot pacing is precisely the kind of thing somebody tunes and
 * then wonders why nothing changed.
 */
export function parseBotTurnDelayMs(
  configured: string | undefined,
): BotTurnDelayConfigResult {
  if (!isBotTurnDelayConfigured(configured)) {
    return { ok: true, delayMs: DEFAULT_BOT_TURN_DELAY_MS };
  }

  const delayMs = Number(configured.trim());
  if (!Number.isSafeInteger(delayMs) || delayMs < 0) {
    return {
      ok: false,
      error: { code: "INVALID_BOT_TURN_DELAY" },
      fallbackMs: DEFAULT_BOT_TURN_DELAY_MS,
    };
  }

  if (delayMs > MAXIMUM_BOT_TURN_DELAY_MS) {
    // Clamped, not defaulted: somebody who asked for "much slower" gets the
    // slowest supported pacing rather than being silently sped back up to the
    // default they were deliberately moving away from.
    return {
      ok: false,
      error: { code: "INVALID_BOT_TURN_DELAY" },
      fallbackMs: MAXIMUM_BOT_TURN_DELAY_MS,
    };
  }

  return { ok: true, delayMs };
}
