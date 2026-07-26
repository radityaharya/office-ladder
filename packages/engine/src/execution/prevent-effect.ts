import type { DeckConfig, EffectDescriptor } from "@office-ladder/content";

import {
  createStableId,
  type EffectId,
  type FrameId,
  type GameState,
  type JsonObject,
  type PendingEffectState,
  type PlayerId,
  type PlayerState,
  type ResourceId,
  type StateVisibility,
} from "../model";
import {
  createSeededRandomSource,
  type RandomSource,
  type SeededRandomSource,
} from "../random";
import { ephemeralRandomSeed } from "./ephemeral-random";
import { applyEffectDescriptors } from "./resolve-tile-effects";

/**
 * The `PendingEffectState` layer — plans/24-gameplay-v2-spec.md §10.3.
 *
 * An effect marked `preventable` is not applied where it is raised. It is
 * *proposed*: parked in `GameState.pendingEffects` with
 * `preventionEligible: true`, announced as an `EffectProposed` event, and
 * guarded by a `ReactionWindowState` (see reaction-window.ts). Only when that
 * window closes does the effect either land or get cancelled.
 *
 * Both shapes have been modelled since the first engine commit and neither has
 * ever been populated. This module is the producer and the consumer.
 *
 * Nothing here reads a clock, draws ambient randomness, or iterates
 * `state.players` — every player walk goes through `state.playerOrder`, because
 * object-key order is not a contract the repository's
 * `JSON.parse(JSON.stringify(…))` boundary preserves.
 */

/** One resource mutation a pending effect actually made, ready to be evented. */
export type PendingEffectResourceChange = {
  readonly playerId: PlayerId;
  readonly resourceId: ResourceId;
  readonly previousValue: number;
  readonly newValue: number;
};

export type PendingEffectApplication = {
  /** The full player map with the effect applied. Unchanged when nothing landed. */
  readonly players: Readonly<Record<string, PlayerState>>;
  readonly changes: readonly PendingEffectResourceChange[];
  /**
   * Whether the stored effect was one this engine build knows how to apply.
   *
   * `false` is not an error: the window still resolved correctly and the effect
   * was still removed. It means the descriptor is outside the vocabulary
   * `applyEffectDescriptors` interprets (a gameplay-v2 `transferResource`, say,
   * before its resolver is wired), so the caller can log it rather than
   * silently believe something happened.
   */
  readonly applied: boolean;
};

/**
 * The v1 effect vocabulary, as a total map so a new authored effect type is a
 * **compile error here** rather than a silent no-op.
 *
 * This exists because `PendingEffectState.effect` is a bare `JsonObject` (it has
 * to be: canonical state is JSON, and the effect may outlive the command that
 * raised it across a repository round trip). Handing an unrecognised object to
 * `applyEffectDescriptors` would fall through its exhaustive switch's
 * `satisfies never` default and return a non-`Accumulated` value, corrupting the
 * player record. So the object is checked back into the union before it is used,
 * and anything unrecognised is declined.
 */
const APPLICABLE_EFFECT_TYPES: Readonly<Record<EffectDescriptor["type"], true>> = {
  drawCards: true,
  modifyResource: true,
  restoreResourceToMaximum: true,
  payResource: true,
  incrementWorkCounter: true,
  rollCheck: true,
  applyStatus: true,
  skipTurns: true,
  gainSalary: true,
  grantExtraRoll: true,
  attemptPromotion: true,
  auditConfinement: true,
};

/**
 * The descriptor a pending effect carries, or `null` when it is not one this
 * build can apply.
 *
 * Deliberately structural rather than a full validator: the object was written
 * by `createPendingEffect` from a real `EffectDescriptor` and has only been
 * through JSON since, so the discriminant is the only field worth re-checking.
 */
export function pendingEffectDescriptor(
  pending: PendingEffectState,
): EffectDescriptor | null {
  const type = pending.effect["type"];
  if (typeof type !== "string") return null;
  if (!Object.hasOwn(APPLICABLE_EFFECT_TYPES, type)) return null;

  return pending.effect as unknown as EffectDescriptor;
}

/** Deterministic, server-owned id for a pending effect. */
export function pendingEffectId(state: GameState, sequence: number): EffectId {
  return createStableId("EffectId", `${state.gameId}:pending-effect:${sequence}`);
}

export type PendingEffectInput = {
  readonly frameId: FrameId;
  readonly sourceId: string | null;
  readonly affectedPlayerIds: readonly PlayerId[];
  readonly effect: EffectDescriptor;
  /** Sets `preventionEligible`; a reaction window may only guard a `true`. */
  readonly preventable: boolean;
  /**
   * Defaults to `"public"`. A prevention window is a decision put to the table,
   * and a player cannot choose whether to cancel an effect they are not allowed
   * to see — hidden proposals belong to mechanics that do not open a window.
   */
  readonly visibility?: StateVisibility;
};

/**
 * Proposes an effect instead of applying it.
 *
 * `sequence` is the event sequence the accompanying `EffectProposed` event will
 * carry — the game's own monotonic counter — so the id is unique within the game
 * and re-derives identically on replay. It is never built from `commandId`:
 * that is client-controlled, and letting a client choose the id of a pending
 * effect lets it aim a later command at somebody else's.
 */
export function createPendingEffect(
  state: GameState,
  sequence: number,
  input: PendingEffectInput,
): PendingEffectState {
  return {
    id: pendingEffectId(state, sequence),
    frameId: input.frameId,
    sourceId: input.sourceId,
    affectedPlayerIds: orderedPlayerIds(state, input.affectedPlayerIds),
    // Through JSON so the stored value is provably serialisable and carries no
    // `undefined` from an omitted optional field — canonical state has to
    // survive the repository's jsonb boundary byte-for-byte.
    effect: JSON.parse(JSON.stringify(input.effect)) as JsonObject,
    preventionEligible: input.preventable,
    visibility: input.visibility ?? "public",
  };
}

/**
 * The affected set, deduplicated and put in canonical turn order.
 *
 * Order is load-bearing rather than cosmetic: the effect is applied to these
 * players in sequence from one shared random source, so a `rollCheck` landing on
 * two players gives each a different face and *which* face depends entirely on
 * this order. `playerOrder` is the only ordering in canonical state that
 * survives a JSON round trip unchanged.
 */
export function orderedPlayerIds(
  state: GameState,
  playerIds: readonly PlayerId[],
): readonly PlayerId[] {
  return state.playerOrder.filter(
    (playerId) => playerIds.includes(playerId) && state.players[playerId] !== undefined,
  );
}

const PREVENTION_RANDOM_DOMAIN = "reaction-prevention";

/**
 * The random source a surviving pending effect is applied from.
 *
 * Seeded from `ephemeralRandomSeed`'s canonical, server-owned material —
 * `gameId`, `revision`, `eventSequence`, and the dice/setup stream fields — with
 * its own domain token appended. The token is what keeps this stream from
 * coinciding with the `"tile-effects"` stream it borrows that material from: two
 * sources built from the same state would otherwise be the same stream and their
 * outcomes perfectly correlated.
 *
 * Nothing the client sends is in the seed. In particular `commandId` is absent —
 * seeding from it was a real exploit (a client can enumerate ids offline against
 * a 32-bit PRNG and submit the one that produces the outcome it wants), and a
 * reaction window is exactly the place a client would want to grind: the effect
 * about to land on it is already public.
 *
 * The seed is a pure function of `state`, so replaying the same command against
 * the same state re-derives the same stream.
 */
export function preventionRandomSource(state: GameState): SeededRandomSource {
  return createSeededRandomSource(
    `${ephemeralRandomSeed(state, "tile-effects")}|${PREVENTION_RANDOM_DOMAIN}`,
  );
}

/**
 * Applies a pending effect that survived its reaction window.
 *
 * Returns the whole player map so the caller can drop it straight into the next
 * state, plus the resource changes it made so each can be reported as a
 * `ResourceChanged` event. An effect that changed no value produces no change
 * entry, matching the "no value changed, no event" rule the tile-effect walk
 * already follows.
 */
export function applyPendingEffect(
  state: GameState,
  pending: PendingEffectState,
  random: RandomSource,
  decks: readonly DeckConfig[] = [],
): PendingEffectApplication {
  const descriptor = pendingEffectDescriptor(pending);
  if (descriptor === null) {
    return { players: state.players, changes: [], applied: false };
  }

  let players = state.players;
  const changes: PendingEffectResourceChange[] = [];

  for (const playerId of orderedPlayerIds(state, pending.affectedPlayerIds)) {
    const player = players[playerId];
    if (player === undefined) continue;

    const result = applyEffectDescriptors(player, [descriptor], random, decks);
    players = { ...players, [playerId]: result.player };

    for (const change of result.changes) {
      const resource = result.player.resources[change.resource];
      if (resource === undefined) continue;
      changes.push({
        playerId,
        resourceId: resource.id,
        previousValue: change.previousValue,
        newValue: change.newValue,
      });
    }
  }

  return { players, changes, applied: true };
}
