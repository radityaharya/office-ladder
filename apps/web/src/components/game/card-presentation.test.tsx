import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { EffectDescriptor } from "@office-ladder/content";
import { deadlineDashContent } from "@office-ladder/content";

import { resolveAuthoredCardDraw } from "./card-draw-dialog";
import {
  CardEffectTable,
  CardFace,
  describeCardDrawSource,
  describeEffect,
  effectLabel,
  resolveAuthoredCardCopy,
} from "./card";
import type { CardDrawNotice } from "./event-feedback-policy";

const workDeck = deck("deck.work");
const overtimeBonus = card(workDeck, "card.work.overtime-bonus");
const crunchTime = card(workDeck, "card.work.crunch-time");
const freeCoffee = card(workDeck, "card.work.free-coffee");

describe("authored card copy", () => {
  it("uses the content pack's authored display copy for a real card", () => {
    // When
    const copy = resolveAuthoredCardCopy(overtimeBonus, workDeck);

    // Then
    expect(copy.name).toBe("Overtime Authorized");
    expect(copy.nameSource).toBe("authored");
    expect(copy.flavor).toBe("Payroll processed the extra hours without comment.");
    expect(copy.deckName).toBe("Work");
  });

  it("falls back to the derived title-cased id when a card carries no authored copy", () => {
    // Given — the shape a card had before authored copy existed. The fields are
    // optional, so this must stay renderable.
    const unauthored = {
      id: "card.work.overtime-bonus",
      nameKey: "deadlineDash.card.workOvertimeBonus.name",
    };

    // When
    const copy = resolveAuthoredCardCopy(unauthored, workDeck);

    // Then
    expect(copy.name).toBe("Overtime bonus");
    expect(copy.nameSource).toBe("derived");
    expect(copy.flavor).toBeNull();
    expect(copy.deckName).toBe("Work");
  });

  it("accepts the alternate field names authored copy could arrive under", () => {
    // Given
    const aliased = {
      id: "card.board-meeting.budget-approved",
      nameKey: "deadlineDash.card.boardMeetingBudgetApproved.name",
      name: "Budget Approved",
      flavor: "Finance released the line item this morning.",
    };

    // When
    const copy = resolveAuthoredCardCopy(aliased, deck("deck.board-meeting"));

    // Then
    expect(copy.name).toBe("Budget Approved");
    expect(copy.nameSource).toBe("authored");
    expect(copy.flavor).toBe("Finance released the line item this morning.");
    expect(copy.deckName).toBe("Board meeting");
  });

  it("ignores blank authored copy instead of rendering an empty name", () => {
    // Given
    const blank = {
      id: "card.board-meeting.budget-approved",
      nameKey: "deadlineDash.card.boardMeetingBudgetApproved.name",
      displayName: "   ",
      flavorText: "",
    };

    // When
    const copy = resolveAuthoredCardCopy(blank, deck("deck.board-meeting"));

    // Then
    expect(copy.name).toBe("Budget approved");
    expect(copy.nameSource).toBe("derived");
    expect(copy.flavor).toBeNull();
  });
});

describe("card face", () => {
  it("renders the authored name, flavor line and deck identity", () => {
    // When
    const markup = renderToStaticMarkup(
      <CardFace
        cardId={overtimeBonus.id}
        copy={resolveAuthoredCardCopy(overtimeBonus, workDeck)}
        deckId={workDeck.id}
        effects={overtimeBonus.effects}
      />,
    );

    // Then
    expect(markup).toContain('data-card-name-source="authored"');
    expect(markup).toContain("Overtime Authorized");
    expect(markup).toContain('data-slot="card-face-flavor"');
    expect(markup).toContain("Payroll processed the extra hours without comment.");
    expect(markup).toContain("Work deck");
    expect(markup).toContain("card.work.overtime-bonus");
    expect(markup).toContain("Gain $150.");
  });

  it("renders the derived name and omits the flavor row when nothing is authored", () => {
    // Given — a card with no authored copy at all.
    const unauthored = {
      id: freeCoffee.id,
      nameKey: freeCoffee.nameKey,
    };

    // When
    const markup = renderToStaticMarkup(
      <CardFace
        cardId={unauthored.id}
        copy={resolveAuthoredCardCopy(unauthored, workDeck)}
        deckId={workDeck.id}
        effects={freeCoffee.effects}
      />,
    );

    // Then
    expect(markup).toContain('data-card-name-source="derived"');
    expect(markup).toContain("Free coffee");
    expect(markup).not.toContain('data-slot="card-face-flavor"');
    expect(markup).toContain("Restore energy to maximum.");
  });

  it("lets the host own the name element so a modal can be labelled by it", () => {
    // When
    const markup = renderToStaticMarkup(
      <CardFace
        cardId={freeCoffee.id}
        copy={resolveAuthoredCardCopy(freeCoffee, workDeck)}
        deckId={workDeck.id}
        effects={freeCoffee.effects}
        renderName={(props) => <p {...props} data-slot="host-name" />}
      />,
    );

    // Then
    expect(markup).toContain('data-slot="host-name"');
    expect(markup).not.toContain('data-slot="card-face-name"');
  });

  it("renders the provenance line the host supplies", () => {
    // When
    const markup = renderToStaticMarkup(
      <CardFace
        cardId={overtimeBonus.id}
        copy={resolveAuthoredCardCopy(overtimeBonus, workDeck)}
        deckId={workDeck.id}
        effects={overtimeBonus.effects}
        provenance={<p>{describeCardDrawSource(notice("remote", "Morgan"))}</p>}
      />,
    );

    // Then
    expect(markup).toContain("Morgan drew this card.");
  });
});

describe("card effects readout", () => {
  it("states a real content card's gains and losses with signed mono deltas", () => {
    // Given — crunch time: +200 money, -2 energy.

    // When
    const markup = renderToStaticMarkup(<CardEffectTable effects={crunchTime.effects} />);

    // Then
    expect(markup).toContain("Gain $200.");
    expect(markup).toContain("+200");
    expect(markup).toContain("MONEY");
    expect(markup).toContain("Lose 2 energy.");
    expect(markup).toContain("-2");
    expect(markup).toContain("ENERGY");
    expect(markup).toContain("2 entries");
  });

  it("labels every row's polarity outside of color", () => {
    // When
    const markup = renderToStaticMarkup(<CardEffectTable effects={crunchTime.effects} />);
    const rows = markup.match(/data-polarity="[a-z]+"/g) ?? [];

    // Then
    expect(rows).toEqual(['data-polarity="gain"', 'data-polarity="cost"']);
  });

  it("reports a card with no mechanical effect instead of an empty panel", () => {
    // When
    const markup = renderToStaticMarkup(<CardEffectTable effects={[]} />);

    // Then
    expect(markup).toContain('data-slot="card-effect-empty"');
    expect(markup).toContain("No mechanical effect.");
    expect(markup).toContain("0 entries");
  });

  it("keeps a long effects list inside a capped scroll region", () => {
    // Given
    const manyEffects: readonly EffectDescriptor[] = Array.from({ length: 12 }, () => ({
      type: "modifyResource",
      resource: "reputation",
      amount: 1,
      clampAtZero: true,
    }));

    // When
    const markup = renderToStaticMarkup(<CardEffectTable effects={manyEffects} />);
    const rows = markup.match(/data-slot="card-effect-row"/g) ?? [];

    // Then
    expect(rows).toHaveLength(12);
    expect(markup).toContain("12 entries");
    expect(markup).toContain("card-effect-scroll");
    expect(markup).toContain("max-h-72");
  });

  it("describes every effect kind the content pack's cards actually use", () => {
    // Given
    const authoredEffects: readonly EffectDescriptor[] = deadlineDashContent.decks.flatMap(
      (entry): readonly EffectDescriptor[] =>
        entry.cards.flatMap((entryCard): readonly EffectDescriptor[] => entryCard.effects),
    );

    // When
    const readouts = authoredEffects.map((effect) => describeEffect(effect));

    // Then
    expect(readouts.length).toBeGreaterThan(0);
    for (const readout of readouts) {
      expect(readout.sentence).toMatch(/^[A-Z].*\.$/);
      expect(readout.scope.length).toBeGreaterThan(0);
    }
  });

  it("keeps status, skip-turn and draw copy truthful to the mechanics", () => {
    // When
    const salary = effectLabel({
      type: "applyStatus",
      statusId: "status.next-salary-multiplier",
      duration: { kind: "uses", count: 1 },
      parameters: { multiplier: 1.5 },
    });
    const skipTile = describeEffect({
      type: "applyStatus",
      statusId: "status.skip-next-tile-effect",
      duration: { kind: "uses", count: 1 },
    });
    const skipTurn = describeEffect({ type: "skipTurns", count: 1, source: "tile" });
    const draw = describeEffect({ type: "drawCards", deckId: "deck.board-meeting", count: 1 });
    const extraRoll = describeEffect({ type: "grantExtraRoll", count: 1 });
    const workMark = describeEffect({
      type: "incrementWorkCounter",
      amount: 1,
      rewardEvery: 5,
      reward: { resource: "reputation", amount: 1 },
      cumulative: true,
    });
    const audit = describeEffect({
      type: "auditConfinement",
      release: {
        roll: { count: 2, sides: 6 },
        requiresTrueDoubles: true,
        rerollEligible: false,
        alternativeFine: 500,
      },
    });

    // Then
    expect(salary).toBe("Your next salary payment is multiplied by 1.5.");
    expect(skipTile.sentence).toBe("Skip the effect of the next tile you land on.");
    expect(skipTile.delta).toBe("1 USE");
    expect(skipTurn.sentence).toBe("Skip your next turn.");
    expect(skipTurn.delta).toBe("-1");
    expect(draw.sentence).toBe("Draw 1 more card from the board meeting deck.");
    expect(extraRoll.sentence).toBe("Roll again before your turn ends.");
    expect(extraRoll.delta).toBe("+1");
    expect(workMark.sentence).toBe("Log 1 work mark; every 5th mark awards 1 reputation.");
    expect(audit.sentence).toContain("roll doubles on 2d6 or pay the $500 fine");
    expect(audit.delta).toBeNull();
  });
});

describe("gameplay v2 effect readout", () => {
  it("gives every v2 effect type a sentence, a scope and a stated target", () => {
    // Given — one descriptor per effect type added by gameplay v2 §10.3/§10.5.
    // The list is spelled out rather than derived so that a type losing its
    // sentence fails here, not silently at render time.
    const v2Effects: readonly EffectDescriptor[] = [
      { type: "transferResource", resource: "money", amount: 200, target: "all-opponents" },
      { type: "modifyHeat", amount: 2 },
      { type: "placeObject", placementKind: "placement.meeting-invite" },
      { type: "claimTile", baseCost: 200 },
      { type: "releaseTile" },
      {
        type: "startProject",
        definitionId: "project.rollout",
        requiredMoney: 400,
        requiredWork: 3,
        payout: { money: 900, reputation: 2, objectiveProgress: 1 },
      },
      { type: "contributeToProject", money: 200, work: 1 },
      { type: "sabotageProject", amount: 2 },
      { type: "openBallot", ballotKind: "vote", subjectId: "ballot.budget", visibility: "sealed" },
      { type: "grantImmunity", count: 1, scope: { resource: "money", direction: "loss" } },
      { type: "forceDiscard", count: 1, target: "chosen-opponent" },
      { type: "swapBoardPositions", target: "chosen-opponent" },
      { type: "teleport", destination: { kind: "tileIndex", index: 12 } },
      { type: "modifyUpkeep", amount: 50 },
      { type: "openReactionWindow", windowKind: "prevention" },
      {
        type: "grantIncomeStream",
        streamKind: "asset",
        perRound: 100,
        remainingRounds: null,
      },
      { type: "removeStatuses", filter: { polarity: "negative" }, limit: 1 },
      {
        type: "chooseOne",
        options: [
          { id: "a", label: "Take the money", effects: [] },
          { id: "b", label: "Take the credit", effects: [] },
        ],
      },
      { type: "noEffect" },
      { type: "opposedRoll", onWin: [], onLose: [] },
    ];

    // When
    const readouts = v2Effects.map((effect) => describeEffect(effect));

    // Then
    expect(readouts).toHaveLength(20);
    for (const readout of readouts) {
      expect(readout.sentence).toMatch(/^[A-Z].*\.$/);
      expect(readout.scope.length).toBeGreaterThan(0);
    }
  });

  it("names who an effect lands on rather than leaving targeting implied", () => {
    // Then
    expect(effectLabel({ type: "modifyResource", resource: "energy", amount: -2 })).toBe(
      "Lose 2 energy.",
    );
    expect(
      effectLabel({
        type: "modifyResource",
        resource: "energy",
        amount: -2,
        target: "all-opponents",
      }),
    ).toBe("Each opponent loses 2 energy.");
    expect(
      effectLabel({
        type: "modifyResource",
        resource: "energy",
        amount: -2,
        target: "highest-rank",
      }),
    ).toBe("The highest-ranked player loses 2 energy.");
    expect(
      effectLabel({ type: "modifyResource", resource: "money", amount: 100, target: "all-players" }),
    ).toBe("Every player gains $100.");
  });

  it("describes a transfer from the actor's side, in the direction it moves", () => {
    // Then
    expect(
      effectLabel({
        type: "transferResource",
        resource: "money",
        amount: 200,
        direction: "target-to-actor",
        target: "chosen-opponent",
        insufficientFunds: "transfer-up-to-available",
      }),
    ).toBe("Take $200 from your chosen opponent, or as much of it as they have.");
    expect(
      effectLabel({
        type: "transferResource",
        resource: "money",
        amount: 200,
        direction: "actor-to-target",
        target: "all-opponents",
        insufficientFunds: "transfer-up-to-available",
      }),
    ).toBe("Give $200 to each opponent, or as much of it as you have.");
  });

  it("says what a scaled amount scales by, and where it stops", () => {
    // When
    const scaled = describeEffect({
      type: "modifyResource",
      resource: "money",
      amount: 100,
      target: "all-players",
      scale: { by: "work-counter", perUnit: 25, cap: 400 },
    });

    // Then
    expect(scaled.sentence).toBe(
      "Every player gains $100. The amount rises by $25 for every work mark, capped at $400.",
    );
  });

  it("says an effect is preventable, because that is what makes a reaction worth holding", () => {
    // When
    const aimed = describeEffect({
      type: "modifyResource",
      resource: "reputation",
      amount: -1,
      target: "chosen-opponent",
      preventable: true,
    });

    // Then
    expect(aimed.sentence).toBe(
      "Your chosen opponent loses 1 reputation. A reaction can prevent this.",
    );
  });

  it("states the guard on a conditional effect in the voice of whoever it is tested against", () => {
    // Then
    expect(
      effectLabel({
        type: "modifyResource",
        resource: "reputation",
        amount: 2,
        condition: { kind: "resourceAtLeast", who: "target", resource: "work-counter", amount: 5 },
      }),
    ).toBe("If you have 5 work marks or more, gain 2 reputation.");
    expect(
      effectLabel({
        type: "restoreResourceToMaximum",
        resource: "energy",
        target: "all-players",
        condition: { kind: "not", of: { kind: "heatAtLeast", who: "target", value: 1 } },
      }),
    ).toBe("Unless they have 1 or more heat, every player restores energy to maximum.");
  });

  it("spells out the branches of a choice and of an opposed roll", () => {
    // When
    const choice = describeEffect({
      type: "chooseOne",
      options: [
        {
          id: "fast",
          label: "Deliver today",
          effects: [{ type: "modifyResource", resource: "money", amount: 250 }],
        },
        {
          id: "careful",
          label: "Hold for review",
          effects: [{ type: "modifyResource", resource: "energy", amount: 2 }],
        },
      ],
    });
    const wager = describeEffect({
      type: "opposedRoll",
      opponent: "chosen-opponent",
      dice: { count: 1, sides: 6 },
      onWin: [
        {
          type: "transferResource",
          resource: "money",
          amount: 200,
          direction: "target-to-actor",
          insufficientFunds: "transfer-up-to-available",
        },
      ],
      onLose: [
        {
          type: "transferResource",
          resource: "money",
          amount: 200,
          direction: "actor-to-target",
          insufficientFunds: "transfer-up-to-available",
        },
      ],
    });

    // Then
    expect(choice.sentence).toBe(
      "Choose one: Deliver today (gain $250); or Hold for review (gain 2 energy).",
    );
    expect(choice.delta).toBe("2 OPTIONS");
    // The branches inherit the roll's opponent, not the actor — otherwise a
    // wager reads as taking money from yourself.
    expect(wager.sentence).toBe(
      "Both you and your chosen opponent roll 1d6: if you roll higher, take $200 from your chosen opponent, or as much of it as they have; if you roll lower, give $200 to your chosen opponent, or as much of it as you have; on a tie, nothing happens.",
    );
  });

  it("states the multiplier a work-card status carries, including the zero that makes it an attack", () => {
    // Then
    expect(
      effectLabel({
        type: "applyStatus",
        statusId: "status.next-work-card-money-multiplier",
        duration: { kind: "uses", count: 1 },
        parameters: { multiplier: 0 },
        target: "chosen-opponent",
      }),
    ).toBe("Your chosen opponent's next work card pays no money award at all.");
    expect(
      effectLabel({
        type: "applyStatus",
        statusId: "status.next-work-card-money-multiplier",
        duration: { kind: "uses", count: 1 },
        parameters: { multiplier: 2 },
      }),
    ).toBe("Your next work card has its money award multiplied by 2.");
  });

  it("renders a v2 card's rows with a polarity and a delta, never a blank line", () => {
    // Given — an aimed steal plus the heat §10.4 makes it carry.
    const effects: readonly EffectDescriptor[] = [
      {
        type: "transferResource",
        resource: "money",
        amount: 200,
        direction: "target-to-actor",
        target: "chosen-opponent",
        preventable: true,
        insufficientFunds: "transfer-up-to-available",
      },
      { type: "modifyHeat", amount: 1, target: "self" },
    ];

    // When
    const markup = renderToStaticMarkup(<CardEffectTable effects={effects} />);
    const polarities = markup.match(/data-polarity="[a-z]+"/g) ?? [];

    // Then
    expect(polarities).toEqual(['data-polarity="gain"', 'data-polarity="cost"']);
    expect(markup).toContain("Take $200 from your chosen opponent");
    expect(markup).toContain("A reaction can prevent this.");
    expect(markup).toContain("Attract 1 point of heat");
    expect(markup).toContain("HEAT");
    expect(markup).toContain("2 entries");
  });
});

describe("card draw resolution", () => {
  it("attaches resolved display copy to a matched authored draw", () => {
    // When
    const draw = resolveAuthoredCardDraw({
      ...notice("local", "Avery"),
      card: {
        definitionId: "card.work.overtime-bonus",
        deckId: "deck.work",
        nameKey: "deadlineDash.card.workOvertimeBonus.name",
      },
    });

    // Then
    expect(draw?.copy.name).toBe("Overtime Authorized");
    expect(draw?.copy.nameSource).toBe("authored");
    expect(draw?.copy.deckName).toBe("Work");
    expect(draw?.card.id).toBe("card.work.overtime-bonus");
  });

  it("returns null for a payload with no authored card behind it", () => {
    // When
    const draw = resolveAuthoredCardDraw({
      ...notice("local", "Avery"),
      card: {
        definitionId: "card.work.does-not-exist",
        deckId: "deck.work",
        nameKey: "deadlineDash.card.workDoesNotExist.name",
      },
    });

    // Then
    expect(draw).toBeNull();
  });

  it("names the drawer in the provenance line for local, remote and system draws", () => {
    // Then
    expect(describeCardDrawSource(notice("local", "Avery"))).toContain("You drew this card.");
    expect(describeCardDrawSource(notice("remote", "Morgan"))).toContain(
      "Morgan drew this card.",
    );
    expect(describeCardDrawSource(notice("system", "System"))).toContain(
      "The system drew this card.",
    );
  });
});

function deck(deckId: string) {
  const found = deadlineDashContent.decks.find((entry) => entry.id === deckId);
  if (!found) throw new Error(`Missing authored deck ${deckId}`);
  return found;
}

function card(source: ReturnType<typeof deck>, cardId: string) {
  const found = source.cards.find((entry) => entry.id === cardId);
  if (!found) throw new Error(`Missing authored card ${cardId}`);
  return found;
}

function notice(actorKind: CardDrawNotice["actorKind"], actorName: string): CardDrawNotice {
  return {
    eventId: "event-1",
    revision: 7,
    actorKind,
    actorName,
    card: {
      definitionId: "card.work.overtime-bonus",
      deckId: "deck.work",
      nameKey: "deadlineDash.card.workOvertimeBonus.name",
    },
  };
}
