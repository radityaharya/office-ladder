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
   * was still removed. It means the descriptor is one this path cannot settle —
   * either outside the authored vocabulary entirely, or one of the twenty
   * state-scoped v2 verbs, which `effects-v2`'s `resumePendingEffect` settles
   * instead. Either way the caller can log a real gap rather than silently
   * believe something happened. See `APPLICABLE_EFFECT_TYPES`.
   */
  readonly applied: boolean;
};

/**
 * Which authored effect types **this** settlement path can actually apply, as a
 * total map so a new authored effect type is a **compile error here** rather
 * than a silent no-op.
 *
 * This exists because `PendingEffectState.effect` is a bare `JsonObject` (it has
 * to be: canonical state is JSON, and the effect may outlive the command that
 * raised it across a repository round trip). Handing an unrecognised object to
 * `applyEffectDescriptors` would let it fall out of the v1 walk into the v2
 * routing seam, which has no `GameState` to route into on this path — so it
 * would resolve to nothing while `applied: true` claimed otherwise. The object
 * is therefore checked back into the union before it is used, and anything this
 * path cannot honour is declined.
 *
 * ## The split, and why it is a design decision rather than bookkeeping
 *
 * `false` here is *not* "unimplemented". It is: **an effect of this type is not
 * settled by the legacy prevention path**, because settling it needs the whole
 * game — a second player to steal from, a `heat` track, a tile to claim, a
 * prompt to open. `applyPendingEffect` has a single `PlayerState` per affected
 * id and nothing else, and inventing a partial reading of a targeted effect
 * from inside it would be worse than declining: an un-prevented steal that
 * silently moved nothing is a rule the table cannot see.
 *
 * So the line is drawn by *scope*, not by hostility or by taste:
 *
 * - `true` — the twelve v1 verbs, every one of which is a mutation of one
 *   player's own record, plus `noEffect`, whose correct settlement genuinely is
 *   to do nothing. These land when their window closes un-prevented.
 * - `false` — all twenty of the v2 verbs. They are settled by
 *   `effects-v2/resolve.ts`'s `resumePendingEffect`, which is state-scoped and
 *   is the *only* correct consumer of a v2 pending effect. A window guarding one
 *   must be resumed through there; closing it through this path reports
 *   `applied: false` so the caller can log a real gap instead of believing
 *   something happened. `reaction-window.ts` still routes every close through
 *   here — see the note on `PendingEffectApplication.applied`.
 *
 * Note what this map does *not* decide: whether a reaction may cancel an effect.
 * That is `preventionEligible`, set from the authored `preventable` flag when
 * the effect is proposed, and it is orthogonal — a v2 effect is fully
 * preventable, it is only its *un-prevented* settlement that this path declines.
 */
const APPLICABLE_EFFECT_TYPES: Readonly<Record<EffectDescriptor["type"], boolean>> = {
  // v1 — one player's own record, which is exactly what this path holds.
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
  // Settles correctly here because settling it is doing nothing.
  noEffect: true,

  // v2 — state-scoped. `resumePendingEffect` settles these, not this path.
  transferResource: false,
  modifyHeat: false,
  placeObject: false,
  claimTile: false,
  releaseTile: false,
  startProject: false,
  contributeToProject: false,
  sabotageProject: false,
  openBallot: false,
  grantImmunity: false,
  forceDiscard: false,
  swapBoardPositions: false,
  teleport: false,
  modifyUpkeep: false,
  openReactionWindow: false,
  grantIncomeStream: false,
  removeStatuses: false,
  // Both open a `PromptState`, which is a whole-game mutation by definition.
  chooseOne: false,
  opposedRoll: false,
};

/**
 * The descriptor a pending effect carries, or `null` when it is not one this
 * path can apply.
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

  // One lookup covers both refusals: a type outside the authored vocabulary
  // reads `undefined`, one this path does not settle reads `false`.
  const applicable: boolean | undefined = (
    APPLICABLE_EFFECT_TYPES as Readonly<Record<string, boolean | undefined>>
  )[type];
  if (applicable !== true) return null;

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
