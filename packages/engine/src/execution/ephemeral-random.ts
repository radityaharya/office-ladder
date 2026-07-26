import type { GameState } from "../model";
import { createSeededRandomSource, type SeededRandomSource } from "../random";

/**
 * Which sub-resolution of a command is asking for randomness.
 *
 * This is a *domain separator*, not decoration. Every ephemeral source in a
 * command derives its seed from the same canonical state, so without a
 * discriminator two independently-created sources would be the same stream and
 * their outcomes would be perfectly correlated (a tile-effect check and a
 * decision check at the same state would always agree). Adding a new
 * randomness-consuming resolution means adding a member here, never reusing an
 * existing one.
 */
export type EphemeralRandomPurpose =
  | "tile-effects"
  | "audit-release"
  | "tile-decision";

/**
 * None of the seed fields can contain a pipe — they are ids (alphanumerics plus
 * `.`, `:` and `-`, per the transport's own id grammar), algorithm names, and
 * decimal numbers — so the joined seed is unambiguous: two different field
 * tuples can never flatten to the same string.
 */
const SEED_FIELD_SEPARATOR = "|";

/** Stands in for a stream a state does not carry, so the seed stays total. */
const ABSENT_FIELD = "-";

function streamFields(state: GameState, streamName: string): readonly string[] {
  const stream = state.rng.streams[streamName];
  if (stream === undefined) return [ABSENT_FIELD, ABSENT_FIELD, ABSENT_FIELD];

  return [stream.algorithm, stream.state, String(stream.cursor)];
}

/**
 * The seed for an ephemeral, single-command random source.
 *
 * Every field is server-owned canonical state; nothing the client sends is in
 * here. In particular the command id is deliberately absent — it used to be the
 * *whole* seed, which let a client enumerate candidate ids offline against this
 * 32-bit PRNG and pick one that produced the outcome it wanted (guaranteed
 * doubles on an audit-release attempt, a chosen band on a tile-decision check).
 * The command id is now used only for idempotency (`lastCommandId`) and
 * causation.
 *
 * The two properties this has to satisfy:
 *
 * - **Not client-controlled.** A client can choose its command id freely and
 *   nothing here changes; the outcome of a command is a function of the state it
 *   is applied against. It cannot resubmit against the same state to shop for a
 *   better one either, because the first accepted command advances `revision`
 *   and every later command is refused as stale.
 * - **Replay-identical.** The seed depends only on `state` (plus a compile-time
 *   purpose constant), and `state` is exactly what a replay feeds back in, so
 *   the same command re-applied to the same state re-derives the same seed and
 *   therefore the same faces, events, and next state.
 *
 * `revision`/`eventSequence` make the seed advance between commands (both are
 * strictly monotonic, and every accepted command emits at least one event), so
 * consecutive audit-release attempts are independent draws rather than the same
 * failed roll re-run forever. The `dice` stream's state and cursor fold in the
 * movement RNG's own progression. The `setup` stream's state is the one field a
 * client has no observational path to at all: it is derived from the server's
 * setup seed, is never published in any projection, and no observable game
 * output is drawn from it (nothing consumes that stream after `createGame`), so
 * unlike the dice stream it cannot be reconstructed from die faces the client
 * has already been shown.
 */
export function ephemeralRandomSeed(
  state: GameState,
  purpose: EphemeralRandomPurpose,
): string {
  return [
    "ephemeral",
    purpose,
    state.gameId,
    String(state.revision),
    String(state.eventSequence),
    ...streamFields(state, "dice"),
    ...streamFields(state, "setup"),
  ].join(SEED_FIELD_SEPARATOR);
}

/**
 * A fresh random source for one purpose inside one command.
 *
 * Ephemeral on purpose: it is never written back to `state.rng.streams`, so the
 * persisted "dice" stream's cursor keeps advancing exactly once per die roll
 * (which replay assertions depend on) while these draws stay deterministic.
 *
 * **Exactly one source per purpose per command.** The seed is a pure function of
 * `state` and `purpose`, and `state` does not change while a command is being
 * resolved, so calling this twice with the same purpose inside one command hands
 * back two sources at the *same* position rather than a fresh stream — every
 * draw from the second would repeat the first. Anything needing more randomness
 * must keep drawing from the source it already has (which advances its cursor,
 * as nested `rollCheck`s and multi-card draws do) or declare a new purpose. This
 * is pinned by a test in `ephemeral-random-seeding.test.ts`.
 */
export function createEphemeralRandom(
  state: GameState,
  purpose: EphemeralRandomPurpose,
): SeededRandomSource {
  return createSeededRandomSource(ephemeralRandomSeed(state, purpose));
}

/**
 * The `rngStream` label for a `DiceRolled` event drawn from an ephemeral
 * source. Named for the purpose rather than the command, so the event neither
 * implies the roll came from the persisted stream nor echoes client-supplied
 * text back into the event log.
 */
export function ephemeralRandomStreamName(purpose: EphemeralRandomPurpose): string {
  return `ephemeral:${purpose}`;
}
