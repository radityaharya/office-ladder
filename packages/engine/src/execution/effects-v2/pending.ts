import {
  createStableId,
  type DecisionPointId,
  type EffectId,
  type FrameId,
  type GameState,
  type JsonObject,
  type JsonValue,
  type PlayerId,
  type TileId,
} from "../../model";
import type { EffectOrigin } from "../resolve-tile-effects";
import type { EffectV2 } from "./vocabulary";

/**
 * The seam between this resolver and the reactions / prompts mechanics.
 *
 * When an effect cannot resolve immediately — because it is `preventable` and a
 * window has to open first, or because its target is `chosen-opponent` and a
 * player has to pick — the resolver **parks** it: it writes a
 * `PendingEffectState` whose `effect` field carries everything needed to finish
 * the job later, and pairs it with the `ReactionWindowState` (or `PromptState`)
 * that gates it.
 *
 * Whoever closes that window or answers that prompt calls
 * `decodePendingEffect` on the parked payload and hands it back to
 * `resumePendingEffect` (see `resolve.ts`). Nothing else about the parked effect
 * needs to be understood by the resolving side, which is the entire point of
 * encoding it rather than reconstructing it.
 */

/** Exactly what has to survive being parked in canonical state. */
export type PendingEffectPayload = {
  /**
   * The effect itself, with its `target` already rewritten to `"self"`: target
   * resolution happened when the effect was parked, and re-deriving it on resume
   * against a *later* state would silently re-aim the effect at whoever became
   * richest in the meantime.
   */
  readonly effect: EffectV2;
  readonly actorId: PlayerId;
  /** Already-resolved recipients, in `playerOrder` order. */
  readonly targetPlayerIds: readonly PlayerId[];
  readonly origin: EffectOrigin;
  readonly sourceId: string | null;
  /** Board context for `tileId: null` effects, captured at park time. */
  readonly tileId: TileId | null;
  readonly idScope: string;
  readonly path: string;
};

/** The `PendingEffectState.effect` discriminator this module writes and reads. */
export const PENDING_EFFECT_PAYLOAD_KIND = "effects-v2.parked";

/**
 * Drops `undefined`-valued keys so an optional field never lands in canonical
 * state as `undefined` — §5's invariant is "no `undefined`, use `null`", and a
 * key holding `undefined` disappears entirely across the repository's
 * `JSON.parse(JSON.stringify(…))` boundary, which would make the round trip
 * lossy in a way no type would catch.
 */
export function toJsonValue(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((entry) => toJsonValue(entry));
  if (typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (inner === undefined) continue;
      result[key] = toJsonValue(inner);
    }

    return result;
  }

  return null;
}

export function encodePendingEffect(payload: PendingEffectPayload): JsonObject {
  return {
    kind: PENDING_EFFECT_PAYLOAD_KIND,
    effect: toJsonValue(payload.effect),
    actorId: payload.actorId,
    targetPlayerIds: [...payload.targetPlayerIds],
    origin: payload.origin,
    sourceId: payload.sourceId,
    tileId: payload.tileId,
    idScope: payload.idScope,
    path: payload.path,
  };
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads a parked payload back. Returns `null` for anything this module did not
 * write, so an unrelated `PendingEffectState` (the resolution stack writes those
 * too) is skipped rather than misinterpreted.
 */
export function decodePendingEffect(effect: JsonObject): PendingEffectPayload | null {
  if (effect["kind"] !== PENDING_EFFECT_PAYLOAD_KIND) return null;

  const parked = effect["effect"];
  const actorId = effect["actorId"];
  const targets = effect["targetPlayerIds"];
  const origin = effect["origin"];
  const idScope = effect["idScope"];
  const path = effect["path"];
  if (!isJsonObject(parked)) return null;
  if (typeof parked["type"] !== "string") return null;
  if (typeof actorId !== "string") return null;
  if (!Array.isArray(targets)) return null;
  if (origin !== "tile" && origin !== "card") return null;
  if (typeof idScope !== "string" || typeof path !== "string") return null;

  const targetPlayerIds: PlayerId[] = [];
  for (const target of targets) {
    if (typeof target !== "string") return null;
    targetPlayerIds.push(target as PlayerId);
  }

  const sourceId = effect["sourceId"];
  const tileId = effect["tileId"];

  return {
    // The park/resume round trip is JSON, so the effect comes back as a plain
    // object. It was an `EffectV2` when it went in and the payload kind is this
    // module's own, so the assertion is on data this module wrote.
    effect: parked as unknown as EffectV2,
    actorId: actorId as PlayerId,
    targetPlayerIds,
    origin,
    sourceId: typeof sourceId === "string" ? sourceId : null,
    tileId: typeof tileId === "string" ? (tileId as TileId) : null,
    idScope,
    path,
  };
}

/**
 * Deterministic ids for everything this resolver appends to canonical state.
 *
 * Built from server-owned state only — `gameId` and `revision`, plus the effect's
 * position in the authored tree — for the same reason `promptIds` in
 * `roll-turn.ts` is: an id derived from the client's `commandId` lets a client
 * choose the id of a record the server is about to create, and aim it at
 * another player's. `revision` is strictly monotonic per accepted command, so
 * two commands never collide; `path` disambiguates within one command; `scope`
 * disambiguates two independent effect batches resolved by the same command.
 */
export function effectsV2Id(
  state: GameState,
  label: string,
  scope: string,
  path: string,
): string {
  return `${state.gameId}:${label}:${state.revision}:${scope}:${path}`;
}

export function pendingEffectId(state: GameState, scope: string, path: string): EffectId {
  return createStableId("EffectId", effectsV2Id(state, "pending-effect", scope, path));
}

export function effectFrameId(state: GameState, scope: string, path: string): FrameId {
  return createStableId("FrameId", effectsV2Id(state, "effect-frame", scope, path));
}

export function effectPromptId(state: GameState, scope: string, path: string): DecisionPointId {
  return createStableId(
    "DecisionPointId",
    effectsV2Id(state, "effect-prompt", scope, path),
  );
}

export function effectWindowId(state: GameState, scope: string, path: string): DecisionPointId {
  return createStableId(
    "DecisionPointId",
    effectsV2Id(state, "effect-window", scope, path),
  );
}

/** The prompt kind an effect targeting `chosen-opponent` opens. */
export const CHOOSE_OPPONENT_PROMPT_KIND = "effects-v2.choose-opponent";

/** The status id `grantImmunity` writes and the resolver consumes. */
export const IMMUNITY_STATUS_ID = "status.immunity";
