/**
 * The one command endpoint (spec §11.1).
 *
 * Before this file there were two per-command routes — `/roll` and `/respond` —
 * and each was a hand-written copy of the same eight steps: same-origin, session,
 * body parse, actor entitlement, revision check, submit, rejection mapping,
 * publish. v2 has twenty-seven player commands. Twenty-seven more copies is not a
 * design; it is twenty-seven places for one of the eight to be forgotten, and the
 * one most likely to be forgotten is the entitlement check.
 *
 * So the eight steps live here exactly once, and a command's *type* selects a
 * payload rather than a route. `packages/contracts` owns the discriminated union
 * (`parseCommandType` + `parsePlayerCommandRequest`), `RoomService.submitCommand`
 * owns applying it, and this module owns only the transport concerns neither of
 * them can see: identity, idempotency, burst serialisation and the shape of a
 * refusal.
 *
 * Nothing here translates a request into an engine command. That translation is
 * `rooms/service/commands.ts`, reached through `RoomService.submitCommand`, which
 * also holds the room's write lock — so a player's command, a bot's and the turn
 * clock's all serialise against each other instead of racing the revision
 * predicate. A second translator in the route would be a second place for a
 * payload to be built wrongly, and only one of the two would be lock-protected.
 *
 * ## Identity is checked here; legality is checked by the engine
 *
 * These are different questions and both must be answered (spec §6.3). This file
 * asks "does this session own a seat at this table, and is that seat a human
 * one" — before the engine sees anything. The engine asks "is this move legal for
 * that seat right now". Neither substitutes for the other: an entitlement check
 * that trusted the engine would let a spectator submit a command that happens to
 * be legal for the active player, and a legality check that trusted the route
 * would let a seated player cast somebody else's vote.
 *
 * Mode gating is deliberately **not** here. `state.rules` decides whether a
 * mechanic exists, and the engine transition that owns the mechanic is the single
 * place that reads it — a second copy in the route would drift, and a drifted
 * copy is either a mechanic that is unreachable or one that is reachable when the
 * mode says it is off.
 *
 * ## What a burst looks like
 *
 * A reaction window opening means every seated client reacts at once; a ballot
 * means every seat writes against one game. Handlers racing the repository's
 * revision predicate would turn an N-player ballot into one commit and N-1
 * conflicts, so submissions queue per room and drain one at a time through
 * `rooms/drain-scheduler.ts` — the same scheduler the bot and turn-timeout
 * drivers use, for the same reason.
 */
import { createHash } from "node:crypto";

import {
  ContractValidationError,
  parseCommandType,
  parseOpaqueId,
  parsePlayerCommandRequest,
  SERVER_INJECTED_COMMAND_TYPES,
  type PlayerCommandRequestByType,
  type PlayerCommandType,
} from "@office-ladder/contracts";
import { db } from "@office-ladder/db";
import { commandReceipts } from "@office-ladder/db/schema";
import { createStableId, stableStringify } from "@office-ladder/engine";
import { and, eq } from "drizzle-orm";
import type { Context, Hono } from "hono";

import { requireSession } from "@/auth/require-session";
import { json, parseJson, requireSameOriginMutation } from "@/http";
import { log, logException, type LogLevel } from "@/observability/log";
import { publishProjectionUpdate } from "@/realtime/publish-projection-update";
import { isBotMember, normalizeStoredRoom } from "@/rooms/bots/bot-seats";
import { botDriver } from "@/rooms/bots/default-driver";
import { createRoomDrainScheduler } from "@/rooms/drain-scheduler";
import { roomRepository, roomService } from "@/rooms/service";
import { commandRejectionLevel } from "@/rooms/service/rejection";
import type {
  PlayerCommandSelection,
  RoomRepository,
  RoomService,
  RoomServiceErrorCode,
} from "@/rooms/service/types";
import { turnTimeoutDriver } from "@/rooms/turn-timer/default-driver";
import { windowExpiryDriver } from "@/rooms/window-timer/default-driver";

/* ------------------------------------------------------------------ *
 * Shared HTTP plumbing
 *
 * Lives here rather than in routes/rooms.ts because rooms.ts imports this
 * module: one direction only, so there is no import cycle to reason about.
 * ------------------------------------------------------------------ */

/**
 * Every way a command can be refused.
 *
 * The engine's and the room service's codes, plus the two this layer owns: a
 * replayed `commandId` carrying a *different* body, and a server-injected command
 * arriving from a player. Both are transport faults the engine cannot see,
 * because neither request ever reaches it.
 */
export type CommandRejectionCode =
  | RoomServiceErrorCode
  | "COMMAND_ID_REUSED"
  | "SERVER_INJECTED_COMMAND";

export function errorResponse(code: string, status: number): Response {
  return json({ error: { code } }, { status });
}

export function rejectionStatus(code: CommandRejectionCode): number {
  switch (code) {
    case "ROOM_NOT_FOUND":
    case "ROOM_CODE_NOT_FOUND":
    case "MEMBER_NOT_BOT":
      return 404;
    // ACTOR_IS_BOT / ACTOR_NOT_BOT: a session actor naming a bot seat, or the bot
    // driver naming a human member. Neither is reachable from a well-behaved
    // client, and both are a refusal to act as somebody else — 403, not 400.
    //
    // SERVER_INJECTED_COMMAND is the §7.1 refusal: `window.expire`,
    // `quarter.advance` and `turn.timeout` are the server acting as the clock, so
    // a player sending one is claiming an authority they do not have.
    case "ACTOR_NOT_HOST":
    case "ACTOR_NOT_MEMBER":
    case "ACTOR_NOT_AUTHORIZED":
    case "ACTOR_IS_BOT":
    case "ACTOR_NOT_BOT":
    case "SERVER_INJECTED_COMMAND":
      return 403;
    // ROOM_CODE_UNAVAILABLE: every draw collided with a live room's code.
    // Retryable, and the client's next attempt draws fresh codes.
    // CHARACTER_TAKEN: somebody claimed it first. A conflict with another
    // member's state, not a malformed request — the client re-picks.
    // COMMAND_ID_REUSED: this id already names a different command. A conflict
    // with what is already recorded, which is exactly what 409 means.
    case "ROOM_FULL":
    case "ROOM_NOT_OPEN":
    case "MINIMUM_PLAYERS_NOT_MET":
    case "STALE_REVISION":
    case "LAST_HUMAN_REQUIRED":
    case "ROOM_CODE_UNAVAILABLE":
    case "CHARACTER_TAKEN":
    case "COMMAND_ID_REUSED":
      return 409;
    // The state could not be represented for storage, so the write was refused
    // rather than persisted lossily. Nothing the caller sent caused it and
    // retrying the same request cannot help — that is a 500, not a 400.
    case "SERIALIZATION_FAILED":
      return 500;
    default:
      return 400;
  }
}

export function serviceErrorResponse(code: CommandRejectionCode): Response {
  return errorResponse(code, rejectionStatus(code));
}

/**
 * Who was trying to do what. Threaded through every log line a request can
 * emit, so one `grep` on a room id reconstructs the whole attempt without a
 * debugger.
 *
 * `room` is the *raw* path parameter, captured before validation on purpose: "a
 * client keeps sending a malformed room id" is worth being able to see. Raw
 * request input is safe here because the formatter escapes any value that is not
 * plainly id-shaped, so a header or a path segment cannot forge a second line.
 */
export type CommandContext = {
  /** Same vocabulary as the log event name: `room.command`, `room.bot-add`, … */
  readonly command: string;
  readonly room: string | null;
  readonly actor: string | null;
};

export function commandContext(
  command: string,
  actor: string | null,
  room?: string | null,
): CommandContext {
  return { command, room: room ?? null, actor };
}

function rejectionLevel(code: CommandRejectionCode): LogLevel {
  // Both of this layer's own codes mean somebody sent something no client of
  // ours produces, so neither is the routine double-click a player can cause.
  if (code === "COMMAND_ID_REUSED" || code === "SERVER_INJECTED_COMMAND") return "warn";
  return commandRejectionLevel(code);
}

/**
 * A rejection the service returned as a value. The level comes from the code
 * (rooms/service/rejection.ts): a stale revision from a double-click is `info`,
 * an `INVARIANT_VIOLATION` is our own bug and is `warn`.
 */
export function rejected(context: CommandContext, code: CommandRejectionCode): Response {
  log(rejectionLevel(code), "command.rejected", { ...context, code });
  return serviceErrorResponse(code);
}

/**
 * A committed mutation — the only success line in this file. Roughly one per
 * player action, which for a turn-based board game is nowhere near spam, and it
 * is the difference between being able to reconstruct a match afterwards and
 * not. The polled GET bootstrap deliberately has no equivalent.
 */
export function applied(
  context: CommandContext,
  revision: number,
  gameRevision?: number,
): void {
  log("info", "command.applied", { ...context, revision, gameRevision });
}

/**
 * The one place a thrown error inside a handler can still be seen.
 *
 * Every handler used to end in `catch (error) { … return 500 }` that discarded
 * `error` entirely, so a Postgres outage, a malformed BETTER_AUTH_EXTRA_ORIGINS
 * and projections.ts's "Active room is missing its canonical game" all produced
 * one identical opaque 500 with no trace anywhere in the process. The responses
 * are deliberately unchanged — a client must not learn internals — but they are
 * no longer the only record.
 */
export async function handled(
  context: CommandContext,
  run: () => Promise<Response>,
): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ContractValidationError) {
      log("info", "command.invalid-request", {
        ...context,
        field: error.path,
        reason: error.reason,
      });
      return errorResponse("INVALID_REQUEST", 400);
    }

    logException("error", "command.failed", error, context);
    return errorResponse("INTERNAL_SERVER_ERROR", 500);
  }
}

/**
 * Everything that has to happen after a game command commits: tell the clients,
 * then give both server-side actors a chance to move the match on.
 *
 * The two drivers are kicked together on purpose. Each is idempotent and
 * per-room serialized, so a kick that has nothing to do is one repository read;
 * a kick that is *missed* is a match that sits still until somebody's next poll.
 * The bot driver takes over when the new active player is a bot; the timeout
 * driver arms the clock when it is a human, and enforces it when it runs out.
 */
export async function announce(
  roomId: string,
  revision: number,
  messageId: string,
): Promise<void> {
  await publishProjectionUpdate(roomId, revision, messageId);
  botDriver.schedule(roomId);
  turnTimeoutDriver.schedule(roomId);
  // The third server-side actor (spec §7.1). A command can open a reaction
  // window, a ballot or a promotion block, and the deadline the engine wrote on
  // it is enforced by nothing until this driver is armed for the room.
  windowExpiryDriver.schedule(roomId);
}

/**
 * A cross-origin mutation attempt is rare and security-relevant, so unlike the
 * very common expired-session 401 it is reported rather than merely refused.
 */
export function originRejection(request: Request, command: string): Response | null {
  const origin = requireSameOriginMutation(request);
  if (origin.ok) return null;

  log("warn", "http.origin-rejected", {
    command,
    origin: request.headers.get("origin"),
    fetchSite: request.headers.get("sec-fetch-site"),
  });
  return errorResponse(origin.error.code, origin.error.status);
}

/* ------------------------------------------------------------------ *
 * The parsed command
 * ------------------------------------------------------------------ */

/**
 * A body that has been validated, paired with the type it was validated as.
 *
 * Written as a *distributed* mapped type rather than `{ type: PlayerCommandType;
 * request: SomeUnion }` so that narrowing on `type` narrows `request` with it —
 * which is what lets this be handed to `RoomService.submitCommand` without a
 * cast, and what makes a mismatch between a type and its payload a compile error
 * rather than a runtime surprise.
 *
 * It is the room service's `PlayerCommandSelection` plus `game.start`, which the
 * service excludes because starting a match is not a command against a game that
 * exists yet. The `satisfies` in `submitThroughService` is what keeps the two in
 * step.
 */
export type ParsedPlayerCommand = {
  [Type in PlayerCommandType]: {
    readonly type: Type;
    readonly request: PlayerCommandRequestByType[Type];
  };
}[PlayerCommandType];

/**
 * Splits `{ type, …fields }` into the discriminant and the body contracts
 * validates.
 *
 * The wire shape is flat — a genuine discriminated union on `type` — but the
 * per-command parsers enforce an *exact* key set that does not include `type`,
 * so the discriminant is removed before they see it. Everything else is still
 * subject to that exact-key check, so an unknown field is refused rather than
 * ignored: a body cannot smuggle a field a later version might start reading.
 */
export function parsePlayerCommandBody(body: unknown): ParsedPlayerCommand {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ContractValidationError("command", "must be an object");
  }

  const { type: rawType, ...rest } = body as Record<string, unknown>;
  const type = parseCommandType(rawType);
  const request = parsePlayerCommandRequest(type, rest);

  // The one cast in this module. `parsePlayerCommandRequest` is a mapped-type
  // registry keyed by the same literal, so the pair is correct by construction;
  // TypeScript simply cannot follow a lookup through a non-literal key back into
  // a distributed union.
  return { type, request } as ParsedPlayerCommand;
}

/* ------------------------------------------------------------------ *
 * Idempotency
 * ------------------------------------------------------------------ */

/**
 * What a `commandId` already bought.
 *
 * Only *applied* commands are recorded. A rejection changed nothing, so replaying
 * it would freeze a transient refusal — a `STALE_REVISION` from a lost race would
 * keep being returned to a client that has since re-read and could now succeed.
 * Recording only the commits is what makes "return the original outcome" mean
 * "return the outcome that actually happened".
 */
export type CommandReceipt = {
  readonly commandId: string;
  readonly type: string;
  readonly actorId: string;
  /** Hash of the validated body, so a reused id carrying a different command is caught. */
  readonly requestHash: string;
  readonly expectedRevision: number;
  readonly roomRevision: number;
  readonly gameRevision: number;
};

export interface CommandReceiptStore {
  find(gameId: string, commandId: string): Promise<CommandReceipt | null>;
  /**
   * Records an applied command. Must be a no-op if a receipt for
   * (gameId, commandId) already exists — the write happens after the commit, so
   * a duplicate here means somebody else already recorded the same outcome.
   */
  record(gameId: string, receipt: CommandReceipt): Promise<void>;
}

/**
 * Identifies the *content* of a submission, so a replayed id can be told apart
 * from a reused one.
 *
 * `expectedRevision` is deliberately outside the hash and kept in its own column:
 * the same command retried after a lost race legitimately carries a new revision,
 * and refusing that would turn an honest retry into a permanent 409.
 */
export function commandRequestHash(parsed: ParsedPlayerCommand): string {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed.request)) {
    if (key === "commandId" || key === "expectedRevision") continue;
    payload[key] = value;
  }

  return createHash("sha256")
    .update(stableStringify({ type: parsed.type, payload }))
    .digest("hex");
}

export class InMemoryCommandReceiptStore implements CommandReceiptStore {
  private readonly receipts = new Map<string, CommandReceipt>();

  private static key(gameId: string, commandId: string): string {
    return `${gameId} ${commandId}`;
  }

  find(gameId: string, commandId: string): Promise<CommandReceipt | null> {
    return Promise.resolve(
      this.receipts.get(InMemoryCommandReceiptStore.key(gameId, commandId)) ?? null,
    );
  }

  record(gameId: string, receipt: CommandReceipt): Promise<void> {
    const key = InMemoryCommandReceiptStore.key(gameId, receipt.commandId);
    if (!this.receipts.has(key)) this.receipts.set(key, receipt);
    return Promise.resolve();
  }
}

/**
 * The `command_receipts` table, used for the first time.
 *
 * It was provisioned with the rest of the event-sourced schema and never written;
 * the retry story until now was the engine's `lastCommandId`, which only
 * remembers the single most recent command. That is enough for a double-clicked
 * button and nothing else — a client that retries after any other command has
 * landed would apply twice.
 *
 * The row is written **after** the room commit, not before, and that ordering is
 * load-bearing: `command_receipts.game_id` carries a foreign key to `games.id`,
 * and the `games` row for a freshly started match is created by the repository's
 * own save. Inserting the receipt first would abort on a reference that does not
 * exist yet — the same foreign-key ordering hazard that has already shipped once
 * in this file's neighbourhood.
 *
 * The cost of that ordering is a crash window: a process that dies between the
 * commit and the receipt loses the record of one command, and a retry of it
 * applies twice unless the engine's `lastCommandId` still matches. Closing it
 * needs the receipt written inside the repository's own transaction, which is a
 * change to the repository rather than to this route.
 */
/**
 * Reads one number out of a stored `response_payload`.
 *
 * The column is `jsonb` and nothing constrains its shape at the database, so a
 * row written by an older (or a broken) version of this store must degrade to a
 * number rather than throw on a path whose whole job is answering a retry.
 */
function readNumber(value: unknown, key: string): number {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return 0;
  const found = (value as Record<string, unknown>)[key];
  return typeof found === "number" ? found : 0;
}

export class PostgresCommandReceiptStore implements CommandReceiptStore {
  async find(gameId: string, commandId: string): Promise<CommandReceipt | null> {
    const [row] = await db
      .select({
        commandId: commandReceipts.commandId,
        type: commandReceipts.type,
        actorId: commandReceipts.actorId,
        requestHash: commandReceipts.requestHash,
        expectedRevision: commandReceipts.expectedRevision,
        responsePayload: commandReceipts.responsePayload,
        resultingRevision: commandReceipts.resultingRevision,
      })
      .from(commandReceipts)
      .where(
        and(eq(commandReceipts.gameId, gameId), eq(commandReceipts.commandId, commandId)),
      )
      .limit(1);
    if (row === undefined) return null;

    const gameRevision = readNumber(row.responsePayload, "gameRevision");

    return {
      commandId: row.commandId,
      type: row.type,
      actorId: row.actorId,
      requestHash: row.requestHash,
      expectedRevision: row.expectedRevision,
      roomRevision: row.resultingRevision ?? 0,
      gameRevision,
    };
  }

  async record(gameId: string, receipt: CommandReceipt): Promise<void> {
    await db
      .insert(commandReceipts)
      .values({
        id: `${gameId}:${receipt.commandId}`,
        gameId,
        commandId: receipt.commandId,
        actorId: receipt.actorId,
        type: receipt.type,
        requestHash: receipt.requestHash,
        expectedRevision: receipt.expectedRevision,
        status: "accepted",
        responsePayload: {
          roomRevision: receipt.roomRevision,
          gameRevision: receipt.gameRevision,
        },
        resultingRevision: receipt.roomRevision,
      })
      // Whoever got there first recorded the same commit; a second row would
      // break the (game_id, command_id) unique index for no gain.
      .onConflictDoNothing();
  }
}

/* ------------------------------------------------------------------ *
 * The gateway
 * ------------------------------------------------------------------ */

export type CommandSubmission = {
  readonly roomId: string;
  /** The session's own user id. Never anything the client sent. */
  readonly actorId: string;
  readonly command: ParsedPlayerCommand;
};

export type CommandOutcome = {
  readonly roomId: string;
  readonly revision: number;
  readonly gameRevision: number;
  /** True when this response came from a receipt rather than a fresh apply. */
  readonly replayed: boolean;
};

export type CommandResult =
  | { readonly ok: true; readonly value: CommandOutcome }
  | { readonly ok: false; readonly error: { readonly code: CommandRejectionCode } };

export type CommandGateway = {
  submit(submission: CommandSubmission): Promise<CommandResult>;
};

export type CommandGatewayDependencies = {
  readonly roomService: RoomService;
  /**
   * Read-only here. The gateway reads the room to answer two questions the room
   * service cannot answer for it — is this caller a seat, and which game id do
   * receipts hang off — and never writes through it.
   */
  readonly repository: RoomRepository;
  readonly receipts: CommandReceiptStore;
};

function fail(code: CommandRejectionCode): CommandResult {
  return { ok: false, error: { code } };
}

type PendingSubmission = {
  readonly apply: () => Promise<CommandResult>;
  readonly settle: (result: CommandResult) => void;
  readonly fault: (error: unknown) => void;
};

export function createCommandGateway(deps: CommandGatewayDependencies): CommandGateway {
  /**
   * Submissions waiting for their room's turn to write.
   *
   * A ballot means every seated player writes against one game at the same
   * instant. Without this queue each handler would read the same revision and
   * N-1 would lose the repository's revision predicate, so an eight-seat vote
   * would be one commit and seven refusals a correct client did nothing to
   * deserve. Queued, they apply one after another against freshly read state.
   */
  const queues = new Map<string, PendingSubmission[]>();

  function queueFor(roomId: string): PendingSubmission[] {
    const queue = queues.get(roomId);
    if (queue === undefined || queue.length === 0) {
      queues.delete(roomId);
      return [];
    }
    return queue;
  }

  const scheduler = createRoomDrainScheduler({
    /**
     * Drains the whole queue, settling every entry it takes.
     *
     * Nothing in here may throw: an entry that is dequeued and then abandoned is
     * a request that hangs until its client gives up, so each apply is wrapped
     * individually and a fault settles that one entry rather than the pass.
     */
    run: async (roomId) => {
      for (;;) {
        const next = queueFor(roomId).shift();
        if (next === undefined) return;

        try {
          next.settle(await next.apply());
        } catch (error) {
          next.fault(error);
        }
      }
    },
    onCrash: (roomId, error) => {
      // Unreachable while `run` settles every entry itself, but a queue left
      // holding unsettled entries is a set of hung requests, so it is drained
      // rather than trusted.
      for (const pending of queueFor(roomId).splice(0)) pending.fault(error);
      logException("error", "command.drain-crashed", error, { room: roomId });
    },
  });

  function enqueue(
    roomId: string,
    apply: () => Promise<CommandResult>,
  ): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve, reject) => {
      const queue = queues.get(roomId) ?? [];
      queue.push({ apply, settle: resolve, fault: reject });
      queues.set(roomId, queue);
      scheduler.schedule(roomId);
    });
  }

  /**
   * Hands the validated command to the room service, which owns the write.
   *
   * `game.start` is the one command that does not go through `submitCommand`,
   * and that is the service's distinction rather than this route's: the game does
   * not exist until `start` builds it, so its `expectedRevision` means the
   * *room's* revision while every other command's means the game's. Folding them
   * together would give one envelope two meanings.
   */
  async function submitThroughService(
    submission: CommandSubmission,
  ): Promise<CommandResult> {
    const { command, roomId, actorId } = submission;
    // The actor came from a Better Auth session, so it is a human by
    // construction — the service refuses to let one act as a bot seat.
    const actor = { roomId, actorId, actorKind: "human" } as const;

    const result =
      command.type === "game.start"
        ? await deps.roomService.start({
            ...actor,
            commandId: command.request.commandId,
            expectedRevision: command.request.expectedRevision,
          })
        : // `satisfies` rather than a cast: it is a compile-time assertion that
          // this route's parsed union and the service's `PlayerCommandSelection`
          // are still the same set of commands, so a type added to one and not the
          // other fails the build instead of failing at runtime.
          await deps.roomService.submitCommand({
            ...actor,
            ...(command satisfies PlayerCommandSelection),
          });

    if (!result.ok) return fail(result.error.code);
    return {
      ok: true,
      value: {
        roomId: result.value.id,
        revision: result.value.revision,
        gameRevision: result.value.game.revision,
        replayed: false,
      },
    };
  }

  async function apply(submission: CommandSubmission): Promise<CommandResult> {
    const { command, roomId } = submission;
    const stored = await deps.repository.get(roomId);
    if (stored === null) return fail("ROOM_NOT_FOUND");
    const room = normalizeStoredRoom(stored);

    // Entitlement, before the engine sees anything. Identity only — is this
    // session a human seat at *this* table — which is what the engine cannot
    // check, because the engine has never heard of a session or of a bot.
    const actorId = createStableId("PlayerId", submission.actorId);
    if (!room.memberIds.includes(actorId)) return fail("ACTOR_NOT_MEMBER");
    if (isBotMember(room, actorId)) return fail("ACTOR_IS_BOT");

    const gameId = room.game?.gameId ?? null;
    const requestHash = commandRequestHash(command);
    if (gameId !== null) {
      const receipt = await deps.receipts.find(gameId, command.request.commandId);
      if (receipt !== null) {
        // A reused id carrying a different command is not a retry — it is either
        // a broken client or somebody replaying an id they watched go past.
        if (receipt.requestHash !== requestHash) return fail("COMMAND_ID_REUSED");
        return {
          ok: true,
          value: {
            roomId: room.id,
            revision: receipt.roomRevision,
            gameRevision: receipt.gameRevision,
            replayed: true,
          },
        };
      }
    }

    const result = await submitThroughService(submission);
    if (!result.ok) return result;

    // After the commit, never before: see PostgresCommandReceiptStore. `game.start`
    // is the one command with no game id to key on beforehand, so its id is read
    // back from the room the service just wrote.
    const receiptGameId =
      gameId ?? (await deps.repository.get(roomId))?.game?.gameId ?? null;
    if (receiptGameId !== null) {
      await deps.receipts.record(receiptGameId, {
        commandId: command.request.commandId,
        type: command.type,
        actorId,
        requestHash,
        expectedRevision: command.request.expectedRevision,
        roomRevision: result.value.revision,
        gameRevision: result.value.gameRevision,
      });
    }

    return result;
  }

  return {
    submit(submission) {
      return enqueue(submission.roomId, () => apply(submission));
    },
  };
}

/* ------------------------------------------------------------------ *
 * The route
 * ------------------------------------------------------------------ */

export type CommandSessionResult =
  | { readonly ok: true; readonly value: { readonly userId: string } }
  | {
      readonly ok: false;
      readonly error: { readonly code: string; readonly status: number };
    };

export type CommandRouteDependencies = {
  readonly gateway: CommandGateway;
  /** Resolves the caller. Injected so a test never needs a real auth backend. */
  readonly session: (headers: Headers) => Promise<CommandSessionResult>;
  readonly announce: (roomId: string, revision: number, messageId: string) => Promise<void>;
};

/**
 * One refusal shape for every command.
 *
 * The client renders a refusal from `code` alone; `command` says what was refused
 * so a toast or a log line does not have to remember what it sent, and
 * `retryable` is the one piece of advice the server can give that the client
 * cannot derive. `command` is `null` when the body never validated far enough to
 * have a type.
 */
function refusal(
  code: string,
  status: number,
  command: PlayerCommandType | null,
  retryable: boolean,
): Response {
  return json({ error: { code, command, retryable } }, { status });
}

/**
 * `window.expire`, `quarter.advance` and `turn.timeout` (spec §7.1, §11.1).
 *
 * Contracts already makes them unsubmittable — there is no request type and no
 * parser for any of them, and `parseCommandType` refuses them by allow-list — so
 * this check exists for two other reasons. It answers 403 rather than 400,
 * because claiming the server's authority is a refusal of *identity* and not a
 * malformed body; and it emits its own log line, so an attempt to expire a
 * reaction window the instant it opened is visible rather than buried among
 * ordinary validation noise.
 */
function serverInjectedRejection(body: unknown, context: CommandContext): Response | null {
  if (typeof body !== "object" || body === null) return null;
  const type = (body as Record<string, unknown>)["type"];
  if (typeof type !== "string") return null;
  if (!(SERVER_INJECTED_COMMAND_TYPES as readonly string[]).includes(type)) return null;

  log("warn", "command.server-injected-refused", { ...context, submitted: type });
  return refusal(
    "SERVER_INJECTED_COMMAND",
    rejectionStatus("SERVER_INJECTED_COMMAND"),
    null,
    false,
  );
}

/**
 * One handler for every command, and the only place the eight steps happen.
 *
 * It takes no per-command configuration, and that is the point: there is exactly
 * one path onto the command surface, so the entitlement check, the idempotency
 * lookup and the refusal shape cannot be reached by any route that skipped one of
 * them. The `/roll` and `/respond` aliases used to pass a `forcedType` here and
 * inject it into a body that carried none; they are gone (see
 * `registerCommandRoutes`), and with them the only way a request could arrive with
 * its command type decided by the URL rather than by the body contracts validates.
 */
function commandHandler(deps: CommandRouteDependencies) {
  return async (c: Context): Promise<Response> => {
    const label = "room.command";

    const blocked = originRejection(c.req.raw, label);
    if (blocked !== null) return blocked;

    const session = await deps.session(c.req.raw.headers);
    if (!session.ok) return errorResponse(session.error.code, session.error.status);

    const body = await parseJson(c.req.raw);
    if (!body.ok) return errorResponse(body.error.code, body.error.status);

    const context = commandContext(label, session.value.userId, c.req.param("roomId"));
    return handled(context, async () => {
      const refused = serverInjectedRejection(body.value, context);
      if (refused !== null) return refused;

      let command: ParsedPlayerCommand;
      let roomId: string;
      try {
        roomId = parseOpaqueId(c.req.param("roomId"), "roomId");
        command = parsePlayerCommandBody(body.value);
      } catch (error) {
        if (!(error instanceof ContractValidationError)) throw error;
        log("info", "command.invalid-request", {
          ...context,
          field: error.path,
          reason: error.reason,
        });
        return refusal("INVALID_REQUEST", 400, null, false);
      }

      const result = await deps.gateway.submit({
        roomId,
        actorId: session.value.userId,
        command,
      });
      if (!result.ok) {
        const { code } = result.error;
        log(rejectionLevel(code), "command.rejected", {
          ...context,
          code,
          submitted: command.type,
        });
        // A stale revision means somebody else got there first: re-read and the
        // same command may well succeed. Everything else refused the command
        // itself, and repeating it unchanged changes nothing.
        return refusal(code, rejectionStatus(code), command.type, code === "STALE_REVISION");
      }

      const { revision, gameRevision, replayed } = result.value;
      if (!replayed) {
        applied({ ...context, command: `room.${command.type}` }, revision, gameRevision);
        await deps.announce(roomId, revision, command.request.commandId);
      }

      return json({
        room: { id: result.value.roomId, revision },
        game: { revision: gameRevision },
        command: { commandId: command.request.commandId, type: command.type, replayed },
      });
    });
  };
}

/**
 * Mounts the command surface on the rooms router. One route, twenty-seven
 * commands.
 *
 * `POST /:roomId/roll` and `POST /:roomId/respond` were mounted here as thin
 * aliases onto the same handler so the shipped client kept working while the UI
 * migrated (spec §11.1: "Delete them in wave 5, not before"). The client migrated
 * — `game-client.tsx` has a single `submitCommand` that posts to `/commands` and
 * nothing anywhere posts to either alias — so they are gone.
 *
 * They are not coming back as a compatibility shim. An alias had to decide a
 * command's type from its URL and merge it into a body that carried none, which
 * meant a second way to name a command that `parsePlayerCommandRequest` never saw
 * as the client wrote it. Two doors onto twenty-seven commands is one door too
 * many, and the reason the aliases were ever acceptable — a client that could not
 * yet reach `/commands` — no longer exists. A POST to either path is now a plain
 * 404, which is what a retired endpoint should look like: the request never
 * reaches the gateway, so it cannot half-apply.
 */
export function registerCommandRoutes(router: Hono, deps: CommandRouteDependencies): void {
  router.post("/:roomId/commands", commandHandler(deps));
}

/* ------------------------------------------------------------------ *
 * Production wiring
 * ------------------------------------------------------------------ */

export const commandReceiptStore: CommandReceiptStore = new PostgresCommandReceiptStore();

export const commandGateway: CommandGateway = createCommandGateway({
  roomService,
  repository: roomRepository,
  receipts: commandReceiptStore,
});

export const defaultCommandRouteDependencies: CommandRouteDependencies = {
  gateway: commandGateway,
  async session(headers) {
    const result = await requireSession(headers);
    return result.ok
      ? { ok: true, value: { userId: result.value.user.id } }
      : { ok: false, error: result.error };
  },
  announce,
};
