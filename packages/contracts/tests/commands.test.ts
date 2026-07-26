import { describe, expect, it } from "vitest";

import {
  isPlayerCommandType,
  MAX_AGREEMENT_RECIPIENTS,
  MAX_IMMUNITY_ROUNDS,
  MAX_MONEY_AMOUNT,
  MAX_PIP_ADJUST,
  MAX_ROUND_NUMBER,
  MAX_TARGET_PLAYER_IDS,
  MAX_TOKEN_QUANTITY,
  MAX_TRADE_ITEMS,
  MAX_WORK_AMOUNT,
  parseActivateCharacterRequest,
  parseAdjustRollRequest,
  parseAttemptPromotionRequest,
  parseBlockPromotionRequest,
  parseCastBallotRequest,
  parseClaimTileRequest,
  parseCommandType,
  parseContributeToProjectRequest,
  parseDeclinePromotionRequest,
  parseOfferAgreementRequest,
  parsePassReactionRequest,
  parsePayAuditFineRequest,
  parsePlacePlacementRequest,
  parsePlayCardRequest,
  parsePlayerCommandRequest,
  parsePlayReactionRequest,
  parseRepayLoanRequest,
  parseRespondToAgreementRequest,
  parseSabotageProjectRequest,
  parseShuffleManagementDeckRequest,
  parseSpendTokenRequest,
  parseStartProjectRequest,
  parseTakeLoanRequest,
  parseTargetAttackRequest,
  parseTurnActionRequest,
  parseUpgradeTileRequest,
  PLAYER_COMMAND_TYPES,
  PROMISE_TEXT_MAX_LENGTH,
  SERVER_INJECTED_COMMAND_TYPES,
} from "../src/commands";
import { ContractValidationError } from "../src/validate";

const envelope = { commandId: "command-1", expectedRevision: 4 } as const;
const decisionEnvelope = { ...envelope, decisionPointId: "decision-1" } as const;

describe("gameplay command envelopes", () => {
  it("Given a well-formed body for each new command, When parsing it, Then the typed request comes back with the envelope intact", () => {
    expect(
      parsePlayCardRequest({
        ...envelope,
        cardId: "card-1",
        targetPlayerIds: ["player-1"],
        choice: { option: "left" },
      }),
    ).toEqual({
      ...envelope,
      cardId: "card-1",
      targetPlayerIds: ["player-1"],
      choice: { option: "left" },
    });
    expect(
      parseActivateCharacterRequest({
        ...envelope,
        abilityId: "ability.teleport",
        targetPlayerIds: [],
        choice: null,
      }),
    ).toEqual({
      ...envelope,
      abilityId: "ability.teleport",
      targetPlayerIds: [],
      choice: null,
    });
    expect(
      parseSpendTokenRequest({
        ...envelope,
        tokenId: "token.favour",
        quantity: 2,
        use: "reroll",
      }),
    ).toEqual({ ...envelope, tokenId: "token.favour", quantity: 2, use: "reroll" });
    expect(
      parsePlayReactionRequest({
        ...decisionEnvelope,
        cardId: "card-9",
        abilityId: null,
        targetPlayerIds: ["player-2"],
        choice: 3,
      }),
    ).toEqual({
      ...decisionEnvelope,
      cardId: "card-9",
      abilityId: null,
      targetPlayerIds: ["player-2"],
      choice: 3,
    });
    expect(parsePassReactionRequest(decisionEnvelope)).toEqual(decisionEnvelope);
    expect(parseBlockPromotionRequest(decisionEnvelope)).toEqual(decisionEnvelope);
    expect(parsePayAuditFineRequest(envelope)).toEqual(envelope);
    expect(parseAttemptPromotionRequest(envelope)).toEqual(envelope);
    expect(parseDeclinePromotionRequest(envelope)).toEqual(envelope);
    expect(
      parseShuffleManagementDeckRequest({ ...envelope, deckId: "deck.event" }),
    ).toEqual({ ...envelope, deckId: "deck.event" });
    expect(parseAdjustRollRequest({ ...envelope, pips: -2 })).toEqual({
      ...envelope,
      pips: -2,
    });
    expect(
      parseTurnActionRequest({
        ...envelope,
        action: "network",
        targetPlayerIds: ["player-3"],
        choice: null,
      }),
    ).toEqual({
      ...envelope,
      action: "network",
      targetPlayerIds: ["player-3"],
      choice: null,
    });
    expect(parseClaimTileRequest({ ...envelope, tileId: "tile.desk-1" })).toEqual({
      ...envelope,
      tileId: "tile.desk-1",
    });
    expect(parseUpgradeTileRequest({ ...envelope, tileId: "tile.desk-1" })).toEqual({
      ...envelope,
      tileId: "tile.desk-1",
    });
    expect(
      parsePlacePlacementRequest({
        ...envelope,
        kind: "placement.rumour",
        tileId: "tile.desk-1",
      }),
    ).toEqual({ ...envelope, kind: "placement.rumour", tileId: "tile.desk-1" });
    expect(
      parseStartProjectRequest({
        ...envelope,
        definitionId: "project.migration",
        tileId: null,
        openToJoin: true,
      }),
    ).toEqual({
      ...envelope,
      definitionId: "project.migration",
      tileId: null,
      openToJoin: true,
    });
    expect(
      parseContributeToProjectRequest({
        ...envelope,
        projectId: "project-1",
        money: 250,
        work: 0,
      }),
    ).toEqual({ ...envelope, projectId: "project-1", money: 250, work: 0 });
    expect(
      parseSabotageProjectRequest({
        ...envelope,
        projectId: "project-1",
        amount: 3,
        hidden: true,
      }),
    ).toEqual({ ...envelope, projectId: "project-1", amount: 3, hidden: true });
    expect(
      parseRespondToAgreementRequest({
        ...envelope,
        agreementId: "agreement-1",
        accept: false,
      }),
    ).toEqual({ ...envelope, agreementId: "agreement-1", accept: false });
    expect(
      parseTargetAttackRequest({
        ...envelope,
        targetPlayerId: "player-2",
        vector: "attack.rumour",
        cardId: null,
      }),
    ).toEqual({
      ...envelope,
      targetPlayerId: "player-2",
      vector: "attack.rumour",
      cardId: null,
    });
    expect(
      parseCastBallotRequest({ ...envelope, ballotId: "ballot-1", value: 400 }),
    ).toEqual({ ...envelope, ballotId: "ballot-1", value: 400 });
    expect(parseTakeLoanRequest({ ...envelope, principal: 500 })).toEqual({
      ...envelope,
      principal: 500,
    });
    expect(parseRepayLoanRequest({ ...envelope, loanId: "loan-1", amount: 100 })).toEqual({
      ...envelope,
      loanId: "loan-1",
      amount: 100,
    });
  });

  it.each([
    ["a missing commandId", { expectedRevision: 1, tileId: "tile.desk-1" }],
    ["a missing expectedRevision", { commandId: "command-1", tileId: "tile.desk-1" }],
    [
      "a negative expectedRevision",
      { commandId: "command-1", expectedRevision: -1, tileId: "tile.desk-1" },
    ],
    [
      "a fractional expectedRevision",
      { commandId: "command-1", expectedRevision: 1.5, tileId: "tile.desk-1" },
    ],
    ["an unknown extra field", { ...envelope, tileId: "tile.desk-1", actorId: "player-9" }],
    ["no payload field at all", { ...envelope }],
  ])(
    "Given a tile claim with %s, When parsing it, Then the request is rejected",
    (_label, body) => {
      expect(() => parseClaimTileRequest(body)).toThrow(ContractValidationError);
    },
  );

  it("Given a body that names its own actor, When parsing it, Then the field is refused rather than trusted", () => {
    // `actorId` comes from the session. A body that carries one is either a
    // confused client or an attempt to act as somebody else, and exact-key
    // validation means neither can be silently ignored.
    expect(() =>
      parseTargetAttackRequest({
        ...envelope,
        targetPlayerId: "player-2",
        vector: "attack.rumour",
        cardId: null,
        actorId: "player-1",
      }),
    ).toThrow(ContractValidationError);
  });

  it.each([
    ["the bot driver's namespace", "bot:game-1:4:roll"],
    ["the turn-timeout driver's namespace", "timeout:game-1:4:roll"],
    ["a re-cased server namespace", "BOT:game-1:4:roll"],
  ])(
    "Given a command id in %s, When parsing any gameplay command, Then it is refused",
    (_label, commandId) => {
      // Pre-claiming the id a server actor will derive makes that actor's command
      // read as already-applied. Every new command reaches the same guard because
      // they all share one envelope parser.
      expect(() =>
        parseAdjustRollRequest({ commandId, expectedRevision: 4, pips: 1 }),
      ).toThrow(ContractValidationError);
      expect(() =>
        parseTakeLoanRequest({ commandId, expectedRevision: 4, principal: 100 }),
      ).toThrow(ContractValidationError);
    },
  );

  it("Given a decision command without its decision point, When parsing it, Then the request is rejected", () => {
    expect(() => parsePassReactionRequest(envelope)).toThrow(ContractValidationError);
    expect(() => parseBlockPromotionRequest(envelope)).toThrow(ContractValidationError);
  });
});

describe("gameplay command bounds", () => {
  it.each([
    ["the negative limit", -MAX_PIP_ADJUST],
    ["the positive limit", MAX_PIP_ADJUST],
    ["one pip", 1],
  ])(
    "Given a roll adjustment at %s, When parsing it, Then it is accepted",
    (_label, pips) => {
      expect(parseAdjustRollRequest({ ...envelope, pips }).pips).toBe(pips);
    },
  );

  it.each([
    ["one past the positive limit", MAX_PIP_ADJUST + 1],
    ["one past the negative limit", -MAX_PIP_ADJUST - 1],
    ["a roll-selecting adjustment", 12],
    ["zero, which spends nothing and changes nothing", 0],
    ["a fractional adjustment", 1.5],
    ["a non-finite adjustment", Number.POSITIVE_INFINITY],
    ["NaN", Number.NaN],
    ["a numeric string", "3"],
  ])(
    "Given a roll adjustment of %s, When parsing it, Then it is rejected",
    (_label, pips) => {
      expect(() => parseAdjustRollRequest({ ...envelope, pips })).toThrow(
        ContractValidationError,
      );
    },
  );

  it.each([
    ["the money ceiling", { principal: MAX_MONEY_AMOUNT }],
    ["the smallest loan", { principal: 1 }],
  ])("Given a loan at %s, When parsing it, Then it is accepted", (_label, body) => {
    expect(parseTakeLoanRequest({ ...envelope, ...body }).principal).toBe(body.principal);
  });

  it.each([
    ["one past the money ceiling", MAX_MONEY_AMOUNT + 1],
    ["a negative principal", -100],
    ["a zero principal", 0],
    ["the largest safe integer", Number.MAX_SAFE_INTEGER],
    ["a value beyond safe-integer precision", 1e308],
  ])(
    "Given a loan principal of %s, When parsing it, Then it is rejected",
    (_label, principal) => {
      expect(() => parseTakeLoanRequest({ ...envelope, principal })).toThrow(
        ContractValidationError,
      );
    },
  );

  it("Given a project contribution of nothing at all, When parsing it, Then it is refused as a free share of the payout", () => {
    expect(() =>
      parseContributeToProjectRequest({
        ...envelope,
        projectId: "project-1",
        money: 0,
        work: 0,
      }),
    ).toThrow(ContractValidationError);
    // Either side alone is a real contribution.
    expect(
      parseContributeToProjectRequest({
        ...envelope,
        projectId: "project-1",
        money: 0,
        work: 1,
      }).work,
    ).toBe(1);
  });

  it.each([
    ["work past the ceiling", { money: 0, work: MAX_WORK_AMOUNT + 1 }],
    ["negative work", { money: 0, work: -5 }],
    ["negative money", { money: -5, work: 1 }],
  ])(
    "Given a project contribution with %s, When parsing it, Then it is rejected",
    (_label, amounts) => {
      expect(() =>
        parseContributeToProjectRequest({
          ...envelope,
          projectId: "project-1",
          ...amounts,
        }),
      ).toThrow(ContractValidationError);
    },
  );

  it("Given a sabotage of zero, When parsing it, Then it is rejected", () => {
    expect(() =>
      parseSabotageProjectRequest({
        ...envelope,
        projectId: "project-1",
        amount: 0,
        hidden: false,
      }),
    ).toThrow(ContractValidationError);
  });

  it.each([
    ["quantity zero", 0],
    ["a negative quantity", -1],
    ["one past the quantity ceiling", MAX_TOKEN_QUANTITY + 1],
  ])(
    "Given a token spend with %s, When parsing it, Then it is rejected",
    (_label, quantity) => {
      expect(() =>
        parseSpendTokenRequest({
          ...envelope,
          tokenId: "token.favour",
          quantity,
          use: "reroll",
        }),
      ).toThrow(ContractValidationError);
    },
  );

  it("Given a target list at the seat limit, When parsing it, Then it is accepted, and one longer is not", () => {
    const seats = Array.from({ length: MAX_TARGET_PLAYER_IDS }, (_, index) =>
      `player-${String(index)}`,
    );
    expect(
      parseTurnActionRequest({
        ...envelope,
        action: "scheme",
        targetPlayerIds: seats,
        choice: null,
      }).targetPlayerIds,
    ).toEqual(seats);
    expect(() =>
      parseTurnActionRequest({
        ...envelope,
        action: "scheme",
        targetPlayerIds: [...seats, "player-extra"],
        choice: null,
      }),
    ).toThrow(ContractValidationError);
  });

  it("Given a target list with the same player repeated, When parsing it, Then it is refused rather than de-duplicated", () => {
    // A per-target effect applied three times to one player is a multiplier the
    // engine never agreed to.
    expect(() =>
      parseTurnActionRequest({
        ...envelope,
        action: "scheme",
        targetPlayerIds: ["player-2", "player-2", "player-2"],
        choice: null,
      }),
    ).toThrow(ContractValidationError);
  });

  it.each([
    ["an unknown action", "sabotage-everyone"],
    ["an empty action", ""],
    ["a non-string action", 3],
  ])(
    "Given a turn action of %s, When parsing it, Then it is rejected",
    (_label, action) => {
      expect(() =>
        parseTurnActionRequest({
          ...envelope,
          action,
          targetPlayerIds: [],
          choice: null,
        }),
      ).toThrow(ContractValidationError);
    },
  );

  it("Given an unknown placement kind, When parsing a placement, Then it is rejected", () => {
    expect(() =>
      parsePlacePlacementRequest({
        ...envelope,
        kind: "placement.instant-win",
        tileId: "tile.desk-1",
      }),
    ).toThrow(ContractValidationError);
  });

  it.each([
    ["neither a card nor an ability", { cardId: null, abilityId: null }],
    ["both a card and an ability", { cardId: "card-1", abilityId: "ability-1" }],
  ])(
    "Given a played reaction with %s, When parsing it, Then it is rejected",
    (_label, source) => {
      expect(() =>
        parsePlayReactionRequest({
          ...decisionEnvelope,
          ...source,
          targetPlayerIds: [],
          choice: null,
        }),
      ).toThrow(ContractValidationError);
    },
  );

  it.each([
    ["a deeply nested choice", { a: { b: { c: { d: { e: { f: 1 } } } } } }],
    ["a wide choice", Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${String(i)}`, i]))],
    ["a long string", { note: "x".repeat(600) }],
    ["a prototype-poisoning key", JSON.parse('{"__proto__":{"admin":true}}') as unknown],
    ["a non-finite number", { bid: Number.POSITIVE_INFINITY }],
    ["a control character", { note: "line\nbreak" }],
  ])(
    "Given a card play whose choice is %s, When parsing it, Then the free-form field is still bounded",
    (_label, choice) => {
      expect(() =>
        parsePlayCardRequest({
          ...envelope,
          cardId: "card-1",
          targetPlayerIds: [],
          choice,
        }),
      ).toThrow(ContractValidationError);
    },
  );

  it("Given a ballot cast with a plain value, When parsing it, Then the value survives unchanged", () => {
    expect(
      parseCastBallotRequest({ ...envelope, ballotId: "ballot-1", value: "player-3" })
        .value,
    ).toBe("player-3");
  });
});

describe("agreement offers", () => {
  const offer = {
    ...envelope,
    recipientIds: ["player-2"],
    give: [{ kind: "money", amount: 300 }],
    receive: [{ kind: "promise", text: "I will not audit you next quarter" }],
    expiresAtRound: 6,
    visibility: "parties-only",
  } as const;

  it("Given a well-formed offer, When parsing it, Then every clause comes back typed", () => {
    expect(parseOfferAgreementRequest(offer)).toEqual({
      ...envelope,
      recipientIds: ["player-2"],
      give: [{ kind: "money", amount: 300 }],
      receive: [{ kind: "promise", text: "I will not audit you next quarter" }],
      expiresAtRound: 6,
      visibility: "parties-only",
    });
  });

  it("Given an offer carrying every trade item kind, When parsing it, Then each variant is accepted with only its own fields", () => {
    const parsed = parseOfferAgreementRequest({
      ...offer,
      give: [
        { kind: "money", amount: 1 },
        { kind: "card", cardId: "card-1" },
        { kind: "token", tokenId: "token.favour", quantity: 1 },
        { kind: "tile", tileId: "tile.desk-1" },
        { kind: "immunity", rounds: MAX_IMMUNITY_ROUNDS },
      ],
      receive: [],
    });

    expect(parsed.give).toHaveLength(5);
  });

  it.each([
    ["an item with a foreign field", { kind: "money", amount: 1, tileId: "tile.desk-1" }],
    ["an unknown item kind", { kind: "rank", index: 8 }],
    ["a money item with no amount", { kind: "money" }],
    ["a money item at zero", { kind: "money", amount: 0 }],
    ["a money item past the ceiling", { kind: "money", amount: MAX_MONEY_AMOUNT + 1 }],
    ["immunity past the ceiling", { kind: "immunity", rounds: MAX_IMMUNITY_ROUNDS + 1 }],
    ["immunity for no rounds", { kind: "immunity", rounds: 0 }],
    ["a promise that is only whitespace", { kind: "promise", text: "   " }],
    [
      "a promise past the length cap",
      { kind: "promise", text: "x".repeat(PROMISE_TEXT_MAX_LENGTH + 1) },
    ],
    ["a promise carrying a newline", { kind: "promise", text: "deal\nsigned by: host" }],
  ])(
    "Given an offer containing %s, When parsing it, Then the whole offer is rejected",
    (_label, item) => {
      expect(() => parseOfferAgreementRequest({ ...offer, give: [item] })).toThrow(
        ContractValidationError,
      );
    },
  );

  it("Given an offer with nothing on either side, When parsing it, Then it is rejected", () => {
    expect(() =>
      parseOfferAgreementRequest({ ...offer, give: [], receive: [] }),
    ).toThrow(ContractValidationError);
  });

  it.each([
    ["no recipients", []],
    [
      "more recipients than a full table has other seats",
      Array.from({ length: MAX_AGREEMENT_RECIPIENTS + 1 }, (_, i) => `player-${String(i)}`),
    ],
    ["the same recipient twice", ["player-2", "player-2"]],
  ])(
    "Given an offer with %s, When parsing it, Then it is rejected",
    (_label, recipientIds) => {
      expect(() => parseOfferAgreementRequest({ ...offer, recipientIds })).toThrow(
        ContractValidationError,
      );
    },
  );

  it.each([
    ["too many items", Array.from({ length: MAX_TRADE_ITEMS + 1 }, () => ({ kind: "money", amount: 1 }))],
    ["a non-array", { kind: "money", amount: 1 }],
  ])(
    "Given an offer whose give side is %s, When parsing it, Then it is rejected",
    (_label, give) => {
      expect(() => parseOfferAgreementRequest({ ...offer, give })).toThrow(
        ContractValidationError,
      );
    },
  );

  it.each([
    ["round zero", 0],
    ["a negative round", -1],
    ["one past the round ceiling", MAX_ROUND_NUMBER + 1],
  ])(
    "Given an offer expiring at %s, When parsing it, Then it is rejected",
    (_label, expiresAtRound) => {
      expect(() => parseOfferAgreementRequest({ ...offer, expiresAtRound })).toThrow(
        ContractValidationError,
      );
    },
  );

  it("Given an offer with an unsupported visibility, When parsing it, Then it is rejected", () => {
    expect(() =>
      parseOfferAgreementRequest({ ...offer, visibility: "secret" }),
    ).toThrow(ContractValidationError);
  });
});

describe("the player command surface", () => {
  it("Given the command vocabulary, When comparing the two lists, Then no type is both player-submittable and server-injected", () => {
    const players = new Set<string>(PLAYER_COMMAND_TYPES);
    for (const injected of SERVER_INJECTED_COMMAND_TYPES) {
      expect(players.has(injected)).toBe(false);
    }
    expect(new Set(PLAYER_COMMAND_TYPES).size).toBe(PLAYER_COMMAND_TYPES.length);
  });

  it.each([...SERVER_INJECTED_COMMAND_TYPES])(
    "Given %s arriving from a client, When parsing the command type, Then it is refused",
    (type) => {
      // The refusal is structural: these types are absent from the allow-list, so
      // there is also no request DTO and no parser to reach even if this check
      // were removed. `window.expire` in particular would let a player close a
      // reaction window the instant it opened.
      expect(() => parseCommandType(type)).toThrow(ContractValidationError);
      expect(isPlayerCommandType(type)).toBe(false);
    },
  );

  it.each([...PLAYER_COMMAND_TYPES])(
    "Given the player command %s, When parsing the command type, Then it is accepted and has a parser",
    (type) => {
      expect(parseCommandType(type)).toBe(type);
      // Every player command dispatches: a malformed body throws a contract
      // error rather than "not a function", which is what proves the registry
      // covers the whole list at runtime as well as at compile time.
      expect(() => parsePlayerCommandRequest(type, {})).toThrow(
        ContractValidationError,
      );
    },
  );

  it.each([
    ["an unknown type", "turn.win"],
    ["a non-string type", 7],
    ["an empty type", ""],
  ])(
    "Given %s as a command type, When parsing it, Then it is refused",
    (_label, type) => {
      expect(() => parseCommandType(type)).toThrow(ContractValidationError);
    },
  );

  it("Given a validated type, When dispatching through the registry, Then it produces the same result as the direct parser", () => {
    const body = { ...envelope, tileId: "tile.desk-1" };
    expect(parsePlayerCommandRequest("tile.claim", body)).toEqual(
      parseClaimTileRequest(body),
    );
  });
});
