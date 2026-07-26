import { describe, expect, it } from "vitest";

import { applyCommand } from "../src";
import type {
  AgreementId,
  CommandId,
  GameState,
  ObjectiveId,
  PlayerId,
  PlayerState,
  ProjectId,
  ResourceChangedEvent,
  ResourceId,
  StatusId,
} from "../src";
import { resolveNextTurn, skipEliminatedNextTurn } from "../src/execution/next-turn";
import { fixtureIds } from "./fixtures";
import {
  accepted,
  context,
  rejected,
  rollCommand,
  rollState,
  withRules,
} from "./turn-loop-fixtures";

const brand = <Id extends string>(value: string) => value as Id;

/**
 * The canonical fixture with a table every seat can actually play from.
 *
 * The base fixture is built for the *projection* tests: two of its three seats
 * carry no money resource at all and one starts owing a skipped turn, which is
 * fine when nothing rolls but makes every seat except the owner unable to
 * resolve salary. Nothing here changes a rule — it fills in the resources a
 * seated player is supposed to have — and it is deliberately explicit so a test
 * below that turns a knob is turning that knob and nothing else.
 */
function readyState(position: number): GameState {
  const base = rollState(position);
  const players = Object.fromEntries(
    base.playerOrder.map((playerId, index) => {
      const player = seat(base, playerId);

      return [
        playerId,
        {
          ...player,
          skipTurns: 0,
          statuses: [],
          position: playerId === fixtureIds.owner ? position : player.position,
          resources: {
            ...player.resources,
            money: {
              id: brand<ResourceId>(`resource-${index}-money`),
              kind: "resource.money" as const,
              value: player.resources["money"]?.value ?? 1_000,
              minimum: 0,
              maximum: null,
            },
            reputation: {
              id: brand<ResourceId>(`resource-${index}-reputation`),
              kind: "resource.reputation" as const,
              value: player.resources["reputation"]?.value ?? 0,
              minimum: 0,
              maximum: null,
            },
            energy: {
              id: brand<ResourceId>(`resource-${index}-energy`),
              kind: "resource.energy" as const,
              value: 5,
              minimum: 0,
              maximum: 5,
            },
          },
        },
      ];
    }),
  );

  return { ...base, players: players as GameState["players"] };
}

/**
 * Hand the turn to `playerId`, keeping the phase rollable.
 *
 * The fixture seats owner / hiddenOpponent / revealedOpponent in that order, and
 * the round counter only advances when the hand-off wraps past seat zero. Every
 * round-boundary hook below therefore has to be driven from the **last** seat —
 * driving it from the first would test the same code path with the boundary
 * never firing, which is exactly the mistake this helper exists to prevent.
 */
function handTurnTo(state: GameState, playerId: PlayerId): GameState {
  return {
    ...state,
    turn: { ...state.turn, activePlayerId: playerId, phase: "pre-roll" },
  };
}

function seat(state: GameState, playerId: PlayerId): PlayerState {
  const player = state.players[playerId];
  if (player === undefined) throw new Error(`fixture missing player ${playerId}`);

  return player;
}

function withPlayer(
  state: GameState,
  playerId: PlayerId,
  patch: (player: PlayerState) => PlayerState,
): GameState {
  return {
    ...state,
    players: { ...state.players, [playerId]: patch(seat(state, playerId)) },
  };
}

function money(state: GameState, playerId: PlayerId): number {
  return seat(state, playerId).resources["money"]?.value ?? 0;
}

function withMoney(state: GameState, playerId: PlayerId, value: number): GameState {
  return withPlayer(state, playerId, (player) => {
    const wallet = player.resources["money"];
    if (wallet === undefined) throw new Error("fixture player has no money resource");

    return { ...player, resources: { ...player.resources, money: { ...wallet, value } } };
  });
}

function reasons(events: readonly { readonly type: string; readonly payload: unknown }[]): string[] {
  return events
    .filter((event) => event.type === "ResourceChanged")
    .map((event) => (event.payload as ResourceChangedEvent["payload"]).reason);
}

/** The command a seat other than the owner submits, so ids stay distinct. */
function rollAs(state: GameState, actorId: PlayerId, commandId: string) {
  return rollCommand(state, { actorId, commandId: brand<CommandId>(commandId) });
}

describe("the turn loop wires every per-turn hook in order", () => {
  describe("step 3 — the roll agency seam", () => {
    it("Given pips already bought with turn.adjust-roll, When the player rolls, Then the die is shifted and the charge is consumed", () => {
      const start = readyState(0);
      const withPips = withPlayer(start, fixtureIds.owner, (player) => ({
        ...player,
        statuses: [
          {
            id: brand<StatusId>("status.roll-adjustment"),
            sourceId: null,
            stacks: 1,
            remainingTurns: null,
            expiresAtRound: null,
            visibility: "private" as const,
            data: { pips: 2 },
          },
        ],
      }));

      // die = 1, so an unshifted roll lands on index 1.
      const { state: next, events } = accepted(
        applyCommand(withPips, rollCommand(withPips), context([0])),
      );

      expect(seat(next, fixtureIds.owner).position).toBe(3);
      const moved = events.find((event) => event.type === "PlayerMoved");
      expect(moved?.payload).toMatchObject({ from: 0, to: 3, distance: 3 });
      // The pips were paid for on an earlier command; they must not linger and
      // shift the next roll as well.
      expect(seat(next, fixtureIds.owner).statuses).toEqual([]);
    });

    it("Given no agency status at all, When the player rolls, Then the die is exactly what the dice stream produced", () => {
      const start = readyState(0);

      const { state: next } = accepted(applyCommand(start, rollCommand(start), context([0])));

      expect(seat(next, fixtureIds.owner).position).toBe(1);
    });
  });

  describe("step 6 — landing triggers", () => {
    /** A state where the tile one space ahead of the owner belongs to an opponent. */
    function ownedAhead(overrides: { readonly landerMoney: number }): GameState {
      const base = readyState(0);
      const tileId = base.tileIds[1];
      if (tileId === undefined) throw new Error("fixture board is too small");

      return withMoney(
        {
          ...withRules(base, {
            board: { ownershipEnabled: true, tollMultiplier: 1 },
          }),
          tileOwnership: {
            [tileId]: {
              tileId,
              ownerId: fixtureIds.revealedOpponent,
              level: 1,
              claimedAtRound: 1,
              tollPaidCount: 0,
            },
          },
        },
        fixtureIds.owner,
        overrides.landerMoney,
      );
    }

    it("Given a tile owned by another player, When someone lands on it, Then the toll moves and is reported", () => {
      const state = ownedAhead({ landerMoney: 1000 });
      const ownerBefore = money(state, fixtureIds.revealedOpponent);

      const { state: next, events } = accepted(
        applyCommand(state, rollCommand(state), context([0])),
      );

      expect(money(next, fixtureIds.owner)).toBeLessThan(1000);
      expect(money(next, fixtureIds.revealedOpponent)).toBeGreaterThan(ownerBefore);
      expect(reasons(events)).toContain("tile-toll");
      expect(reasons(events)).toContain("tile-toll-received");
    });

    it("Given ownership is switched off in the ruleset, When someone lands on the same owned tile, Then nothing is charged", () => {
      const state = withRules(ownedAhead({ landerMoney: 1000 }), {
        board: { ownershipEnabled: false },
      });

      const { state: next, events } = accepted(
        applyCommand(state, rollCommand(state), context([0])),
      );

      expect(money(next, fixtureIds.owner)).toBe(1000);
      expect(reasons(events)).not.toContain("tile-toll");
    });

    it("Given a lander with nothing in the wallet, When they land on an owned tile, Then the toll takes what is there and no more", () => {
      const state = ownedAhead({ landerMoney: 0 });
      const ownerBefore = money(state, fixtureIds.revealedOpponent);

      const { state: next } = accepted(applyCommand(state, rollCommand(state), context([0])));

      expect(money(next, fixtureIds.owner)).toBe(0);
      expect(money(next, fixtureIds.revealedOpponent)).toBe(ownerBefore);
    });
  });

  describe("step 8 — the promotion decision is mode-driven", () => {
    /** The owner one promotion away from Director, with the price in hand. */
    function promotable(state: GameState): GameState {
      return withPlayer(state, fixtureIds.owner, (player) => ({
        ...player,
        rank: { ...player.rank, kind: "rank.general-manager" },
        resources: {
          ...player.resources,
          money: { ...player.resources["money"], value: 999_999 } as PlayerState["resources"][string],
          reputation: {
            id: brand<ResourceId>("resource-owner-reputation"),
            kind: "resource.reputation",
            value: 999,
            minimum: 0,
            maximum: null,
          },
        },
      }));
    }

    it("Given a ruleset where promotion is the player's own decision, When they roll onto an affordable promotion, Then nothing promotes them behind their back", () => {
      const state = withRules(promotable(readyState(0)), {
        agency: { promotionIsChoice: true },
      });

      const { state: next, events } = accepted(
        applyCommand(state, rollCommand(state), context([0.2])),
      );

      expect(events.some((event) => event.type === "PlayerPromoted")).toBe(false);
      expect(seat(next, fixtureIds.owner).rank.kind).toBe("rank.general-manager");
      expect(next.status).toBe("active");
    });

    it("Given a ruleset where promotion is automatic, When the same player rolls, Then they climb and the match ends", () => {
      const state = withRules(promotable(readyState(0)), {
        agency: { promotionIsChoice: false },
      });

      const { state: next, events } = accepted(
        applyCommand(state, rollCommand(state), context([0.2])),
      );

      expect(events.some((event) => event.type === "PlayerPromoted")).toBe(true);
      expect(next.status).toBe("ended");
      expect(next.outcome?.reason).toBe("director-reached");
    });

    it("Given automatic promotion and a scoring ruleset, When the race is won, Then the outcome carries a real score sheet", () => {
      const state = withRules(promotable(readyState(0)), {
        agency: { promotionIsChoice: false },
      });

      const { state: next } = accepted(applyCommand(state, rollCommand(state), context([0.2])));

      expect(next.outcome?.winPath).toBe("promotion");
      expect(next.outcome?.scores.map((score) => score.playerId)).toEqual(next.playerOrder);
    });

    /**
     * The table inside a quarter whose resolved global event is the budget
     * freeze: promotions blocked, salary halved. Read from the *resolved* event,
     * so an announcement alone is inert.
     */
    function inBudgetFreeze(state: GameState): GameState {
      return {
        ...withRules(state, {
          quarters: { enabled: true, count: 2, roundsEach: 4, globalEvents: true },
        }),
        currentQuarterIndex: 0,
        quarters: [
          {
            index: 0,
            startedAtRound: 1,
            endsAtRound: 4,
            scheduledEventId: "globalEvent.budget-freeze",
            resolvedEventIds: ["globalEvent.budget-freeze"],
          },
          {
            index: 1,
            startedAtRound: 5,
            endsAtRound: 8,
            scheduledEventId: null,
            resolvedEventIds: [],
          },
        ],
      };
    }

    it("Given a quarter whose resolved event blocks promotions, When an otherwise-automatic climb comes due, Then it is held until the quarter passes", () => {
      const state = inBudgetFreeze(
        withRules(promotable(readyState(0)), { agency: { promotionIsChoice: false } }),
      );

      const { state: next, events } = accepted(
        applyCommand(state, rollCommand(state), context([0.2])),
      );

      expect(events.some((event) => event.type === "PlayerPromoted")).toBe(false);
      expect(next.status).toBe("active");
    });

    it("Given the same quarter only *announced* rather than resolved, When the climb comes due, Then the warning does not block it", () => {
      const announced = inBudgetFreeze(
        withRules(promotable(readyState(0)), { agency: { promotionIsChoice: false } }),
      );
      const state: GameState = {
        ...announced,
        quarters: announced.quarters.map((quarter) =>
          quarter.index === 0 ? { ...quarter, resolvedEventIds: [] } : quarter,
        ),
      };

      const { events } = accepted(applyCommand(state, rollCommand(state), context([0.2])));

      expect(events.some((event) => event.type === "PlayerPromoted")).toBe(true);
    });

    it("Given a quarter that halves salary, When the receptionist is passed, Then the award is scaled", () => {
      const base = readyState(rollState(0).boardSize - 1);
      const plain = accepted(applyCommand(base, rollCommand(base), context([0])));
      const frozen = accepted(
        applyCommand(inBudgetFreeze(base), rollCommand(base), context([0])),
      );

      const salaryOf = (events: readonly { readonly type: string; readonly payload: unknown }[]) =>
        (events.find((event) => event.type === "SalaryAwarded")?.payload as { amount: number })
          .amount;

      expect(salaryOf(frozen.events)).toBe(Math.round(salaryOf(plain.events) * 0.5));
    });

    it("Given automatic promotion under a ruleset that raises upkeep with rank, When a player climbs, Then their standing bill follows the new rank", () => {
      const ladder = [0, 10, 20, 30, 40, 50, 60, 70];
      const state = withRules(
        withPlayer(readyState(0), fixtureIds.owner, (player) => ({
          ...player,
          upkeep: { perRound: ladder[1] ?? 0, lastChargedRound: 1, missedPayments: 0 },
          resources: {
            ...player.resources,
            money: { ...player.resources["money"], value: 999_999 } as PlayerState["resources"][string],
            reputation: {
              id: brand<ResourceId>("resource-owner-reputation"),
              kind: "resource.reputation",
              value: 999,
              minimum: 0,
              maximum: null,
            },
          },
        })),
        {
          agency: { promotionIsChoice: false, promotionRaisesUpkeep: true },
          economy: { upkeepEnabled: true, upkeepByRankIndex: ladder },
        },
      );

      const { state: next } = accepted(applyCommand(state, rollCommand(state), context([0.2])));

      expect(seat(next, fixtureIds.owner).rank.index).toBe(2);
      expect(seat(next, fixtureIds.owner).upkeep.perRound).toBe(ladder[2]);
    });
  });

  describe("steps 10-14 — the round boundary", () => {
    /**
     * A turn held by the last seat, so the hand-off wraps and the round moves
     * from 1 to 2. Everything in this block depends on that.
     */
    function atBoundary(state: GameState): GameState {
      return handTurnTo(state, fixtureIds.revealedOpponent);
    }

    function rollBoundary(state: GameState, commandId = "roll-boundary") {
      return accepted(
        applyCommand(
          state,
          rollAs(state, fixtureIds.revealedOpponent, commandId),
          context([0]),
        ),
      );
    }

    it("Given the hand-off wraps the table, When the last seat rolls, Then the round advances", () => {
      const { state: next } = rollBoundary(atBoundary(readyState(0)));

      expect(next.turn.round).toBe(2);
      expect(next.turn.activePlayerId).toBe(fixtureIds.owner);
    });

    describe("step 13 — the economy", () => {
      const ladder = [5, 5, 5, 5, 5, 5, 5, 5];

      function withUpkeep(state: GameState): GameState {
        const enabled = withRules(atBoundary(state), {
          economy: { upkeepEnabled: true, upkeepByRankIndex: ladder },
        });

        return {
          ...enabled,
          players: Object.fromEntries(
            Object.entries(enabled.players).map(([id, player]) => [
              id,
              {
                ...player,
                upkeep: { perRound: 5, lastChargedRound: 1, missedPayments: 0 },
                resources: {
                  ...player.resources,
                  money: { ...player.resources["money"], value: 500 },
                },
              },
            ]),
          ) as GameState["players"],
        };
      }

      it("Given upkeep is enabled, When the round advances, Then every seat is charged exactly once", () => {
        const { state: next, events } = rollBoundary(withUpkeep(readyState(0)));

        for (const playerId of next.playerOrder) {
          expect(seat(next, playerId).upkeep.lastChargedRound).toBe(2);
        }
        expect(reasons(events).filter((reason) => reason === "upkeep")).toHaveLength(3);
      });

      it("Given the same round is settled again, When another turn is taken inside it, Then nothing is charged twice", () => {
        const { state: afterBoundary } = rollBoundary(withUpkeep(readyState(0)));
        const balances = afterBoundary.playerOrder.map((id) => money(afterBoundary, id));

        // The owner now rolls; the round does not move, so the watermark holds.
        const { state: next, events } = accepted(
          applyCommand(
            afterBoundary,
            rollCommand(afterBoundary, { commandId: brand<CommandId>("roll-same-round") }),
            context([0]),
          ),
        );

        expect(next.turn.round).toBe(2);
        expect(reasons(events)).not.toContain("upkeep");
        expect(next.playerOrder.map((id) => money(next, id))).toEqual(balances);
      });

      it("Given the whole economy is switched off, When the round advances, Then nothing is settled at all", () => {
        const state = withRules(withUpkeep(readyState(0)), {
          economy: { upkeepEnabled: false, loansEnabled: false, incomeStreamsEnabled: false },
        });

        const { state: next, events } = rollBoundary(state);

        expect(reasons(events)).not.toContain("upkeep");
        expect(seat(next, fixtureIds.owner).upkeep.lastChargedRound).toBe(1);
      });

      it("Given a seat that cannot pay and a ruleset that eliminates, When the round advances, Then they are eliminated and never handed the turn", () => {
        const broke = {
          ...withRules(withUpkeep(readyState(0)), {
            economy: { bankruptcy: "eliminate" },
          }),
        };
        const state = withMoney(broke, fixtureIds.owner, 0);

        const { state: next } = rollBoundary(state);

        expect(next.eliminatedPlayerIds).toContain(fixtureIds.owner);
        expect(next.turn.activePlayerId).not.toBe(fixtureIds.owner);
      });
    });

    describe("step 10 — project deadlines", () => {
      function withDueProject(state: GameState): GameState {
        const projectId = brand<ProjectId>("project-due");

        return {
          ...withRules(atBoundary(state), { projects: { enabled: true } }),
          projects: [
            {
              id: projectId,
              definitionId: "project.quarterly-report",
              leadPlayerId: fixtureIds.owner,
              tileId: null,
              status: "open",
              requiredMoney: 100,
              requiredWork: 0,
              contributions: [],
              sabotage: [],
              deadlineRound: 1,
              payout: { money: 0, reputation: 0, objectiveProgress: 0 },
              openToJoin: true,
              leadBonusBasisPoints: 0,
            },
          ],
        };
      }

      it("Given a project whose deadline has passed, When the round advances, Then it is settled", () => {
        const { state: next } = rollBoundary(withDueProject(readyState(0)));

        expect(next.projects[0]?.status).not.toBe("open");
      });

      it("Given the same state rolled inside the round, When the deadline has not passed, Then the project is still live", () => {
        const state = withDueProject(readyState(0));
        const later = {
          ...state,
          projects: state.projects.map((project) => ({ ...project, deadlineRound: 9 })),
        };

        const { state: next } = rollBoundary(later);

        expect(next.projects[0]?.status).toBe("open");
      });
    });

    describe("step 11 — the quarter boundary", () => {
      function withQuarters(state: GameState): GameState {
        return {
          ...withRules(atBoundary(state), {
            quarters: { enabled: true, count: 3, roundsEach: 1, globalEvents: true },
          }),
          modeId: brand<GameState["modeId"]>("mode.standard"),
          currentQuarterIndex: 0,
          quarters: [
            { index: 0, startedAtRound: 1, endsAtRound: 1, scheduledEventId: null, resolvedEventIds: [] },
            { index: 1, startedAtRound: 2, endsAtRound: 2, scheduledEventId: null, resolvedEventIds: [] },
            { index: 2, startedAtRound: 3, endsAtRound: 3, scheduledEventId: null, resolvedEventIds: [] },
          ],
        };
      }

      it("Given a quarter that ends this round, When the round advances, Then the track moves on exactly one step and announces the next", () => {
        const { state: next } = rollBoundary(withQuarters(readyState(0)));

        // One step, never two: quarter 1 arrives and resolves its own event, and
        // quarter 2's is *announced* rather than resolved. A track that wrote the
        // whole rotation up front would satisfy the type and defeat the rule.
        expect(next.currentQuarterIndex).toBe(1);
        expect(next.quarters[1]?.resolvedEventIds).toHaveLength(1);
        expect(next.quarters[2]?.scheduledEventId).not.toBeNull();
        expect(next.quarters[2]?.resolvedEventIds).toEqual([]);
      });

      it("Given quarters are switched off in the ruleset, When the round advances, Then the track never moves", () => {
        const state = withRules(withQuarters(readyState(0)), {
          quarters: { enabled: false },
        });

        const { state: next } = rollBoundary(state);

        expect(next.currentQuarterIndex).toBe(0);
      });
    });

    describe("step 12 — agreement expiry", () => {
      it("Given an offer that expired with the round, When the round advances, Then it is swept", () => {
        const base = atBoundary(readyState(0));
        const state: GameState = {
          ...base,
          agreements: [
            {
              id: brand<AgreementId>("agreement-stale"),
              proposerId: fixtureIds.owner,
              recipientIds: [fixtureIds.hiddenOpponent],
              give: [{ kind: "promise", text: "i will not sabotage you" }],
              receive: [],
              status: "offered",
              offeredAtRound: 1,
              expiresAtRound: 1,
              acceptedBy: [],
              visibility: "public",
            },
          ],
        };

        const { state: next } = rollBoundary(state);

        expect(next.agreements[0]?.status).toBe("expired");
      });
    });

    describe("step 14 — objectives", () => {
      function withObjective(state: GameState, target: number): GameState {
        return {
          ...withRules(atBoundary(state), {
            winShape: "objectives",
            winPaths: { promotion: false, wealth: true, influence: false, survival: false },
          }),
          objectives: [
            {
              id: brand<ObjectiveId>("objective-under-test"),
              definitionId: "objective.reserve-fund",
              ownerId: fixtureIds.owner,
              progress: 0,
              target,
              completedAtRound: null,
              visibility: "public",
              rewardPoints: 3,
              rewardMoney: 0,
            },
          ],
        };
      }

      it("Given an objective already met, When the round advances, Then it completes on that round", () => {
        const state = withMoney(withObjective(readyState(0), 100), fixtureIds.owner, 5_000);

        const { state: next } = rollBoundary(state);

        expect(next.objectives[0]?.completedAtRound).toBe(2);
      });

      it("Given an objective far out of reach, When the round advances, Then it only records progress", () => {
        const state = withMoney(withObjective(readyState(0), 1_000_000), fixtureIds.owner, 5_000);

        const { state: next } = rollBoundary(state);

        expect(next.objectives[0]?.completedAtRound).toBeNull();
        expect(next.objectives[0]?.progress).toBe(5_000);
      });
    });

    describe("step 15 — the win check", () => {
      it("Given the last quarter has elapsed, When the round advances past it, Then the match ends on the clock", () => {
        const base = atBoundary(readyState(0));
        const state: GameState = {
          ...withRules(base, {
            winShape: "fixed-length",
            quarters: { enabled: true, count: 1, roundsEach: 1, globalEvents: false },
          }),
          currentQuarterIndex: 0,
          quarters: [
            { index: 0, startedAtRound: 1, endsAtRound: 1, scheduledEventId: null, resolvedEventIds: [] },
          ],
        };

        const { state: next, events } = rollBoundary(state);

        expect(next.status).toBe("ended");
        expect(next.outcome?.reason).toBe("quarters-elapsed");
        expect(events.some((event) => event.type === "MatchEnded")).toBe(true);
      });

      it("Given the clock decks are empty, When a turn is taken, Then the match ends and the exhaustion is reported", () => {
        const base = atBoundary(readyState(0));
        const emptyDeck = (id: string) => ({
          id: brand<GameState["decks"][string]["id"]>(id),
          kind: null,
          drawPile: [],
          discardPile: [],
          visibleCards: [],
          reshufflesWhenEmpty: false,
          managementShuffleEligible: false,
          shuffleCount: 0,
        });
        const state: GameState = {
          ...base,
          modeId: brand<GameState["modeId"]>("mode.quick"),
          decks: {
            "deck.meeting": emptyDeck("deck.meeting"),
            "deck.event": emptyDeck("deck.event"),
          },
        };

        const { state: next, events } = rollBoundary(state);

        expect(events.some((event) => event.type === "ClockDeckExhausted")).toBe(true);
        expect(next.status).toBe("ended");
        expect(next.outcome?.reason).toBe("clock-deck-exhausted");
      });

      it("Given a mode that names no clock decks, When the same empty deck map is rolled against, Then nothing ends", () => {
        const base = atBoundary(readyState(0));
        const state: GameState = { ...base, decks: {} };

        const { state: next, events } = rollBoundary(state);

        expect(events.some((event) => event.type === "ClockDeckExhausted")).toBe(false);
        expect(next.status).toBe("active");
      });
    });
  });

  describe("authorisation and idempotency at the boundary", () => {
    it("Given a player who is not the active seat, When they roll, Then the command is refused and no round-boundary hook runs", () => {
      const ladder = [5, 5, 5, 5, 5, 5, 5, 5];
      const state = withRules(handTurnTo(readyState(0), fixtureIds.revealedOpponent), {
        economy: { upkeepEnabled: true, upkeepByRankIndex: ladder },
      });

      // The owner is not the active seat. Nothing may be settled on their say-so.
      rejected(
        applyCommand(state, rollCommand(state), context([0])),
        "NOT_ACTOR_TURN",
      );
    });

    it("Given an ended match, When another roll arrives, Then it is refused rather than settling another round", () => {
      const state = withRules(
        withPlayer(readyState(0), fixtureIds.owner, (player) => ({
          ...player,
          rank: { ...player.rank, kind: "rank.general-manager" },
          resources: {
            ...player.resources,
            money: { ...player.resources["money"], value: 999_999 },
            reputation: {
              id: brand<ResourceId>("resource-owner-reputation"),
              kind: "resource.reputation",
              value: 999,
              minimum: 0,
              maximum: null,
            },
          },
        })),
        { agency: { promotionIsChoice: false } },
      );
      const { state: ended } = accepted(applyCommand(state, rollCommand(state), context([0.2])));
      const stillSeated = ended.turn.activePlayerId;
      if (stillSeated === null) throw new Error("expected a seated player after the match ended");

      rejected(
        applyCommand(
          ended,
          rollAs(ended, stillSeated, "roll-after-end"),
          context([0.2]),
        ),
        "GAME_ALREADY_ENDED",
      );
    });
  });

  describe("existing behaviour that must not regress", () => {
    it("Given a roll that crosses the receptionist, When it resolves, Then the salary is still awarded", () => {
      const state = readyState(rollState(0).boardSize - 1);

      const { events } = accepted(applyCommand(state, rollCommand(state), context([0])));

      expect(events.some((event) => event.type === "SalaryAwarded")).toBe(true);
      expect(reasons(events)).toContain("salary");
    });

    it("Given a plain roll with no agency, When it resolves, Then the persisted dice cursor advances by exactly one", () => {
      const state = readyState(0);

      const { state: next } = accepted(applyCommand(state, rollCommand(state), context([0])));

      expect(next.rng.streams["dice"]?.cursor).toBe((state.rng.streams["dice"]?.cursor ?? 0) + 1);
    });

    it("Given a player carrying skipTurns, When the turn is handed on, Then they are still passed over", () => {
      const state = withPlayer(readyState(0), fixtureIds.hiddenOpponent, (player) => ({
        ...player,
        skipTurns: 1,
      }));

      const { state: next } = accepted(applyCommand(state, rollCommand(state), context([0])));

      expect(next.turn.activePlayerId).toBe(fixtureIds.revealedOpponent);
      expect(seat(next, fixtureIds.hiddenOpponent).skipTurns).toBe(0);
    });
  });

  describe("determinism", () => {
    it("Given a turn resolved with every boundary hook live, When the state is round-tripped through JSON, Then it comes back identical", () => {
      const ladder = [5, 5, 5, 5, 5, 5, 5, 5];
      const state = withRules(handTurnTo(readyState(0), fixtureIds.revealedOpponent), {
        economy: { upkeepEnabled: true, upkeepByRankIndex: ladder },
        board: { ownershipEnabled: true },
        projects: { enabled: true },
        interaction: { tradesEnabled: true, promisesRecorded: true },
      });

      const { state: next } = accepted(
        applyCommand(state, rollAs(state, fixtureIds.revealedOpponent, "roll-json"), context([0])),
      );

      expect(JSON.parse(JSON.stringify(next))).toEqual(next);
    });

    it("Given the same state and the same command, When it is applied twice independently, Then both runs agree", () => {
      const state = withRules(handTurnTo(readyState(0), fixtureIds.revealedOpponent), {
        economy: { upkeepEnabled: true, upkeepByRankIndex: [5, 5, 5, 5, 5, 5, 5, 5] },
      });

      const first = accepted(
        applyCommand(state, rollAs(state, fixtureIds.revealedOpponent, "roll-twice"), context([0])),
      );
      const second = accepted(
        applyCommand(state, rollAs(state, fixtureIds.revealedOpponent, "roll-twice"), context([0])),
      );

      expect(first.state).toEqual(second.state);
      expect(first.events).toEqual(second.events);
    });
  });
});

describe("resolveNextTurn skips eliminated seats", () => {
  it("Given a seat eliminated on an earlier turn, When the turn is handed on, Then it is passed over without paying off its skip debt", () => {
    const base = readyState(0);
    const state: GameState = {
      ...withPlayer(base, fixtureIds.hiddenOpponent, (player) => ({ ...player, skipTurns: 2 })),
      eliminatedPlayerIds: [fixtureIds.hiddenOpponent],
    };

    const resolution = resolveNextTurn(
      state,
      0,
      false,
      fixtureIds.owner,
      seat(state, fixtureIds.owner),
    );

    expect(resolution.nextPlayerId).toBe(fixtureIds.revealedOpponent);
    // An eliminated player is not serving a penalty; forgiving their debt here
    // would silently pay off something they will never owe again.
    expect(resolution.players[fixtureIds.hiddenOpponent]?.skipTurns).toBe(2);
  });

  it("Given nobody is eliminated, When the turn is handed on, Then the walk is exactly what it always was", () => {
    const state = readyState(0);

    const resolution = resolveNextTurn(
      state,
      0,
      false,
      fixtureIds.owner,
      seat(state, fixtureIds.owner),
    );

    expect(resolution.nextPlayerId).toBe(fixtureIds.hiddenOpponent);
  });

  it("Given the seat a hand-off just chose was eliminated by that same hand-off, When the correction runs, Then the turn moves on without re-walking", () => {
    const state = readyState(0);
    const resolution = resolveNextTurn(
      state,
      0,
      false,
      fixtureIds.owner,
      seat(state, fixtureIds.owner),
    );

    const corrected = skipEliminatedNextTurn(state, resolution, [fixtureIds.hiddenOpponent]);

    expect(corrected.nextPlayerId).toBe(fixtureIds.revealedOpponent);
    expect(corrected.round).toBe(resolution.round);
    expect(corrected.players).toBe(resolution.players);
  });

  it("Given nobody was eliminated by the hand-off, When the correction runs, Then it returns the resolution untouched", () => {
    const state = readyState(0);
    const resolution = resolveNextTurn(
      state,
      0,
      false,
      fixtureIds.owner,
      seat(state, fixtureIds.owner),
    );

    expect(skipEliminatedNextTurn(state, resolution, [])).toBe(resolution);
  });

  it("Given the correction has to lap the table, When it wraps past seat zero, Then the round advances with it", () => {
    const state = readyState(0);
    const resolution = resolveNextTurn(
      state,
      1,
      false,
      fixtureIds.hiddenOpponent,
      seat(state, fixtureIds.hiddenOpponent),
    );
    expect(resolution.nextPlayerId).toBe(fixtureIds.revealedOpponent);

    const corrected = skipEliminatedNextTurn(state, resolution, [fixtureIds.revealedOpponent]);

    expect(corrected.nextPlayerId).toBe(fixtureIds.owner);
    expect(corrected.round).toBe(resolution.round + 1);
  });
});
