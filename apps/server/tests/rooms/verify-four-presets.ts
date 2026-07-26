/**
 * Real-database proof that the mode picker is not decorative.
 *
 * **Not a vitest test, and it cannot be one** — `apps/server/vitest.config.ts`
 * aliases the `bun` module to a stub so `drizzle-orm/bun-sql` is importable
 * under Node, which means no test in that suite can open a real connection.
 * Same structural limitation as `verify-mode-rules-persistence.ts` next door.
 * Run it under Bun, against the live `DATABASE_URL`:
 *
 * ```sh
 * bun --env-file=.env.local run apps/server/tests/rooms/verify-four-presets.ts
 * ```
 *
 * `verify-mode-rules-persistence.ts` already proves the *plumbing* for one room:
 * the column is written, the column is read, a restart keeps it. This file asks
 * the different question this round exists for, and the only one that can tell a
 * working picker from a cosmetic one:
 *
 * > Can a person create a room in each of the four shipped presets, and does the
 * > match that starts actually behave differently?
 *
 * So every room here is created **the way a browser creates one**: the exact
 * JSON body the lobby posts, run through `parseCreateRoomRequest` — the same
 * validator the route runs — and the parsed DTO handed to the same service the
 * route hands it to. Only the session and the origin check are skipped; those
 * are covered by `create-room-route.test.ts`, which cannot touch a database.
 * Every read-back is through a freshly constructed repository and service, so
 * nothing is being served out of a process-local map.
 *
 * It creates its own throwaway rooms, users and games, and deletes all of them
 * in a `finally`, in foreign-key order.
 */
import { randomUUID } from "node:crypto";
import { SQL } from "bun";

import { deadlineDashModes, deadlineDashRanks } from "@office-ladder/content";
import {
  parseCreateRoomRequest,
  ROOM_MODES,
  type RoomMode,
} from "@office-ladder/contracts";
import { createStableId, type GameState, type ModeRules } from "@office-ladder/engine";
import { PostgresRoomRepository } from "../../src/rooms/postgres-repository";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import type { RoomService } from "../../src/rooms/service/types";

const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined || connectionString.length === 0) {
  console.error("DATABASE_URL is required. Run with: bun --env-file=.env.local run …");
  process.exit(2);
}

const sql = new SQL(connectionString);
const suffix = randomUUID().slice(0, 8);
const roomIdPrefix = `verify-presets-room-${suffix}`;
const members = [
  `verify-presets-host-${suffix}`,
  `verify-presets-second-${suffix}`,
  `verify-presets-third-${suffix}`,
] as const;

let failures = 0;

function ok(label: string, value?: unknown): void {
  console.log(`PASS  ${label}${value === undefined ? "" : `: ${JSON.stringify(value)}`}`);
}

function bad(label: string, value: unknown): void {
  failures += 1;
  console.log(`FAIL  ${label}: ${JSON.stringify(value)}`);
}

/** Key order is not part of the value; Postgres re-orders `jsonb` keys. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function same(label: string, actual: unknown, expected: unknown): void {
  if (canonical(actual) === canonical(expected)) ok(label);
  else bad(label, { actual, expected });
}

/**
 * A distinct six-character code per room. `rooms.code` is uniquely indexed, so a
 * generator that returns the same string twice makes every create after the
 * first fail with ROOM_CODE_UNAVAILABLE — which looks exactly like a mode being
 * rejected and is not.
 */
let codeCounter = 0;
function nextRoomCode(): string {
  codeCounter += 1;
  return `V${suffix.slice(0, 3).toUpperCase()}${codeCounter.toString(36).toUpperCase().padStart(2, "0")}`;
}

/** A brand new repository and service: a restart is "the process-local state is gone". */
function freshService(roomId: string, code: () => string = nextRoomCode): {
  service: RoomService;
  repository: PostgresRoomRepository;
} {
  const repository = new PostgresRoomRepository();
  return {
    repository,
    service: createRoomService({
      repository,
      now: () => new Date().toISOString(),
      ids: {
        roomId: () => roomId,
        roomCode: code,
        gameId: () => createStableId("GameId", `${roomId}-game`),
        commandId: () => createStableId("CommandId", `${roomId}-command`),
      },
      gameSeed: () => `${roomId}-seed`,
      turnTimeoutMs: 0,
    }),
  };
}

/**
 * The browser's own request body, validated by the contract and handed on
 * exactly as `routes/rooms.ts` hands it on — including the field name, which is
 * the part that was broken: the route read `customRules` off the raw body while
 * the lobby posted `rules`, so an authored ruleset validated and was then
 * dropped. A verification that called the service directly with
 * `customRules: …` would have passed throughout that bug.
 */
async function createAsBrowser(
  roomId: string,
  body: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; code: string }> {
  let input;
  try {
    // Same options the route passes, so this really is the route's parse.
    input = parseCreateRoomRequest(body, { rankLadderLength: deadlineDashRanks.length });
  } catch (error) {
    return { ok: false, code: `CONTRACT:${(error as Error).message}` };
  }
  const result = await freshService(roomId).service.create({
    hostId: members[0],
    playerName: input.playerName,
    modeId: input.mode,
    capacity: input.capacity,
    characterId: input.characterId,
    customRules: input.rules,
    avatarUrl: null,
  });
  return result.ok ? { ok: true } : { ok: false, code: result.error.code };
}

/** Fills the room and starts the match, so `GameState.rules` actually exists. */
async function startMatch(roomId: string): Promise<GameState | null> {
  const { service } = freshService(roomId);
  await service.join({ roomId, actorId: members[1], playerName: "Second" });
  await service.join({ roomId, actorId: members[2], playerName: "Third" });
  const started = await service.start({
    roomId,
    actorId: members[0],
    actorKind: "human",
    commandId: `${roomId}-start`,
  });
  if (!started.ok) {
    bad(`start ${roomId}`, started.error);
    return null;
  }
  return started.value.game;
}

/** The handful of levers that decide whether two matches actually play differently. */
function fingerprint(rules: ModeRules): Record<string, unknown> {
  return {
    winShape: rules.winShape,
    quarters: `${rules.quarters.count}x${rules.quarters.roundsEach}`,
    upkeep: rules.economy.upkeepEnabled,
    loans: rules.economy.loansEnabled,
    ownership: rules.board.ownershipEnabled,
    placements: rules.board.placementsEnabled,
    projects: rules.projects.enabled,
    attacks: rules.conflict.targetedAttacks,
    heat: rules.conflict.heatEnabled,
    elimination: rules.conflict.elimination,
    diceAdjust: rules.agency.diceAdjustEnabled,
    hand: rules.agency.handEnabled,
    reactions: rules.interaction.reactionWindows,
    votes: rules.interaction.votesEnabled,
    trades: rules.interaction.tradesEnabled,
    roles: rules.hidden.rolesEnabled,
    hiddenHands: rules.hidden.hiddenHands,
    chat: rules.social.chat,
    turnSeconds: rules.timers.turnSeconds,
  };
}

const roomIds: string[] = [];

try {
  for (const id of members) {
    await sql`
      insert into "user" (id, name, email, email_verified, created_at, updated_at)
      values (${id}, ${id}, ${`${id}@example.invalid`}, false, now(), now())`;
  }

  // ── 1. Every shipped preset, created the way the lobby creates one ──────────
  console.log(`\n=== 1. Create + start a room in each of ${ROOM_MODES.length} presets ===`);
  const started = new Map<RoomMode, ModeRules>();

  for (const [index, mode] of ROOM_MODES.entries()) {
    const roomId = `${roomIdPrefix}-${index}`;
    roomIds.push(roomId);

    const created = await createAsBrowser(roomId, {
      mode,
      capacity: 3,
      playerName: "Host",
    });
    if (!created.ok) {
      bad(`create ${mode}`, created);
      continue;
    }
    if ((await startMatch(roomId)) === null) continue;

    // Read back through a repository that has never seen this room.
    const reloaded = await freshService(roomId).repository.get(roomId);
    if (reloaded?.game == null) {
      bad(`${mode} did not survive a restart`, reloaded);
      continue;
    }
    if (reloaded.modeId !== mode) {
      // The exact downgrade `normalizeMode` used to perform on any id outside
      // ROOM_MODES: the room comes back as Quick and nobody is told.
      bad(`${mode} came back from storage as a different mode`, reloaded.modeId);
      continue;
    }

    started.set(mode, reloaded.game.rules);
    same(`${mode} — GameState.rules matches its content preset`, reloaded.game.rules, deadlineDashModes[mode].rules);
    console.log(`      ${mode}: ${JSON.stringify(fingerprint(reloaded.game.rules))}`);
  }

  if (started.size !== ROOM_MODES.length) {
    bad("not every preset produced a started, reloadable match", [...started.keys()]);
  } else {
    ok("all four presets created, started and reloaded", [...started.keys()]);
  }

  // ── 2. Do they actually differ? ────────────────────────────────────────────
  console.log("\n=== 2. Four rooms that behave identically would mean the picker is decorative ===");
  const modes = [...started.keys()];
  for (let left = 0; left < modes.length; left += 1) {
    for (let right = left + 1; right < modes.length; right += 1) {
      const a = started.get(modes[left]!)!;
      const b = started.get(modes[right]!)!;
      const differing = Object.entries(fingerprint(a)).filter(
        ([key, value]) => canonical(value) !== canonical(fingerprint(b)[key]),
      );
      if (canonical(a) === canonical(b)) {
        bad(`${modes[left]} and ${modes[right]} snapshotted the same ruleset`, modes[right]);
      } else {
        ok(`${modes[left]} vs ${modes[right]} — differing levers`, differing.length);
      }
    }
  }

  // The specific claim the task names.
  const quick = started.get("mode.quick");
  const campaign = started.get("mode.campaign");
  if (quick !== undefined && campaign !== undefined) {
    const claim = {
      quickProjects: quick.projects.enabled,
      quickOwnership: quick.board.ownershipEnabled,
      campaignProjects: campaign.projects.enabled,
      campaignOwnership: campaign.board.ownershipEnabled,
    };
    if (
      quick.projects.enabled === false &&
      quick.board.ownershipEnabled === false &&
      campaign.projects.enabled &&
      campaign.board.ownershipEnabled
    ) {
      ok("quick has projects/ownership off where campaign has them on", claim);
    } else {
      bad("quick/campaign projects+ownership", claim);
    }
  }

  // ── 3. A custom ruleset is stored as submitted, not as the preset ──────────
  console.log("\n=== 3. A lobby-authored ruleset ===");
  const base = deadlineDashModes["mode.standard"].rules;
  const authored: ModeRules = {
    ...base,
    winShape: "race",
    quarters: { ...base.quarters, enabled: false },
    projects: { ...base.projects, enabled: false, sabotageable: false },
    board: { ...base.board, ownershipEnabled: false, placementsEnabled: false },
    timers: { ...base.timers, turnSeconds: 45 },
    social: { ...base.social, chat: "quick" },
  };
  const customRoomId = `${roomIdPrefix}-custom`;
  roomIds.push(customRoomId);

  const customCreated = await createAsBrowser(customRoomId, {
    mode: "mode.standard",
    capacity: 3,
    playerName: "Host",
    rules: JSON.parse(JSON.stringify(authored)),
  });
  if (!customCreated.ok) {
    bad("create with an authored ruleset", customCreated);
  } else {
    // The column, not just the projection blob.
    const [row] = await sql`select custom_rules from rooms where id = ${customRoomId}`;
    const stored = typeof row?.custom_rules === "string"
      ? JSON.parse(row.custom_rules)
      : row?.custom_rules;
    same("rooms.custom_rules holds what was submitted", stored, authored);

    const customGame = await startMatch(customRoomId);
    if (customGame !== null) {
      const reloaded = await freshService(customRoomId).repository.get(customRoomId);
      same("GameState.rules after restart is the authored ruleset", reloaded?.game?.rules, authored);
      if (canonical(reloaded?.game?.rules) === canonical(base)) {
        bad("the custom room started under mode.standard's preset instead", "identical to preset");
      } else {
        ok("the custom room did not fall back to its base preset", {
          authoredWinShape: authored.winShape,
          presetWinShape: base.winShape,
          stored: reloaded?.game?.rules.winShape,
          turnSeconds: reloaded?.game?.rules.timers.turnSeconds,
        });
      }
    }
  }

  // ── 4. Hostile rulesets, through the same door ─────────────────────────────
  console.log("\n=== 4. A hostile ruleset the client would never have sent ===");
  const hostiles: readonly (readonly [string, ModeRules])[] = [
    [
      "unbounded maxPipAdjust",
      { ...base, agency: { ...base.agency, maxPipAdjust: 99 } },
    ],
    [
      "negative interestBasisPoints",
      { ...base, economy: { ...base.economy, interestBasisPoints: -5_000 } },
    ],
    [
      "all-false winPaths",
      {
        ...base,
        winPaths: { promotion: false, wealth: false, influence: false, survival: false },
      },
    ],
    [
      "short upkeepByRankIndex",
      { ...base, economy: { ...base.economy, upkeepByRankIndex: [1, 2] } },
    ],
    ["zero turn clock", { ...base, timers: { ...base.timers, turnSeconds: 0 } }],
  ];

  for (const [label, rules] of hostiles) {
    const hostileRoomId = `${roomIdPrefix}-hostile-${label.replace(/[^a-z]+/gi, "")}`;
    roomIds.push(hostileRoomId);
    const refused = await createAsBrowser(hostileRoomId, {
      mode: "mode.standard",
      capacity: 3,
      playerName: "Host",
      rules: JSON.parse(JSON.stringify(rules)),
    });
    const [tally] = await sql`
      select count(*)::int as count from rooms where id = ${hostileRoomId}`;
    if (refused.ok) bad(`${label} was accepted`, refused);
    else if (tally?.count !== 0) bad(`${label} was refused but left a room row behind`, tally);
    else ok(`${label} refused`, refused.code.slice(0, 60));
  }

  // The same body minus the ruleset must still be fine — otherwise the refusals
  // above prove nothing about the ruleset.
  const controlRoomId = `${roomIdPrefix}-control`;
  roomIds.push(controlRoomId);
  const control = await createAsBrowser(controlRoomId, {
    mode: "mode.standard",
    capacity: 3,
    playerName: "Host",
  });
  if (control.ok) ok("the same body without `rules` is accepted");
  else bad("the control body was refused too", control);

  console.log(
    failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`,
  );
} finally {
  for (const roomId of roomIds) {
    await sql`delete from room_projections where room_id = ${roomId}`;
    await sql`delete from games where room_id = ${roomId}`;
    await sql`delete from rooms where id = ${roomId}`;
  }
  for (const id of members) await sql`delete from "user" where id = ${id}`;
  const [leftover] = await sql`
    select count(*)::int as count from rooms where id like ${`${roomIdPrefix}%`}`;
  console.log(`cleanup: rooms remaining with this run's prefix = ${leftover?.count ?? "?"}`);
  await sql.end();
}

if (failures > 0) process.exit(1);
