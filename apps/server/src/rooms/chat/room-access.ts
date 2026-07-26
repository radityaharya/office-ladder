/**
 * The two questions chat asks of a room: *may this actor speak here*, and *what
 * is this room's social configuration*. Both are reads; neither mutates the room
 * or the game.
 */
import { deadlineDashModes, type ModeRules } from "@office-ladder/content";
import { createStableId, type PlayerId } from "@office-ladder/engine";
import type { RoomActorKind, StoredRoom } from "@/rooms/service/types";
import type { ChatErrorCode } from "./types";

export type ResolvedChatActor =
  | { readonly ok: true; readonly value: PlayerId }
  | { readonly ok: false; readonly error: { readonly code: ChatErrorCode } };

/**
 * Resolves an actor id to the room member it may act as.
 *
 * Membership is checked **server side, against the stored room**, and there is
 * no path through this module that takes the client's word for it. A non-member
 * who knows a room id — which is in the URL of everyone who is playing — must be
 * able neither to read the log nor to post to it, and "the client would not ask"
 * is not a check.
 *
 * The bot crossing is the same rule the room service enforces for game commands
 * (`actorKindMismatch`): a session may not act as a bot seat, and the bot driver
 * may not act for a human member. Chat is a smaller stake than a turn, but a
 * session posting as a bot is impersonation either way.
 */
export function resolveChatActor(
  room: StoredRoom,
  actorId: string,
  actorKind: RoomActorKind,
): ResolvedChatActor {
  const playerId = createStableId("PlayerId", actorId);
  if (!room.memberIds.includes(playerId)) {
    return { ok: false, error: { code: "ACTOR_NOT_MEMBER" } };
  }

  const isBotSeat = room.bots.some((bot) => bot.playerId === playerId);
  if (actorKind === "human" && isBotSeat) {
    return { ok: false, error: { code: "ACTOR_IS_BOT" } };
  }
  if (actorKind === "bot" && !isBotSeat) {
    return { ok: false, error: { code: "ACTOR_NOT_BOT" } };
  }

  return { ok: true, value: playerId };
}

/**
 * The room's `ModeRules.social` block.
 *
 * Two sources, in this order, and the order matters:
 *
 * 1. **A started match uses `GameState.rules`** — the ruleset snapshotted at
 *    creation and frozen for the match (spec §4, §8.4). A custom ruleset lives
 *    only there, so reading the preset instead would silently apply the wrong
 *    chat mode to every custom-mode room, and re-reading live content mid-match
 *    would let a content release change a running game's rules.
 * 2. **A lobby uses the mode preset**, because there is no game yet and chat is
 *    available before the match starts.
 *
 * Never gated on a `modeId` string comparison: §4's binding rule is that every
 * mechanic reads its enablement from `rules`, so chat asks the ruleset what
 * `social.chat` is rather than deciding that, say, quick mode means quick chat.
 */
export function resolveSocialRules(room: StoredRoom): ModeRules["social"] {
  const snapshotted = room.game?.rules.social;
  if (snapshotted !== undefined) return snapshotted;

  return deadlineDashModes[room.modeId].rules.social;
}
