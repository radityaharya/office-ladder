import { Hono } from "hono";

import { deadlineDashRanks } from "@office-ladder/content";
import {
  ContractValidationError,
  parseAddBotRequest,
  parseAvatarUrl,
  parseCreateRoomRequest,
  parseJoinRoomRequest,
  parseOpaqueId,
  parseSelectCharacterRequest,
  parseStartGameRequest,
} from "@office-ladder/contracts";
import { requireSession } from "@/auth/require-session";
import { json, parseJson } from "@/http";
import { log } from "@/observability/log";
import { publishProjectionUpdate } from "@/realtime/publish-projection-update";
import { botDriver } from "@/rooms/bots/default-driver";
import { shouldDriveBots } from "@/rooms/bots/should-drive";
import { roomService } from "@/rooms/service";
import { turnTimeoutDriver } from "@/rooms/turn-timer/default-driver";
import { shouldEnforceTurnTimer } from "@/rooms/turn-timer/should-enforce";
import { windowExpiryDriver } from "@/rooms/window-timer/default-driver";
import { shouldSweepWindows } from "@/rooms/window-timer/should-sweep";
import {
  announce,
  applied,
  commandContext,
  defaultCommandRouteDependencies,
  errorResponse,
  handled,
  originRejection,
  registerCommandRoutes,
  rejected,
} from "./commands";

export const roomsRouter = new Hono();

/**
 * Room lifecycle: create, join, read, seat management.
 *
 * Everything that mutates *game* state — all twenty-seven player commands —
 * lives behind the single endpoint in routes/commands.ts, which also owns the
 * shared HTTP plumbing this file imports (origin check, rejection mapping,
 * command logging). That direction is deliberate and one-way: commands.ts must
 * never import this file, so the two cannot form a cycle.
 */

roomsRouter.post("/", async (c) => {
  const blocked = originRejection(c.req.raw, "room.create");
  if (blocked !== null) return blocked;

  const session = await requireSession(c.req.raw.headers);
  if (!session.ok) return errorResponse(session.error.code, session.error.status);

  const body = await parseJson(c.req.raw);
  if (!body.ok) return errorResponse(body.error.code, body.error.status);

  const context = commandContext("room.create", session.value.user.id);
  return handled(context, async () => {
    let input;
    try {
      // The ladder length is passed rather than defaulted, for the same reason
      // the room service and room-snapshot.ts pass it: it is what a custom
      // ruleset's `upkeepByRankIndex` is measured against, and contracts cannot
      // see the content pack, so its own fallback is a hand-kept number. Both
      // happen to be 9 today. If the pack's ladder ever grows, a defaulted
      // parse here would refuse a ruleset the service would have accepted —
      // a 400 on the *host's* screen with nothing wrong on the host's side.
      input = parseCreateRoomRequest(body.value, {
        rankLadderLength: deadlineDashRanks.length,
      });
    } catch (error) {
      // A rejected *ruleset* keeps its own code rather than collapsing into the
      // generic `INVALID_REQUEST` that `handled` gives every other malformed
      // field. Before `rules` was part of the DTO, the ruleset was validated one
      // layer down by the room service and a bad one came back as
      // `INVALID_MODE_RULES`; a host who authored 26 fields and got back "bad
      // request" would have no idea which layer objected. `parseModeRules`
      // reports every path under `rules.…`, which is exactly this field's name
      // in this body, so the two cannot be confused.
      if (error instanceof ContractValidationError && error.path.startsWith("rules")) {
        return rejected(context, "INVALID_MODE_RULES");
      }
      throw error;
    }

    const result = await roomService.create({
      hostId: session.value.user.id,
      playerName: input.playerName,
      // The host's chosen preset, carried through as-is. `parseCreateRoomRequest`
      // has already checked it against ROOM_MODES, and the room service refuses
      // to start a match whose mode this content release does not provide, so a
      // mode never silently becomes a different one.
      modeId: input.mode,
      capacity: input.capacity,
      characterId: input.characterId,
      // Spec §8.4's lobby-authored ruleset, under the DTO's own field name.
      //
      // This route previously read a `customRules` key off the *raw* body and
      // stripped it before parsing, because `parseCreateRoomRequest` did not yet
      // model the field. It does now, as `rules` — and the client posts `rules`.
      // While the two names disagreed the outcome was the worst possible one:
      // the body parsed cleanly (`rules` is a known optional key), the ruleset
      // was validated, and then the route dropped it on the floor and stored
      // `null`, so every custom room silently played its base preset. Reading
      // the parsed DTO is what keeps that from being expressible again.
      //
      // Still passed on as `unknown` and re-parsed by the room service: this
      // handler is not the only door onto `create`, and the service is the one
      // place that must not be able to store an unvalidated ruleset.
      customRules: input.rules,
      // Captured from the session's own user row, never from the request body: a
      // client must not be able to name somebody else's picture, or any picture.
      avatarUrl: parseAvatarUrl(session.value.user.image),
    });

    if (!result.ok) return rejected(context, result.error.code);

    applied({ ...context, room: result.value.id }, result.value.revision);
    return json({ room: { id: result.value.id } }, { status: 201 });
  });
});

roomsRouter.post("/join", async (c) => {
  const blocked = originRejection(c.req.raw, "room.join");
  if (blocked !== null) return blocked;

  const session = await requireSession(c.req.raw.headers);
  if (!session.ok) return errorResponse(session.error.code, session.error.status);

  const body = await parseJson(c.req.raw);
  if (!body.ok) return errorResponse(body.error.code, body.error.status);

  // No room id yet, and deliberately no room *code* either: the code is a join
  // credential and must never be written to a log.
  const context = commandContext("room.join", session.value.user.id);
  return handled(context, async () => {
    const input = parseJoinRoomRequest(body.value);
    const result = await roomService.joinByCode({
      roomCode: input.roomCode,
      actorId: session.value.user.id,
      playerName: input.playerName,
      characterId: input.characterId,
      avatarUrl: parseAvatarUrl(session.value.user.image),
    });

    if (!result.ok) return rejected(context, result.error.code);

    applied({ ...context, room: result.value.id }, result.value.revision);
    return json({ room: { id: result.value.id } });
  });
});

roomsRouter.get("/:roomId", async (c) => {
  const session = await requireSession(c.req.raw.headers);
  if (!session.ok) return errorResponse(session.error.code, session.error.status);

  // Read-only, and polled every ~5s per connected client: this handler logs
  // nothing on success, by design. Only a rejection or a throw earns a line.
  const context = commandContext(
    "room.bootstrap",
    session.value.user.id,
    c.req.param("roomId"),
  );
  return handled(context, async () => {
    const roomId = parseOpaqueId(c.req.param("roomId"), "roomId");
    const result = await roomService.bootstrap({ roomId, viewerId: session.value.user.id });

    if (!result.ok) return rejected(context, result.error.code);

    // Self-healing: both drivers keep their scheduling state in memory only, so a
    // restart while a bot was the active player would otherwise wedge the match
    // forever, and a restart mid-turn would leave a deadline nothing enforces. Any
    // client loading or polling the room revives whichever one applies, but only
    // while the game is genuinely still running (see shouldDriveBots — a finished
    // match keeps naming a player as active). Neither can storm: the per-room
    // in-flight map collapses concurrent kicks into a single pass.
    if (shouldDriveBots(result.value)) botDriver.schedule(roomId);
    if (shouldEnforceTurnTimer(result.value)) turnTimeoutDriver.schedule(roomId);
    // Same self-healing argument for the third driver (spec §7.1): a restart
    // mid-window leaves a deadline in the database that no wakeup is watching,
    // and this read path is what re-arms it. `shouldSweepWindows` keeps it off
    // lobby and finished-match reads.
    if (shouldSweepWindows(result.value)) windowExpiryDriver.schedule(roomId);
    return json(result.value);
  });
});

/**
 * Starting the match.
 *
 * Kept as its own route rather than folded into `/commands`, even though
 * `game.start` *is* a player command: this is the lifecycle boundary where the
 * room stops being a lobby, and the room service builds the game here rather
 * than advancing one that already exists. `/commands` accepts `game.start` too
 * and routes it to the same service call, so the two cannot diverge.
 */
roomsRouter.post("/:roomId/start", async (c) => {
  const blocked = originRejection(c.req.raw, "room.start");
  if (blocked !== null) return blocked;

  const session = await requireSession(c.req.raw.headers);
  if (!session.ok) return errorResponse(session.error.code, session.error.status);

  const body = await parseJson(c.req.raw);
  if (!body.ok) return errorResponse(body.error.code, body.error.status);

  const context = commandContext("room.start", session.value.user.id, c.req.param("roomId"));
  return handled(context, async () => {
    const roomId = parseOpaqueId(c.req.param("roomId"), "roomId");
    const input = parseStartGameRequest(body.value);
    const result = await roomService.start({
      roomId,
      actorId: session.value.user.id,
      // The actor came from a Better Auth session, so it is a human by
      // construction — the service refuses to let one act as a bot seat.
      actorKind: "human",
      commandId: input.commandId,
      expectedRevision: input.expectedRevision,
    });

    if (!result.ok) return rejected(context, result.error.code);

    applied(context, result.value.revision, result.value.game.revision);
    await announce(roomId, result.value.revision, input.commandId);
    return json({ room: { id: result.value.id, revision: result.value.revision } });
  });
});

/**
 * Re-picking a character in the lobby.
 *
 * PUT because it is idempotent — the body states the whole of the actor's choice,
 * so a retried request cannot end up meaning something different. The actor is
 * always the session's own member: there is no `memberId` in the path or the body,
 * which is what makes it impossible to set somebody else's character.
 *
 * Answers 409 CHARACTER_TAKEN when another member already holds it. That is
 * deliberately stricter than create/join, where a taken character is quietly
 * dropped rather than costing a player their seat: here the picker is on screen,
 * so an explicit refusal is something the player can act on immediately.
 */
roomsRouter.put("/:roomId/character", async (c) => {
  const blocked = originRejection(c.req.raw, "room.character");
  if (blocked !== null) return blocked;

  const session = await requireSession(c.req.raw.headers);
  if (!session.ok) return errorResponse(session.error.code, session.error.status);

  const body = await parseJson(c.req.raw);
  if (!body.ok) return errorResponse(body.error.code, body.error.status);

  const context = commandContext(
    "room.character",
    session.value.user.id,
    c.req.param("roomId"),
  );
  return handled(context, async () => {
    const roomId = parseOpaqueId(c.req.param("roomId"), "roomId");
    const input = parseSelectCharacterRequest(body.value);
    const result = await roomService.selectCharacter({
      roomId,
      actorId: session.value.user.id,
      characterId: input.characterId,
    });

    if (!result.ok) return rejected(context, result.error.code);

    applied(context, result.value.revision);
    // The affected member is the message id, exactly like a bot seat change: a
    // character claim has no client-supplied commandId of its own.
    await publishProjectionUpdate(roomId, result.value.revision, session.value.user.id);
    return json({
      room: { id: result.value.id, revision: result.value.revision },
      character: { memberId: session.value.user.id, characterId: input.characterId },
    });
  });
});

// Bots are ordinary members, so adding one bumps the room revision exactly
// like a human join and the lobby projection carries isBot/botDifficulty. The
// broadcast messageId is the affected member id — bot seat changes have no
// client-supplied commandId of their own.
roomsRouter.post("/:roomId/bots", async (c) => {
  const blocked = originRejection(c.req.raw, "room.bot-add");
  if (blocked !== null) return blocked;

  const session = await requireSession(c.req.raw.headers);
  if (!session.ok) return errorResponse(session.error.code, session.error.status);

  const body = await parseJson(c.req.raw);
  if (!body.ok) return errorResponse(body.error.code, body.error.status);

  const context = commandContext("room.bot-add", session.value.user.id, c.req.param("roomId"));
  return handled(context, async () => {
    const roomId = parseOpaqueId(c.req.param("roomId"), "roomId");
    const input = parseAddBotRequest(body.value);
    const result = await roomService.addBot({
      roomId,
      actorId: session.value.user.id,
      difficulty: input.difficulty,
    });

    if (!result.ok) return rejected(context, result.error.code);

    const added = result.value.bots[result.value.bots.length - 1];
    if (added === undefined) {
      // addBot committed a new revision but the room came back without the seat
      // it just added. The room *has* been mutated, so the bare 500 this used to
      // return left the client and the stored room disagreeing, with nothing
      // anywhere to say why.
      log("error", "room.bot-seat-missing", {
        ...context,
        revision: result.value.revision,
        seats: result.value.bots.length,
      });
      return errorResponse("INTERNAL_SERVER_ERROR", 500);
    }

    applied({ ...context, actor: added.playerId }, result.value.revision);
    await publishProjectionUpdate(roomId, result.value.revision, added.playerId);
    return json(
      {
        room: { id: result.value.id, revision: result.value.revision },
        bot: {
          memberId: added.playerId,
          displayName: result.value.memberNames[added.playerId] ?? added.playerId,
          difficulty: added.difficulty,
        },
      },
      { status: 201 },
    );
  });
});

roomsRouter.delete("/:roomId/bots/:memberId", async (c) => {
  const blocked = originRejection(c.req.raw, "room.bot-remove");
  if (blocked !== null) return blocked;

  const session = await requireSession(c.req.raw.headers);
  if (!session.ok) return errorResponse(session.error.code, session.error.status);

  const context = commandContext(
    "room.bot-remove",
    session.value.user.id,
    c.req.param("roomId"),
  );
  return handled(context, async () => {
    const roomId = parseOpaqueId(c.req.param("roomId"), "roomId");
    const memberId = parseOpaqueId(c.req.param("memberId"), "memberId");
    const result = await roomService.removeBot({
      roomId,
      actorId: session.value.user.id,
      memberId,
    });

    if (!result.ok) return rejected(context, result.error.code);

    applied({ ...context, actor: memberId }, result.value.revision);
    await publishProjectionUpdate(roomId, result.value.revision, memberId);
    return json({
      room: { id: result.value.id, revision: result.value.revision },
      bot: { memberId },
    });
  });
});

// POST /:roomId/commands, plus the deprecated /roll and /respond aliases that
// forward into the very same handler. Registered last so the literal segments
// above are never shadowed.
registerCommandRoutes(roomsRouter, defaultCommandRouteDependencies);
