import { describe, expect, it } from "vitest";

import { deadlineDashContent } from "@office-ladder/content";
import type { DeckCard, EffectDescriptor } from "@office-ladder/content";

import type { PlayerId, PlayerState, ResourceId, RoleId, CharacterId, RankId } from "../src";
import {
  applyCardStatuses,
  applyStatusEffect,
  cancelMoneyLoss,
  CARD_STATUS_IDS,
  findActiveStatus,
  promotionReputationDiscount,
} from "../src/execution/player-status";

const brand = <Id extends string>(value: string) => value as Id;

/**
 * A bare player. Only `resources` and `statuses` matter to this module, but the
 * whole shape is built so the tests type against real `PlayerState` rather than
 * a structural stand-in that could drift from the model.
 */
function player(): PlayerState {
  const resource = (key: "money" | "reputation" | "energy" | "work-counter", value: number) => ({
    id: brand<ResourceId>(`resource-${key}`),
    kind: `resource.${key}` as const,
    value,
    minimum: 0,
    maximum: key === "energy" ? 8 : null,
  });

  return {
    id: brand<PlayerId>("player-status-subject"),
    order: 0,
    connected: true,
    position: 0,
    lapsCompleted: 0,
    rank: { id: brand<RankId>("rank-intern"), kind: "rank.intern", index: 0 },
    role: { id: brand<RoleId>("role-worker"), kind: "role.worker", revealed: false },
    characterId: brand<CharacterId>("character.workaholic"),
    resources: {
      money: resource("money", 100),
      reputation: resource("reputation", 2),
      energy: resource("energy", 5),
      "work-counter": resource("work-counter", 0),
    },
    tokens: {},
    hand: [],
    statuses: [],
    abilities: [],
    skipTurns: 0,
    inAudit: false,
    negativeEffectsIgnoredThisLap: 0,
    upkeep: { perRound: 0, lastChargedRound: 0, missedPayments: 0 },
    loans: [],
    incomeStreams: [],
    heat: { value: 0, threshold: 6, investigationsOpened: 0, lastIncrementedAtRound: null },
  };
}

function holding(
  statusId: string,
  parameters?: Readonly<Record<string, number | string | boolean>>,
): PlayerState {
  return applyStatusEffect(player(), {
    statusId,
    duration: { kind: "uses", count: 1 },
    parameters,
  });
}

/** The authored `applyStatus` effect on a real card, so the tests bind to the pack. */
function authoredStatus(cardId: string): {
  readonly statusId: string;
  readonly parameters: Readonly<Record<string, number | string | boolean>> | undefined;
} {
  for (const deck of deadlineDashContent.decks) {
    for (const card of deck.cards as readonly DeckCard[]) {
      if (card.id !== cardId) continue;
      for (const effect of card.effects) {
        if (effect.type !== "applyStatus") continue;

        return { statusId: effect.statusId, parameters: effect.parameters };
      }
    }
  }

  throw new Error(`no applyStatus effect authored on ${cardId}`);
}

const gainMoney = (amount: number): EffectDescriptor => ({
  type: "modifyResource",
  resource: "money",
  amount,
  clampAtZero: true,
});

const gainReputation = (amount: number): EffectDescriptor => ({
  type: "modifyResource",
  resource: "reputation",
  amount,
  clampAtZero: true,
});

const loseEnergy = (amount: number): EffectDescriptor => ({
  type: "modifyResource",
  resource: "energy",
  amount: -amount,
  clampAtZero: true,
});

const workCounter: EffectDescriptor = {
  type: "incrementWorkCounter",
  amount: 1,
  rewardEvery: 5,
  reward: { resource: "reputation", amount: 1 },
  cumulative: true,
};

describe("card statuses the pack applies", () => {
  it("Given every card status id, When the pack is searched, Then each one is actually authored on a card", () => {
    const applied = new Set<string>();
    for (const deck of deadlineDashContent.decks) {
      for (const card of deck.cards as readonly DeckCard[]) {
        for (const effect of card.effects) {
          if (effect.type === "applyStatus") applied.add(effect.statusId);
        }
      }
    }

    // The point of the whole module: these seven were applied by the pack and
    // read by nothing. A consumer that no card can reach is as dead as a status
    // no consumer can read.
    for (const statusId of Object.values(CARD_STATUS_IDS)) {
      expect(applied.has(statusId)).toBe(true);
    }
  });
});

describe("status.next-work-card-money-multiplier", () => {
  it("Given the doubling copy authored on card.work.project-template, When the next work card pays, Then the award doubles and the status is spent", () => {
    const authored = authoredStatus("card.work.project-template");
    expect(authored.statusId).toBe(CARD_STATUS_IDS.workCardMoneyMultiplier);

    const held = applyStatusEffect(player(), {
      statusId: authored.statusId,
      duration: { kind: "uses", count: 1 },
      parameters: authored.parameters,
    });
    const outcome = applyCardStatuses(held, "deck.work", [gainMoney(150), workCounter]);

    expect(outcome.effects).toEqual([gainMoney(300), workCounter]);
    expect(outcome.consumedStatusIds).toEqual([CARD_STATUS_IDS.workCardMoneyMultiplier]);
    expect(outcome.player.statuses).toEqual([]);
  });

  it("Given the x0 copy, When the next work card pays, Then the award is zeroed rather than negated", () => {
    const authored = authoredStatus("card.work.rework-required");
    expect(authored.statusId).toBe(CARD_STATUS_IDS.workCardMoneyMultiplier);

    const held = applyStatusEffect(player(), {
      statusId: authored.statusId,
      duration: { kind: "uses", count: 1 },
      parameters: authored.parameters,
    });
    const outcome = applyCardStatuses(held, "deck.work", [gainMoney(200)]);

    expect(outcome.effects).toEqual([gainMoney(0)]);
    expect(outcome.player.statuses).toEqual([]);
  });

  it("Given a work card that costs money, When the multiplier fires, Then only the award is scaled and the cost is untouched", () => {
    const cost: EffectDescriptor = {
      type: "payResource",
      resource: "money",
      amount: 80,
      insufficientFunds: "pay-up-to-available",
    };
    const held = holding(CARD_STATUS_IDS.workCardMoneyMultiplier, { multiplier: 2 });

    const outcome = applyCardStatuses(held, "deck.work", [gainMoney(50), gainMoney(-30), cost]);

    // A `x2` on a "next work card pays double" card must never double the bill.
    expect(outcome.effects).toEqual([gainMoney(100), gainMoney(-30), cost]);
  });

  it("Given a meeting card drawn while the work multiplier is held, When it resolves, Then nothing is scaled and nothing is spent", () => {
    const held = holding(CARD_STATUS_IDS.workCardMoneyMultiplier, { multiplier: 2 });

    const outcome = applyCardStatuses(held, "deck.meeting", [gainMoney(150)]);

    expect(outcome.effects).toEqual([gainMoney(150)]);
    expect(outcome.consumedStatusIds).toEqual([]);
    expect(findActiveStatus(outcome.player, CARD_STATUS_IDS.workCardMoneyMultiplier)).not.toBeNull();
  });

  it("Given a work card with no money on it, When it resolves, Then the status is still spent", () => {
    const held = holding(CARD_STATUS_IDS.workCardMoneyMultiplier, { multiplier: 2 });

    const first = applyCardStatuses(held, "deck.work", [workCounter]);
    const second = applyCardStatuses(first.player, "deck.work", [gainMoney(150)]);

    // Same rule as the shipped `status.ignore-next-work-energy`, which is spent
    // by landing on a work tile whether or not it had energy to ignore. A
    // status that only ticks on a matching line has no visible duration.
    expect(first.consumedStatusIds).toEqual([CARD_STATUS_IDS.workCardMoneyMultiplier]);
    expect(second.effects).toEqual([gainMoney(150)]);
    expect(second.consumedStatusIds).toEqual([]);
  });
});

describe("status.next-work-card-reputation-multiplier", () => {
  it("Given the authored copy on card.work.performance-report, When the next work card grants reputation, Then it doubles and money is untouched", () => {
    const authored = authoredStatus("card.work.performance-report");
    expect(authored.statusId).toBe(CARD_STATUS_IDS.workCardReputationMultiplier);

    const held = applyStatusEffect(player(), {
      statusId: authored.statusId,
      duration: { kind: "uses", count: 1 },
      parameters: authored.parameters,
    });
    const outcome = applyCardStatuses(held, "deck.work", [gainReputation(1), gainMoney(100)]);

    expect(outcome.effects).toEqual([gainReputation(2), gainMoney(100)]);
    expect(outcome.player.statuses).toEqual([]);
  });

  it("Given both work multipliers at once, When one work card resolves, Then both fire and both are spent", () => {
    const both = applyStatusEffect(
      holding(CARD_STATUS_IDS.workCardMoneyMultiplier, { multiplier: 2 }),
      {
        statusId: CARD_STATUS_IDS.workCardReputationMultiplier,
        duration: { kind: "uses", count: 1 },
        parameters: { multiplier: 2 },
      },
    );

    const outcome = applyCardStatuses(both, "deck.work", [gainMoney(50), gainReputation(1)]);

    expect(outcome.effects).toEqual([gainMoney(100), gainReputation(2)]);
    expect(outcome.consumedStatusIds).toEqual([
      CARD_STATUS_IDS.workCardMoneyMultiplier,
      CARD_STATUS_IDS.workCardReputationMultiplier,
    ]);
    expect(outcome.player.statuses).toEqual([]);
  });
});

describe("status.next-work-extra-energy", () => {
  it("Given the authored copy on card.meeting.action-items, When the next work card resolves, Then it costs the extra energy and the status is spent", () => {
    const authored = authoredStatus("card.meeting.action-items");
    expect(authored.statusId).toBe(CARD_STATUS_IDS.workExtraEnergy);

    const held = applyStatusEffect(player(), {
      statusId: authored.statusId,
      duration: { kind: "uses", count: 1 },
      parameters: authored.parameters,
    });
    const outcome = applyCardStatuses(held, "deck.work", [gainMoney(100)]);

    // `card.meeting.action-items` is authored `polarity: "negative"` on both the
    // card and the status, and its own docstring calls it "a penalty twin of a
    // shipped bonus" — the bonus being the tile status that *removes* a work
    // energy cost. So the mirror adds one.
    expect(outcome.effects).toEqual([gainMoney(100), loseEnergy(1)]);
    expect(outcome.player.statuses).toEqual([]);
  });

  it("Given the status held with no energy parameter, When a work card resolves, Then it still costs one and is still spent", () => {
    const held = holding(CARD_STATUS_IDS.workExtraEnergy);

    const outcome = applyCardStatuses(held, "deck.work", []);

    expect(outcome.effects).toEqual([loseEnergy(1)]);
    expect(outcome.consumedStatusIds).toEqual([CARD_STATUS_IDS.workExtraEnergy]);
  });
});

describe("status.ignore-next-meeting-energy", () => {
  it("Given the authored copy on card.meeting.calendar-priority, When the next meeting card costs energy, Then the energy line is dropped and the rest applies", () => {
    const authored = authoredStatus("card.meeting.calendar-priority");
    expect(authored.statusId).toBe(CARD_STATUS_IDS.ignoreMeetingEnergy);

    const held = holding(authored.statusId);
    const outcome = applyCardStatuses(held, "deck.meeting", [
      loseEnergy(2),
      gainReputation(1),
      workCounter,
    ]);

    expect(outcome.effects).toEqual([gainReputation(1), workCounter]);
    expect(outcome.player.statuses).toEqual([]);
  });

  it("Given a meeting card that grants energy, When the status fires, Then the gain survives", () => {
    const held = holding(CARD_STATUS_IDS.ignoreMeetingEnergy);

    const outcome = applyCardStatuses(held, "deck.meeting", [
      { type: "modifyResource", resource: "energy", amount: 2, clampAtMaximum: true },
    ]);

    expect(outcome.effects).toEqual([
      { type: "modifyResource", resource: "energy", amount: 2, clampAtMaximum: true },
    ]);
  });

  it("Given a work card costing energy, When the meeting status is held, Then it is neither applied nor spent", () => {
    const held = holding(CARD_STATUS_IDS.ignoreMeetingEnergy);

    const outcome = applyCardStatuses(held, "deck.work", [loseEnergy(2)]);

    expect(outcome.effects).toEqual([loseEnergy(2)]);
    expect(findActiveStatus(outcome.player, CARD_STATUS_IDS.ignoreMeetingEnergy)).not.toBeNull();
  });
});

describe("status.skip-next-networking-reward", () => {
  it("Given the authored copy on card.networking.mute-button, When the victim's next networking card resolves, Then only its rewards are dropped", () => {
    const authored = authoredStatus("card.networking.mute-button");
    expect(authored.statusId).toBe(CARD_STATUS_IDS.skipNetworkingReward);

    const held = holding(authored.statusId);
    const cost: EffectDescriptor = {
      type: "payResource",
      resource: "money",
      amount: 50,
      insufficientFunds: "pay-up-to-available",
    };
    const outcome = applyCardStatuses(held, "deck.networking", [
      gainReputation(2),
      gainMoney(100),
      cost,
      loseEnergy(1),
    ]);

    // Dropping the losses too would make the attack a gift roughly half the
    // time, which is exactly what the authoring note refuses.
    expect(outcome.effects).toEqual([cost, loseEnergy(1)]);
    expect(outcome.player.statuses).toEqual([]);
  });

  it("Given a networking card that is pure punishment, When the status fires, Then nothing is dropped and the status is still spent", () => {
    const held = holding(CARD_STATUS_IDS.skipNetworkingReward);

    const outcome = applyCardStatuses(held, "deck.networking", [loseEnergy(1)]);

    expect(outcome.effects).toEqual([loseEnergy(1)]);
    expect(outcome.consumedStatusIds).toEqual([CARD_STATUS_IDS.skipNetworkingReward]);
  });

  it("Given an unclassifiable effect on the card, When the status fires, Then it still applies rather than being silently suppressed", () => {
    const held = holding(CARD_STATUS_IDS.skipNetworkingReward);
    const opaque: EffectDescriptor = { type: "noEffect" };

    const outcome = applyCardStatuses(held, "deck.networking", [gainMoney(50), opaque]);

    expect(outcome.effects).toEqual([opaque]);
  });
});

describe("status.cancel-next-money-loss", () => {
  it("Given the authored copy on card.work.expense-claim, When money would be lost, Then the loss is cancelled and the status is spent", () => {
    const authored = authoredStatus("card.work.expense-claim");
    expect(authored.statusId).toBe(CARD_STATUS_IDS.cancelMoneyLoss);

    const held = holding(authored.statusId);
    const outcome = cancelMoneyLoss(held, -250);

    expect(outcome.amount).toBe(0);
    expect(outcome.cancelled).toBe(true);
    expect(outcome.player.statuses).toEqual([]);
  });

  it("Given a money gain, When it is checked, Then it passes through and the status survives for a real loss", () => {
    const held = holding(CARD_STATUS_IDS.cancelMoneyLoss);

    const gain = cancelMoneyLoss(held, 300);
    const zero = cancelMoneyLoss(gain.player, 0);
    const loss = cancelMoneyLoss(zero.player, -40);

    expect(gain.amount).toBe(300);
    expect(gain.cancelled).toBe(false);
    expect(zero.cancelled).toBe(false);
    expect(loss.amount).toBe(0);
    expect(loss.cancelled).toBe(true);
  });

  it("Given the status already spent, When a second loss lands, Then it is charged in full", () => {
    const held = holding(CARD_STATUS_IDS.cancelMoneyLoss);

    const first = cancelMoneyLoss(held, -100);
    const second = cancelMoneyLoss(first.player, -100);

    expect(first.amount).toBe(0);
    expect(second.amount).toBe(-100);
    expect(second.cancelled).toBe(false);
  });

  it("Given no status at all, When money is lost, Then nothing changes", () => {
    const outcome = cancelMoneyLoss(player(), -75);

    expect(outcome.amount).toBe(-75);
    expect(outcome.cancelled).toBe(false);
    expect(outcome.player).toBe(outcome.player);
  });
});

describe("status.next-promotion-reputation-discount", () => {
  it("Given the authored copies, When a promotion is attempted, Then each card's own amount is discounted once", () => {
    const one = authoredStatus("card.work.promotion-portfolio");
    const two = authoredStatus("card.meeting.approval-letter");
    expect(one.statusId).toBe(CARD_STATUS_IDS.promotionReputationDiscount);
    expect(two.statusId).toBe(CARD_STATUS_IDS.promotionReputationDiscount);

    const holdingOne = applyStatusEffect(player(), {
      statusId: one.statusId,
      duration: { kind: "uses", count: 1 },
      parameters: one.parameters,
    });
    const holdingTwo = applyStatusEffect(player(), {
      statusId: two.statusId,
      duration: { kind: "uses", count: 1 },
      parameters: two.parameters,
    });

    expect(promotionReputationDiscount(holdingOne).discount).toBe(1);
    expect(promotionReputationDiscount(holdingTwo).discount).toBe(2);
  });

  it("Given the status held, When two promotions are attempted, Then only the first is discounted", () => {
    const held = holding(CARD_STATUS_IDS.promotionReputationDiscount, { reputation: 2 });

    const first = promotionReputationDiscount(held);
    const second = promotionReputationDiscount(first.player);

    expect(first.discount).toBe(2);
    expect(first.player.statuses).toEqual([]);
    expect(second.discount).toBe(0);
  });

  it("Given no status, When a promotion is attempted, Then the requirement is undiscounted", () => {
    const outcome = promotionReputationDiscount(player());

    expect(outcome.discount).toBe(0);
    expect(outcome.player.statuses).toEqual([]);
  });
});

describe("every card status is consumed exactly once", () => {
  const cases: readonly {
    readonly statusId: string;
    readonly deckId: string;
    readonly effects: readonly EffectDescriptor[];
    readonly parameters?: Readonly<Record<string, number>>;
  }[] = [
    {
      statusId: CARD_STATUS_IDS.workCardMoneyMultiplier,
      deckId: "deck.work",
      effects: [gainMoney(10)],
      parameters: { multiplier: 2 },
    },
    {
      statusId: CARD_STATUS_IDS.workCardReputationMultiplier,
      deckId: "deck.work",
      effects: [gainReputation(1)],
      parameters: { multiplier: 2 },
    },
    {
      statusId: CARD_STATUS_IDS.workExtraEnergy,
      deckId: "deck.work",
      effects: [],
      parameters: { energy: 1 },
    },
    {
      statusId: CARD_STATUS_IDS.ignoreMeetingEnergy,
      deckId: "deck.meeting",
      effects: [loseEnergy(1)],
    },
    {
      statusId: CARD_STATUS_IDS.skipNetworkingReward,
      deckId: "deck.networking",
      effects: [gainMoney(10)],
    },
  ];

  for (const testCase of cases) {
    it(`Given ${testCase.statusId}, When a second card of the same deck resolves, Then it no longer fires`, () => {
      const held = holding(testCase.statusId, testCase.parameters);

      const first = applyCardStatuses(held, testCase.deckId, testCase.effects);
      const second = applyCardStatuses(first.player, testCase.deckId, testCase.effects);

      expect(first.consumedStatusIds).toEqual([testCase.statusId]);
      expect(first.player.statuses).toEqual([]);
      expect(second.consumedStatusIds).toEqual([]);
      expect(second.effects).toEqual(testCase.effects);
    });
  }
});
