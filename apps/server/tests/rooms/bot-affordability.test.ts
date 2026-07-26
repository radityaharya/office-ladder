/**
 * **What a bot asks for, against what it actually holds — every branch at once.**
 *
 * ### The bug this file is the answer to
 *
 * A live match stalled on:
 *
 * ```text
 * bot.drain.finished actions=0 stop=command-rejected decision=contribute
 *   code=INSUFFICIENT_RESOURCE expected=false
 * ```
 *
 * The `project.contribute` branch offered one unit of work whenever a project
 * still wanted work, without ever checking the bot held any — `BotSelfView` did
 * not even expose the work counter. The engine refused the command, the driver
 * classified the refusal as *unexpected*, and an unexpected refusal **stops the
 * drain**. A stopped drain is not one bot missing one turn: nobody may act on
 * another seat's turn, so the match is frozen for every seat at the table,
 * humans included, until something else kicks the room — and the next kick
 * re-derives the same decision and stops again.
 *
 * ### Why the existing tests did not catch it, which is the actual lesson
 *
 * `bot-driver.test.ts` already plays a match to a winner and asserts no defect
 * is ever reported. It passed throughout. Three reasons, and each one is a rule
 * about how this file had to be written:
 *
 * 1. **It plays one scripted match.** A stall only happens when the policy
 *    actually picks the unaffordable branch, which needs a particular board
 *    position, a particular resource level and a particular rival standing. One
 *    seed reaches one such sequence.
 * 2. **It plays `mode.quick` only.** Quick switches projects *and* board
 *    ownership off entirely (`rules.projects.enabled: false`,
 *    `rules.board.ownershipEnabled: false`), so `project.contribute` is never
 *    even enumerated there. The branch that stalled production **cannot be
 *    reached in the mode the existing tests use.** That, precisely, is why this
 *    shipped.
 * 3. **It asserts an outcome, not an invariant.** "A winner is declared" is a
 *    property of a run; "the bot never asks for what it does not hold" is a
 *    property of the *policy*, and only the second one generalises to the branch
 *    nobody has written a scenario for yet.
 *
 * ### The class, not the instance
 *
 * The engine carries nineteen `INSUFFICIENT_RESOURCE` guards. Six of the policy's
 * eight resource-spending branches performed no self-resource check at all
 * (`project.start`, `project.sabotage`, `attack.target`, `placement.place`,
 * `loan.repay`, `turn.adjust-roll`); only `tile.claim` and `tile.upgrade` did.
 * Every one of them is the same latent stall waiting for the policy to pick it.
 * And it has happened before — bot-view.ts still carries the note that "a bot
 * that picked `work` with no energy had its command rejected", fixed the same
 * way, by adding one field for one branch.
 *
 * So the design flaw is not any one missing check. It is that the policy
 * **re-derives affordability by hand, per branch, from a view that may not even
 * expose the relevant resource** — while `toLegalActionSummary` in
 * `packages/contracts/src/legal-actions.ts` already computes exactly these
 * ceilings for the UI (`maxMoney`, `maxWork`, `maxAmount`, `affordablePips`,
 * every placement kind's cost) under an explicit tighten-only rule. Two
 * consumers, two implementations, one of them wrong.
 *
 * ### What this file therefore does — two layers, on purpose
 *
 * - {@link asksOf} states, in **one exhaustive switch over every command a bot
 *   can emit**, what that command spends and which advertised ceiling bounds it.
 *   The ceilings come from `toLegalActionSummary` — the UI's implementation,
 *   reused rather than restated, so the two consumers are checked against one
 *   answer. The exhaustiveness is the guarantee that *a seventh branch cannot
 *   ship*: adding a member to `BotCommandBody` without saying what it spends is
 *   a compile error on the `satisfies never` at the bottom of that switch, not a
 *   test that quietly keeps passing.
 * - The property run plays **bot-only matches across every mode preset and many
 *   seeds**, asserting the invariant that actually matters — no drain ever
 *   finishes `command-rejected` with `expected: false` — and pushes every real
 *   decision through {@link asksOf} on the way to the engine. An unexpected
 *   rejection is a policy bug by definition: the policy chose something the
 *   engine refuses.
 *
 * Two prices are visible to *neither* consumer and so cannot be checked by
 * either layer: `project.start`'s `definition.leadStakeMoney` and
 * `attack.target`'s `vector.cost`. Both live in content, and neither the
 * enumerator nor the summary carries them — see PRICES_NOT_ADVERTISED below.
 * Those two branches are covered only empirically, by the property run.
 */
import { describe, expect, it } from "vitest";

import { ROOM_MODES } from "@office-ladder/contracts";
import { createStableId, type GameState, type LegalAction } from "@office-ladder/engine";
import { isBotDrainDefect } from "../../src/rooms/bots/bot-driver";
import { decideBotAction } from "../../src/rooms/bots/bot-policy";
import type { BotSelfView, BotTableView } from "../../src/rooms/bots/bot-view";
import {
  advertise,
  describeRejection,
  overdrafts,
  playBotOnlyMatch,
  PRICES_NOT_ADVERTISED,
  SEEDS,
  type MatchOutcome,
} from "./bot-affordability-harness";


const matches: MatchOutcome[] = [];

describe("bot policy — no branch may ask for what the bot does not hold", () => {
  it(
    "Given bot-only matches on every mode preset and every seed, When they are played out, Then no drain is ever stopped by a rejection the policy did not expect",
    async () => {
      for (const modeId of ROOM_MODES) {
        for (const seed of SEEDS) {
          matches.push(await playBotOnlyMatch(modeId, seed));
        }
      }

      // An unexpected rejection means the drain stopped on something nobody
      // planned for, which stalls the table whatever produced it. Usually that is
      // the policy choosing a command the engine refuses; it can also be the
      // write side refusing a command the engine *accepted* (a snapshot that
      // cannot be persisted is `SERIALIZATION_FAILED`, and the room wedges just as
      // hard). Hence the message names the decision slug, the rejection code and
      // the mode: the code is what says whose bug it is, and a stalled bot-only
      // match without those three is not actionable.
      const unexpected = matches.flatMap((outcome) =>
        outcome.stops
          .filter((stop) => stop.kind === "command-rejected" && !stop.expected)
          .map((stop) => describeRejection(outcome, stop)),
      );
      expect(unexpected).toEqual([]);
    },
    // Sixteen matches of up to ~1,900 commands each. Wide enough that a slow
    // machine does not turn a green suite red.
    180_000,
  );

  it("Given the same matrix, When a bot's command reaches the transport, Then every resource it asks for is within the ceiling the transport itself advertises", () => {
    expect(matches.length).toBeGreaterThan(0);
    // The same defect the rejection assertion catches, caught one layer earlier
    // and priced by the UI's own implementation rather than by a second copy of
    // it. A branch whose price is advertised to nobody cannot be checked here:
    // see PRICES_NOT_ADVERTISED.
    expect(matches.flatMap((outcome) => outcome.overdrafts)).toEqual([]);
  });

  it("Given the same matrix, When each match is played out, Then no match ever freezes — every drive either moves the game on or ends it", () => {
    // The version of "it terminates" that a unit test can afford and that a
    // stalled match actually fails: a drive that commits nothing while the match
    // is still active is a table nobody can move, and every later kick will
    // re-derive the same decision and get equally nowhere.
    expect(matches.flatMap((outcome) => (outcome.wedge === null ? [] : [outcome.wedge]))).toEqual(
      [],
    );
  });

  it("Given the same matrix, When the whole run is counted, Then at least one match reached a real ending, so the harness can produce one", () => {
    // Guards the assertion above from being satisfied by a harness that never
    // gets anywhere: a run where nothing can ever end would report no wedges and
    // prove nothing. `mode.quick` finishes inside this budget; the longer presets
    // are not expected to, and their termination is bot-driver.ts's own test.
    const ended = matches.filter((outcome) => outcome.ended);
    expect(ended.length).toBeGreaterThan(0);
    // And every match must have got past the opening: a first round that produced
    // no rounds at all would make the branch coverage below meaningless.
    expect(matches.every((outcome) => outcome.round > 0 || outcome.ended)).toBe(true);
  });

  it("Given the same matrix, When defects other than the paging cap are counted, Then there are none", () => {
    // `action-cap` is excluded deliberately and only here: on a table with no
    // human to hand the turn to, it means "there was still work to do", not "the
    // rules cycled". Every other defect stop — a bot that cannot decide, a seat
    // the game does not know, a room with no game — keeps its production
    // severity, which is what `isBotDrainDefect` is for.
    const defects = matches.flatMap((outcome) =>
      outcome.stops
        .filter((stop) => isBotDrainDefect(stop) && stop.kind !== "action-cap")
        .map((stop) => describeRejection(outcome, stop)),
    );
    expect(defects).toEqual([]);
  });

  it("Given the matrix, When the presets are compared, Then it really did play modes where projects and ownership exist — the ones mode.quick cannot reach", () => {
    // The guard against a vacuous pass. The reported stall was in
    // `project.contribute`, which `mode.quick` never enumerates, so a matrix
    // that silently played quick four times would prove nothing while looking
    // exactly like this one. Asserted on the rules the matches were actually
    // started with, not on what the presets say today.
    const withProjects = new Set(
      matches.filter((outcome) => outcome.projectsEnabled).map((outcome) => outcome.modeId),
    );
    expect(withProjects.size).toBeGreaterThanOrEqual(ROOM_MODES.length - 1);
    expect(withProjects.has("mode.quick")).toBe(false);
    // And it has to have got far enough to make real decisions, not just rolled.
    const slugs = new Set(matches.flatMap((outcome) => outcome.decisions));
    expect(slugs.size).toBeGreaterThan(1);
  });
});

/* ------------------------------------------------------------------ *
 * The six branches, stated directly
 * ------------------------------------------------------------------ */

const bot = createStableId("PlayerId", "bot:room-affordability:0");
const leader = createStableId("PlayerId", "user-leader");
const projectId = createStableId("ProjectId", "project-1");
const base = {
  gameId: createStableId("GameId", "game-affordability"),
  actorId: bot,
  expectedRevision: 3,
} as const;

/**
 * A destitute bot: no money, no work counter, no energy, no heat headroom.
 *
 * Every field is stated rather than defaulted, because the whole question here
 * is what the policy does when it holds *nothing* — a fixture that quietly
 * seeded a resource would make each of these tests pass for the wrong reason.
 */
function brokeTable(overrides: Partial<BotSelfView> = {}): BotTableView {
  return {
    self: {
      playerId: bot,
      money: 0,
      energy: 0,
      energyMaximum: 8,
      workCounter: 0,
      reputation: 0,
      rankIndex: 0,
      heat: 0,
      heatThreshold: 3,
      upkeepPerRound: 0,
      outstandingDebt: 0,
      inAudit: false,
      handSize: 0,
      pendingRollPips: 0,
      ...overrides,
    },
    rivals: [{ playerId: leader, rankIndex: 3, money: 9_000, reputation: 30 }],
    round: 4,
    leaderId: leader,
    reactionWindows: [],
    ballots: [],
    agreements: [],
    projects: [
      {
        projectId: String(projectId),
        leadPlayerId: bot,
        isOwn: true,
        outstandingMoney: 500,
        outstandingWork: 4,
      },
    ],
    canNegotiate: true,
    heatEnabled: true,
    freeActionEnergyCost: 1,
  };
}

const roll: LegalAction = { ...base, type: "turn.roll", payload: {} };

/**
 * A ruleset that constrains nothing, so the destitute tests above measure the
 * policy rather than a mode's caps. Only the fields `toLegalActionSummary`
 * reads are meaningful; the rest are the neutral values a disabled subsystem
 * carries in every shipped preset.
 */
const PERMISSIVE_RULES = {
  agency: { maxPipAdjust: 6, energyPerPip: 2 },
  conflict: { heatEnabled: true, heatPerAttack: 1 },
  economy: { maxLoanPrincipal: 5_000, interestBasisPoints: 0 },
  interaction: { promisesRecorded: false },
} as unknown as GameState["rules"];

/**
 * The six branches that performed no self-resource check, each offered to a bot
 * that holds nothing, plus the two that always did.
 *
 * Table-driven rather than eight separate tests so the *set* is the assertion:
 * an action type added to the policy with no row here is visible as an absence
 * in one place. The expectation is uniform and deliberately weak about strategy
 * — the bot may take the branch or leave it — and absolute about solvency: it
 * may not ask for what it does not have.
 */
const DESTITUTE_BRANCHES: readonly {
  readonly name: string;
  readonly action: LegalAction;
  readonly table?: BotTableView;
}[] = [
  {
    name: "project.contribute — the reported stall",
    action: { ...base, type: "project.contribute", projectIds: [projectId] },
  },
  {
    name: "project.sabotage",
    action: { ...base, type: "project.sabotage", projectIds: [projectId] },
    table: {
      ...brokeTable(),
      projects: [
        {
          projectId: String(projectId),
          leadPlayerId: leader,
          isOwn: false,
          outstandingMoney: 500,
          outstandingWork: 4,
        },
      ],
    },
  },
  {
    name: "project.start",
    action: { ...base, type: "project.start", definitionIds: ["project.definition.audit"] },
  },
  {
    name: "placement.place",
    action: {
      ...base,
      type: "placement.place",
      kinds: [{ kind: "placement.sabotage", cost: 250 }],
    },
  },
  {
    name: "tile.claim",
    action: { ...base, type: "tile.claim", tileId: createStableId("TileId", "tile-4"), cost: 400 },
  },
  {
    name: "tile.upgrade",
    action: {
      ...base,
      type: "tile.upgrade",
      tileId: createStableId("TileId", "tile-4"),
      level: 2,
      cost: 400,
    },
  },
  {
    name: "loan.repay",
    action: {
      ...base,
      type: "loan.repay",
      loans: [{ loanId: createStableId("LoanId", "loan-1"), outstanding: 900 }],
    },
    table: brokeTable({ outstandingDebt: 900 }),
  },
  {
    name: "turn.adjust-roll",
    action: { ...base, type: "turn.adjust-roll", maxPips: 3, energyPerPip: 2 },
  },
  {
    name: "attack.target",
    action: {
      ...base,
      type: "attack.target",
      targetPlayerIds: [leader],
      vectors: ["vector.smear"],
    },
  },
];

describe("decideBotAction — a bot that holds nothing", () => {
  for (const branch of DESTITUTE_BRANCHES) {
    for (const difficulty of ["easy", "standard", "ruthless"] as const) {
      it(`Given a ${difficulty} bot with no money, work or energy, When ${branch.name} is legal, Then it never offers more than it holds`, () => {
        const table = branch.table ?? brokeTable();
        const legalActions = [roll, branch.action];
        const decision = decideBotAction({ legalActions, difficulty, table });
        if (decision.kind === "none") return;

        // `rules` is only read for the mode-level ceilings the summary applies
        // (pip caps, heat, loan caps); the resource halves come from the table.
        expect(
          overdrafts(decision.command, legalActions, table, PERMISSIVE_RULES),
        ).toEqual([]);
      });
    }
  }

  it("Given a bot leading a project that still wants work, When it holds no work counter, Then it offers none", () => {
    const table = brokeTable({ money: 10_000 });
    const decision = decideBotAction({
      legalActions: [
        roll,
        { ...base, type: "project.contribute", projectIds: [projectId] },
      ],
      difficulty: "standard",
      table,
    });

    if (decision.kind === "contribute") {
      expect(decision.command).toMatchObject({
        type: "project.contribute",
        payload: { work: 0 },
      });
    }
  });

  it("Given the same project, When the bot does hold work, Then it contributes some of it", () => {
    // The mirror of the test above, and the reason the fixtures default to zero:
    // a policy that simply hardcoded `work: 0` would pass the regression and
    // still be wrong, so the opt-in case has to be asserted too.
    const table = brokeTable({ money: 10_000, workCounter: 3 });
    const decision = decideBotAction({
      legalActions: [
        roll,
        { ...base, type: "project.contribute", projectIds: [projectId] },
      ],
      difficulty: "standard",
      table,
    });

    expect(decision.kind).toBe("contribute");
    if (decision.kind !== "contribute") return;
    expect(decision.command).toMatchObject({ type: "project.contribute" });
    if (decision.command.type !== "project.contribute") return;
    expect(decision.command.payload.work).toBeGreaterThan(0);
    expect(decision.command.payload.work).toBeLessThanOrEqual(table.self.workCounter);
  });

  it("Given project.start and attack.target, When the transport describes them, Then it still advertises no price at all — which is exactly why neither consumer can check them", () => {
    // Not a note: an assertion about what contracts carries today. Both of these
    // are charged from the content pack (`definition.leadStakeMoney`,
    // `vector.cost`), and the enumerator carries neither figure, so the summary
    // cannot either — the UI is as blind to these two prices as the bot is. If
    // that ever changes, this fails, and the arms above should start checking
    // them instead of only asserting the bot did not invent an id.
    const table = brokeTable();
    const start = advertise(
      { ...base, type: "project.start", definitionIds: ["project.definition.audit"] },
      table,
      PERMISSIVE_RULES,
    );
    const attackAt = advertise(
      { ...base, type: "attack.target", targetPlayerIds: [leader], vectors: ["vector.smear"] },
      table,
      PERMISSIVE_RULES,
    );

    expect(start === null ? [] : Object.keys(start).sort()).toEqual([
      "definitionIds",
      "expectedRevision",
      "type",
    ]);
    expect(attackAt === null ? [] : Object.keys(attackAt).sort()).toEqual([
      // `heatCost` is what the attack *adds* to the actor, not what it spends —
      // the vector's own cost, the thing that can be refused, is absent.
      "expectedRevision",
      "heatCost",
      "targetPlayerIds",
      "type",
      "vectors",
    ]);
    expect([...PRICES_NOT_ADVERTISED]).toEqual(["project.start", "attack.target"]);
  });
});
