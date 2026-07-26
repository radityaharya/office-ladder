/**
 * **The bot-affordability oracle and the bot-only match harness.**
 *
 * Extracted from `bot-affordability.test.ts` so that the shipped property test
 * and the higher-volume sweep in `verify-bot-affordability-sweep.ts` share *one*
 * implementation. That is the same principle this code is about: the reported bug
 * was two consumers computing affordability two ways, and a sweep carrying its
 * own private copy of {@link asksOf} would reproduce that flaw one layer up.
 *
 * Nothing here imports vitest. A setup failure throws, so the harness behaves
 * identically under a test runner and under a plain `bun` script.
 */
import { toLegalActionSummary } from "@office-ladder/contracts";
import type { LegalActionSummary, RoomMode } from "@office-ladder/contracts";
import {
  createStableId,
  enumerateLegalActions,
  type GameState,
  type LegalAction,
} from "@office-ladder/engine";
import {
  createBotDriver,
  isBotDrainDefect,
  type BotDrainStop,
} from "../../src/rooms/bots/bot-driver";
import type { BotCommandSubmitter } from "../../src/rooms/bots/bot-command-submitter";
import { AUDIT_RELEASE_FINE } from "../../src/rooms/bots/bot-policy";
import type { BotCommandBody, BotDecision } from "../../src/rooms/bots/bot-policy";
import { readBotTable } from "../../src/rooms/bots/bot-view";
import type { BotTableView } from "../../src/rooms/bots/bot-view";
import { InMemoryRoomRepository } from "../../src/rooms/in-memory-repository";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import type { RoomRepository, StoredRoom } from "../../src/rooms/service/types";
import { botSubmitterFor } from "./bot-submitter";

/* ------------------------------------------------------------------ *
 * The shared affordability oracle
 * ------------------------------------------------------------------ */

/**
 * One resource the chosen command would spend, and the ceiling that bounds it.
 *
 * `asked` and `allowed` are both numbers even for the membership checks ("is
 * this card id one the enumerator offered"), so a violation always reads the
 * same way in a failure message and one assertion covers every arm.
 */
export type Ask = {
  /** What is being spent, and against which advertised ceiling. */
  readonly what: string;
  readonly asked: number;
  readonly allowed: number;
};

/**
 * Branches whose price exists only in the content pack.
 *
 * `project.start` is charged `definition.leadStakeMoney` and `attack.target` is
 * charged `vector.cost.amount` of `vector.cost.resource`. Neither figure is on
 * the `LegalAction` the enumerator produces, so neither reaches
 * `toLegalActionSummary` either — the UI cannot price these two controls any
 * more than the bot can. Recording that here rather than hand-rolling a second
 * copy of the content lookup inside a bot: a duplicated price is exactly the
 * kind of thing that goes quietly stale, which is the note bot-policy.ts already
 * makes about the `network` free action.
 */
export const PRICES_NOT_ADVERTISED = ["project.start", "attack.target"] as const;

function find<Type extends LegalAction["type"]>(
  actions: readonly LegalAction[],
  type: Type,
): Extract<LegalAction, { readonly type: Type }> | null {
  for (const action of actions) {
    if (action.type === type) return action as Extract<LegalAction, { readonly type: Type }>;
  }
  return null;
}

/**
 * What the transport would advertise for this action, given what the bot holds.
 *
 * The one call into contracts, deliberately kept to a single place: this is the
 * seam being asserted on — that the policy and the UI agree about what is
 * affordable — so it should be one line to re-point if that signature moves.
 */
export function advertise(
  action: LegalAction,
  table: BotTableView,
  rules: GameState["rules"],
): LegalActionSummary | null {
  return toLegalActionSummary(action, {
    rules,
    // Exactly the three balances `legalActionContext` in
    // rooms/service/projections.ts feeds it for a human viewer, read from the
    // bot's own view so both consumers are priced off the same numbers.
    spendable: {
      money: table.self.money,
      energy: table.self.energy,
      work: table.self.workCounter,
    },
    // A ballot with no terms is treated as sealed with a zero floor, which is
    // what contracts does for an unknown ballot anyway. `BotBallotView` cannot
    // carry a bid floor without also being able to carry a tally, and §7.2 says
    // it must not.
    ballots: [],
    // `BotAgreementView` prices an offer from the bot's own side and has no
    // item list, so the terms cannot be rebuilt faithfully here. Nothing is
    // lost: `agreement.respond` has no advertised ceiling — its affordability
    // arm below reads the bot's own view instead.
    agreements: [],
    otherPlayerIds: table.rivals.map((rival) => String(rival.playerId)),
  });
}

/** `asked` when the id was offered, and one more than `allowed` when it was not. */
function offered(what: string, present: boolean): Ask {
  return { what, asked: present ? 0 : 1, allowed: 0 };
}

/**
 * Everything the chosen command spends, and what bounds each part of it.
 *
 * **This switch is the point of the file.** Every arm names a resource and the
 * ceiling it is measured against; the `satisfies never` at the bottom means a
 * new bot command cannot be added without one. A branch that genuinely spends
 * nothing says so by returning `[]`, which is a claim a reviewer can check
 * rather than an omission nobody notices.
 */
export function asksOf(
  command: BotCommandBody,
  actions: readonly LegalAction[],
  table: BotTableView,
  rules: GameState["rules"],
): readonly Ask[] {
  const { self } = table;

  switch (command.type) {
    // Spend nothing the engine can refuse for want of a resource. Rolling,
    // passing a window, blocking a promotion and waving off a rung are all free
    // by construction — the first two are what stop a table being blocked, and
    // charging for them would make silence cheaper than answering.
    case "turn.roll":
    case "reaction.pass":
    case "management.block-promotion":
    case "promotion.decline":
      return [];

    // The audit fine is content-authored and read once by the policy itself, so
    // it is the one price this file quotes rather than reads off an
    // advertisement. `execution/agency.ts` refuses the release outright when
    // money is short.
    case "prompt.respond":
      return command.payload.optionId === "pay-fine"
        ? [{ what: "audit fine (money)", asked: AUDIT_RELEASE_FINE, allowed: self.money }]
        : [];

    case "audit.pay-fine":
      return [{ what: "audit fine (money)", asked: AUDIT_RELEASE_FINE, allowed: self.money }];

    case "reaction.play": {
      const action = find(actions, "reaction.play");
      const summary = action === null ? null : advertise(action, table, rules);
      if (summary === null || summary.type !== "reaction.play") return [];
      return [
        offered(
          "reaction.play card the enumerator offered",
          command.payload.cardId === null ||
            summary.cardIds.includes(command.payload.cardId),
        ),
        offered(
          "reaction.play ability the enumerator offered",
          command.payload.abilityId === null ||
            summary.abilityIds.includes(command.payload.abilityId),
        ),
      ];
    }

    case "ballot.cast": {
      const action = find(actions, "ballot.cast");
      const summary = action === null ? null : advertise(action, table, rules);
      if (summary === null || summary.type !== "ballot.cast") return [];
      if (summary.ballot.kind !== "auction") return [];
      const bid = typeof command.payload.value === "number" ? command.payload.value : 0;
      return [{ what: "auction bid (money)", asked: bid, allowed: summary.ballot.maxBid }];
    }

    // Priced from the bot's own view rather than from an advertisement: see the
    // note in `advertise` about why the offer's items cannot be rebuilt here.
    // Declining is always free, which is the whole reason a bot may decline.
    case "agreement.respond": {
      if (!command.payload.accept) return [];
      const offer = table.agreements.find(
        (candidate) => candidate.agreementId === command.payload.agreementId,
      );
      return offer === undefined
        ? []
        : [{ what: "accepted trade (money)", asked: offer.givesMoney, allowed: self.money }];
    }

    case "promotion.attempt": {
      const action = find(actions, "promotion.attempt");
      const summary = action === null ? null : advertise(action, table, rules);
      if (summary === null || summary.type !== "promotion.attempt") return [];
      return [{ what: "promotion cost (money)", asked: summary.cost, allowed: self.money }];
    }

    case "loan.take": {
      const action = find(actions, "loan.take");
      const summary = action === null ? null : advertise(action, table, rules);
      if (summary === null || summary.type !== "loan.take") return [];
      return [
        {
          what: "loan principal (mode's own cap)",
          asked: command.payload.principal,
          allowed: summary.maxPrincipal,
        },
      ];
    }

    case "loan.repay": {
      const action = find(actions, "loan.repay");
      const summary = action === null ? null : advertise(action, table, rules);
      if (summary === null || summary.type !== "loan.repay") return [];
      const loan = summary.loans.find(
        (candidate) => candidate.loanId === command.payload.loanId,
      );
      return [
        {
          what: "loan repayment (money)",
          asked: command.payload.amount,
          allowed: summary.maxAmount,
        },
        {
          what: "loan repayment (that loan's outstanding balance)",
          asked: command.payload.amount,
          allowed: loan?.outstanding ?? 0,
        },
      ];
    }

    // `work` spends energy at the mode's own rate; `rest` is free. `network` and
    // `scheme` are priced in content and the policy never chooses them — if it
    // ever does, this arm must learn their prices first.
    case "turn.action": {
      const action = find(actions, "turn.action");
      const verb = command.payload.action;
      const asks: Ask[] = [
        offered("free action the enumerator offered", action?.actions.includes(verb) ?? false),
      ];
      if (verb === "work") {
        asks.push({
          what: "free action (energy)",
          asked: table.freeActionEnergyCost,
          allowed: self.energy,
        });
      }
      return asks;
    }

    case "turn.adjust-roll": {
      const action = find(actions, "turn.adjust-roll");
      const summary = action === null ? null : advertise(action, table, rules);
      if (summary === null || summary.type !== "turn.adjust-roll") return [];
      return [
        {
          what: "roll adjustment (pips the actor's energy buys)",
          asked: Math.abs(command.payload.pips),
          allowed: summary.affordablePips,
        },
      ];
    }

    case "turn.play-card": {
      const action = find(actions, "turn.play-card");
      const summary = action === null ? null : advertise(action, table, rules);
      if (summary === null || summary.type !== "turn.play-card") return [];
      return [
        offered(
          "played card the enumerator offered",
          summary.cardIds.includes(command.payload.cardId),
        ),
      ];
    }

    case "turn.spend-token": {
      const action = find(actions, "turn.spend-token");
      const summary = action === null ? null : advertise(action, table, rules);
      if (summary === null || summary.type !== "turn.spend-token") return [];
      const token = summary.tokens.find(
        (candidate) => candidate.tokenId === command.payload.tokenId,
      );
      return [
        offered("spent token the enumerator offered", token !== undefined),
        {
          what: "token quantity (what the actor holds)",
          asked: command.payload.quantity,
          allowed: token?.maxQuantity ?? 0,
        },
      ];
    }

    case "turn.activate-character": {
      const action = find(actions, "turn.activate-character");
      return [
        offered(
          "character ability the enumerator offered",
          action?.abilityId === command.payload.abilityId,
        ),
      ];
    }

    case "tile.claim": {
      const action = find(actions, "tile.claim");
      const summary = action === null ? null : advertise(action, table, rules);
      if (summary === null || summary.type !== "tile.claim") return [];
      return [{ what: "tile claim (money)", asked: summary.cost, allowed: self.money }];
    }

    case "tile.upgrade": {
      const action = find(actions, "tile.upgrade");
      const summary = action === null ? null : advertise(action, table, rules);
      if (summary === null || summary.type !== "tile.upgrade") return [];
      return [{ what: "tile upgrade (money)", asked: summary.cost, allowed: self.money }];
    }

    case "placement.place": {
      const action = find(actions, "placement.place");
      const summary = action === null ? null : advertise(action, table, rules);
      if (summary === null || summary.type !== "placement.place") return [];
      const kind = summary.kinds.find((candidate) => candidate.kind === command.payload.kind);
      return [
        offered("placement kind the enumerator offered", kind !== undefined),
        {
          what: "placement (money)",
          asked: kind?.cost ?? Number.POSITIVE_INFINITY,
          allowed: self.money,
        },
      ];
    }

    // The lead stake is authored per project definition and is on neither the
    // legal action nor the summary — see PRICES_NOT_ADVERTISED. All that can be
    // checked here is that the bot did not invent a definition id.
    case "project.start": {
      const action = find(actions, "project.start");
      return [
        offered(
          "project definition the enumerator offered",
          action?.definitionIds.includes(command.payload.definitionId) ?? false,
        ),
      ];
    }

    // **The reported bug's own branch.** Money and work are checked
    // independently by `execution/projects.ts`, so offering work it does not
    // hold is refused even when the money half is affordable.
    case "project.contribute": {
      const action = find(actions, "project.contribute");
      const summary = action === null ? null : advertise(action, table, rules);
      if (summary === null || summary.type !== "project.contribute") return [];
      return [
        {
          what: "contribution (money)",
          asked: command.payload.money,
          allowed: summary.maxMoney,
        },
        {
          what: "contribution (work counter)",
          asked: command.payload.work,
          allowed: summary.maxWork,
        },
        {
          // The mirror image, and just as fatal: a contribution of nothing at
          // all is refused by the parser, so an empty offer is also a stall.
          what: "contribution below the minimum the parser accepts",
          asked: summary.minTotal,
          allowed: command.payload.money + command.payload.work,
        },
      ];
    }

    // Sabotage spends the work counter one for one, plus concealment money when
    // hidden. The policy never conceals, so the money half is zero.
    case "project.sabotage": {
      const action = find(actions, "project.sabotage");
      const summary = action === null ? null : advertise(action, table, rules);
      if (summary === null || summary.type !== "project.sabotage") return [];
      return [
        {
          what: "sabotage (work counter)",
          asked: command.payload.amount,
          allowed: summary.maxAmount,
        },
      ];
    }

    // The vector's cost is content-authored and advertised by nobody — see
    // PRICES_NOT_ADVERTISED. Membership is all that can be asserted from here.
    case "attack.target": {
      const action = find(actions, "attack.target");
      const summary = action === null ? null : advertise(action, table, rules);
      if (summary === null || summary.type !== "attack.target") return [];
      return [
        offered(
          "attack target the enumerator offered",
          summary.targetPlayerIds.includes(String(command.payload.targetPlayerId)),
        ),
        offered(
          "attack vector the enumerator offered",
          summary.vectors.includes(command.payload.vector),
        ),
      ];
    }

    default:
      // A new bot command with no arm above stops the build here. That is the
      // whole mechanism by which a seventh unchecked branch cannot ship.
      command satisfies never;
      return [];
  }
}

/** The asks this command cannot cover, formatted for a failure message. */
export function overdrafts(
  command: BotCommandBody,
  actions: readonly LegalAction[],
  table: BotTableView,
  rules: GameState["rules"],
): readonly string[] {
  return asksOf(command, actions, table, rules)
    .filter((ask) => ask.asked > ask.allowed)
    .map((ask) => `${command.type}: ${ask.what} — asked ${ask.asked}, has ${ask.allowed}`);
}
/* ------------------------------------------------------------------ *
 * The property run — bot-only matches, every preset, many seeds
 * ------------------------------------------------------------------ */

export const host = createStableId("PlayerId", "user-host");

/**
 * Seeds, not randomness. A property test that generated its own inputs would
 * fail on a different match every run, and "a bot-only match stalled" without a
 * reproduction is not a bug report. Each of these names one deterministic match
 * per mode; a failure names the seed, so it can be replayed exactly.
 */
export const SEEDS = ["seed-alpha", "seed-bravo", "seed-charlie", "seed-delta"] as const;

/**
 * Drains per match.
 *
 * A bot-only table never hands the turn to a human, so a drain runs until the
 * driver's own `MAX_ACTIONS_PER_DRAIN` (120) trips rather than until a seat
 * changes hands: each pass here is a page of 120 commands, not a rules cycle,
 * and `action-cap` is the *expected* stop mid-match. Sixteen pages is ~1,900
 * commands, which is a whole `mode.quick` match and roughly ten rounds of the
 * longer presets.
 *
 * The budget is not what proves a match is healthy — {@link MatchOutcome.wedge}
 * is. "Every match reaches a winner" is the property the brief asks for and is
 * the right property, but it is not affordable here: a bot-only match under the
 * three project-enabled presets was measured still running after 9,600 commands,
 * because promotion costs there are far higher than `mode.quick`'s and nothing in
 * this process advances the quarter clock, so the only ending available is
 * reaching Director. Sixteen matches at that length is minutes of unit-test wall
 * clock. So this file asserts the sharper half of termination — the match never
 * *stops making progress* — and the whole-match version stays where it already
 * lives, in bot-driver.ts's own end-to-end test.
 */
export const MAX_DRIVES = 16;

export type MatchOutcome = {
  readonly modeId: RoomMode;
  readonly seed: string;
  readonly drives: number;
  readonly ended: boolean;
  /**
   * The `MatchEndReason` the match ended on, or `null` if it never ended.
   *
   * Distinguishes "the budget ran out" from "the rules produced an ending", which
   * is the whole question when asking whether a preset can terminate at all.
   */
  readonly endReason: string | null;
  /** The round the match reached, so a wedge can be read against real progress. */
  readonly round: number;
  /**
   * Set when a drive committed nothing at all while the match was still active.
   *
   * That is what a stalled match *is*, and it is strictly stronger than "did not
   * finish": a bot holds the turn, nobody else may act, and every subsequent kick
   * re-derives the same decision from the same state and gets nowhere. Naming the
   * drive it froze on and the stop that froze it is the difference between a
   * report somebody can act on and "a bot-only match stalled".
   */
  readonly wedge: string | null;
  /** Every stop the driver reported, in order. */
  readonly stops: readonly BotDrainStop[];
  /** Decision slugs actually committed, so a vacuous pass is visible. */
  readonly decisions: readonly BotDecision["kind"][];
  /** Affordability violations seen at submit time, already formatted. */
  readonly overdrafts: readonly string[];
  readonly projectsEnabled: boolean;
};

/**
 * Knobs the shipped property test leaves alone and the sweep turns up.
 *
 * Both default to what the test suite ships with, so a caller that passes
 * nothing gets exactly the run `bot-affordability.test.ts` asserts on.
 */
export type PlayMatchOptions = {
  /**
   * The store to play against. Defaults to `InMemoryRoomRepository`, which is the
   * production-faithful choice — it round-trips every write through the engine's
   * own `serializeGameState` contract exactly as Postgres does.
   *
   * Overridable for one reason: when a bug *in that serializer* rejects a state
   * the engine legitimately produced, every write past that point fails and the
   * bot policy can no longer be observed at all. Substituting a store that skips
   * the validation isolates the policy from a defect that is not its own. It is
   * strictly a diagnostic: a green run against such a store says nothing about
   * whether the room could actually be persisted.
   */
  readonly repository?: () => RoomRepository;
  readonly maxDrives?: number;
};

/**
 * One match with **every seat driven by the policy**.
 *
 * The host is a human member the room service required at creation, and is then
 * recorded as a bot seat as well, which is all `botSeatFor` consults. Without
 * that the harness would need a scripted human, and a scripted human is a second
 * policy — one whose choices decide which branches the bots ever see. A table
 * with no humans on it is also the only way to get many matches per second.
 *
 * The submitter is wrapped rather than the policy called directly: every command
 * still goes through the real transport, and the affordability oracle sees
 * exactly the state the driver decided against (asserted by the revision check).
 */
export async function playBotOnlyMatch(
  modeId: RoomMode,
  seed: string,
  options: PlayMatchOptions = {},
): Promise<MatchOutcome> {
  const roomId = `room-affordability-${modeId}-${seed}`;
  const repository = options.repository?.() ?? new InMemoryRoomRepository();
  const maxDrives = options.maxDrives ?? MAX_DRIVES;
  const stops: BotDrainStop[] = [];
  const decisions: BotDecision["kind"][] = [];
  const violations: string[] = [];

  const service = createRoomService({
    repository,
    now: () => "2026-07-26T12:00:00.000Z",
    ids: {
      roomId: () => roomId,
      roomCode: () => "AFF123",
      gameId: () => createStableId("GameId", `game-${roomId}`),
      commandId: () => createStableId("CommandId", `command-${roomId}`),
    },
    gameSeed: () => seed,
    // No clock: the turn-timeout driver is another test's subject, and an armed
    // deadline here would inject commands this file did not ask for.
    turnTimeoutMs: 0,
  });

  const submit = botSubmitterFor(service, repository);
  const checkedSubmit: BotCommandSubmitter = async (submission) => {
    const room = await repository.get(submission.roomId);
    const game = room?.game ?? null;
    // Same revision the driver decided against — single-threaded here, so a
    // mismatch would mean the harness is checking a different state than the one
    // that produced the command, which is worth skipping rather than reporting.
    if (game !== null && game.revision === submission.expectedRevision) {
      const table = readBotTable(game, submission.actorId);
      if (table !== null) {
        violations.push(
          ...overdrafts(
            submission.command,
            enumerateLegalActions(game, submission.actorId),
            table,
            game.rules,
          ).map((line) => `${modeId}/${seed} ${submission.actorId}: ${line}`),
        );
      }
    }
    return submit(submission);
  };

  const driver = createBotDriver({
    submit: checkedSubmit,
    repository,
    configuredDelayMs: 0,
    sleep: async () => undefined,
    publish: async () => undefined,
    onEvent: (event) => {
      if (event.type === "bot.drain.finished") stops.push(event.stop);
      if (event.type === "bot.command.applied") decisions.push(event.decision);
    },
  });

  await service.create({ hostId: host, playerName: "Host", modeId, capacity: 4 });
  // Mixed difficulties on purpose: `ruthless` is the only one that ever reaches
  // the aggression rung, so a table of `standard` seats would never exercise it.
  for (const difficulty of ["standard", "ruthless", "easy"] as const) {
    const added = await service.addBot({ roomId, actorId: host, difficulty });
    // Thrown rather than asserted: this is harness setup, not the subject. A
    // seat that failed to join would silently shrink the table and quietly
    // narrow which branches the run can ever reach, so it has to be loud.
    if (!added.ok) throw new Error(`${modeId}/${seed}: addBot failed: ${added.error.code}`);
  }
  const started = await service.start({ roomId, actorId: host, actorKind: "human" });
  if (!started.ok) throw new Error(`${modeId}/${seed}: start failed: ${started.error.code}`);
  if (started.value.status !== "active") {
    throw new Error(`${modeId}/${seed}: started room is ${started.value.status}, not active`);
  }

  const seated = await repository.get(roomId);
  if (seated === null || seated.game === null) throw new Error("the started room vanished");
  const projectsEnabled = seated.game.rules.projects.enabled;
  await repository.save(
    {
      ...seated,
      bots: [...seated.bots, { playerId: host, difficulty: "standard" }],
    } satisfies StoredRoom,
    seated.revision,
  );

  let drives = 0;
  let ended = false;
  let round = 0;
  let endReason: string | null = null;
  let wedge: string | null = null;
  while (drives < maxDrives) {
    const current = await repository.get(roomId);
    if (current?.game == null || current.game.status !== "active") {
      ended = true;
      // Recorded rather than inferred: "the match ended" and "the match ended
      // the way the mode intends" are different claims, and only the second one
      // says the ruleset actually has a reachable ending under bot play.
      endReason = current?.game?.outcome?.reason ?? null;
      break;
    }
    round = current.game.turn.round;
    const before = current.game.revision;
    await driver.drive(roomId);
    drives += 1;

    const after = await repository.get(roomId);
    const advanced = (after?.game?.revision ?? before) > before;
    const stillRunning = after?.game != null && after.game.status === "active";
    if (stillRunning && !advanced) {
      wedge =
        `${modeId}/${seed} froze at drive ${drives} (round ${round}) ` +
        `stop=${describeStop(stops.at(-1))}`;
      break;
    }
    // Stop at the first real defect rather than grinding out the rest of the
    // budget: the drain re-derives the same decision from the same state every
    // pass, so continuing would only reprint one bug sixteen times.
    if (stops.some((stop) => isBotDrainDefect(stop) && stop.kind !== "action-cap")) break;
  }

  return {
    modeId,
    seed,
    drives,
    ended,
    endReason,
    round,
    wedge,
    stops,
    decisions,
    overdrafts: violations,
    projectsEnabled,
  };
}

/** A stop as one field-per-fact string, mirroring bot-driver-log.ts's own shape. */
export function describeStop(stop: BotDrainStop | undefined): string {
  if (stop === undefined) return "none";
  if (stop.kind !== "command-rejected") return stop.kind;
  return `command-rejected decision=${stop.decision} code=${stop.code} expected=${stop.expected}`;
}

/** "mode/seed decision=… code=…" — the three things a stall report has to name. */
export function describeRejection(outcome: MatchOutcome, stop: BotDrainStop): string {
  return `${outcome.modeId}/${outcome.seed} ${describeStop(stop)} player=${
    stop.kind === "command-rejected" ? String(stop.playerId) : "n/a"
  }`;
}
