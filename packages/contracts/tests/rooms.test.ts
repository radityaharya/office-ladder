import { describe, expect, it } from "vitest";

import {
  AVATAR_URL_MAX_LENGTH,
  BOT_DIFFICULTIES,
  ContractValidationError,
  DEFAULT_ROOM_MODE,
  isServerActorCommandId,
  parseAddBotRequest,
  parseAvatarUrl,
  parseCreateRoomRequest,
  parseJoinRoomRequest,
  parseRemoveBotRequest,
  parseRespondToPromptRequest,
  parseRollRequest,
  parseSelectCharacterRequest,
  parseStartGameRequest,
  ROOM_MODES,
  SERVER_ACTOR_COMMAND_ID_PREFIXES,
} from "../src/rooms";
import { validRules, withBlock } from "./fixtures/mode-rules";

describe("room API contracts", () => {
  it("Given valid room command bodies, When parsing them at the API boundary, Then each produces its typed request", () => {
    const create = parseCreateRoomRequest({
      mode: "mode.quick",
      capacity: 3,
      playerName: " Alex ",
    });
    const join = parseJoinRoomRequest({ roomCode: " ab12cd ", playerName: "Sam" });
    const start = parseStartGameRequest({
      commandId: "command-start-1",
      expectedRevision: 0,
    });
    const roll = parseRollRequest({
      commandId: "command-roll-1",
      expectedRevision: 1,
    });

    expect(create).toEqual({
      mode: "mode.quick",
      capacity: 3,
      playerName: "Alex",
      characterId: null,
      rules: null,
    });
    expect(join).toEqual({ roomCode: "AB12CD", playerName: "Sam", characterId: null });
    expect(start).toEqual({ commandId: "command-start-1", expectedRevision: 0 });
    expect(roll).toEqual({ commandId: "command-roll-1", expectedRevision: 1 });
  });

  it("Given a room command body with unknown fields, When parsing it at the API boundary, Then the request is rejected", () => {
    expect(() =>
      parseRollRequest({
        commandId: "command-roll-1",
        expectedRevision: 1,
        canonicalGame: "must-not-cross-api-boundary",
      }),
    ).toThrow(ContractValidationError);
  });

  it.each([
    [
      parseCreateRoomRequest,
      { mode: "mode.quick", capacity: 3, playerName: "Alex", extra: true },
    ],
    [parseJoinRoomRequest, { roomCode: "ABC123", playerName: "Sam", extra: true }],
    [parseAddBotRequest, { difficulty: "standard", extra: true }],
    [parseRemoveBotRequest, { memberId: "bot:room-1:0", extra: true }],
  ])(
    "Given a room body with an unknown field, When parsing it, Then exact-key validation rejects it",
    (parse, request) => {
      expect(() => parse(request)).toThrow(ContractValidationError);
    },
  );

  it("Given a create body with a character choice, When parsing it, Then the choice survives and an omitted one reads as no choice", () => {
    const chosen = parseCreateRoomRequest({
      mode: "mode.quick",
      capacity: 3,
      playerName: "Alex",
      characterId: "character.workaholic",
    });
    const declined = parseCreateRoomRequest({
      mode: "mode.quick",
      capacity: 3,
      playerName: "Alex",
      characterId: null,
    });

    expect(chosen.characterId).toBe("character.workaholic");
    // The whole point of the optional key: a client that predates the field is
    // still a valid client, and reads identically to one that opted out.
    expect(declined.characterId).toBeNull();
  });

  it("Given a join body with a character choice, When parsing it, Then the room code is still normalized alongside it", () => {
    const join = parseJoinRoomRequest({
      roomCode: " ab12cd ",
      playerName: "Sam",
      characterId: "character.sales-star",
    });

    expect(join).toEqual({
      roomCode: "AB12CD",
      playerName: "Sam",
      characterId: "character.sales-star",
    });
  });

  it.each([
    ["a non-string character id", { characterId: 7 }],
    ["a character id with a space", { characterId: "character workaholic" }],
  ])(
    "Given a create body with %s, When parsing it, Then the request is rejected rather than silently ignored",
    (_label, character) => {
      expect(() =>
        parseCreateRoomRequest({
          mode: "mode.quick",
          capacity: 3,
          playerName: "Alex",
          ...character,
        }),
      ).toThrow(ContractValidationError);
    },
  );

  it.each([
    ["an empty string", ""],
    ["a whitespace-only string", "   "],
  ])(
    "Given a create body whose character id is %s, When parsing it, Then it reads as no choice rather than a 400",
    (_label, characterId) => {
      // An unselected <select> submits "". Refusing it would make "the player
      // skipped the picker" — the exact case this optional field exists for —
      // fail the request, so it is normalized to the same value an omitted key
      // produces.
      expect(
        parseCreateRoomRequest({
          mode: "mode.quick",
          capacity: 3,
          playerName: "Alex",
          characterId,
        }).characterId,
      ).toBeNull();
      expect(
        parseJoinRoomRequest({ roomCode: "AB12CD", playerName: "Sam", characterId })
          .characterId,
      ).toBeNull();
      // The lobby's re-pick endpoint reads it the same way, so an unselected
      // picker clears the claim instead of erroring.
      expect(parseSelectCharacterRequest({ characterId }).characterId).toBeNull();
    },
  );

  it("Given a select-character body, When parsing it, Then a chosen id and an explicit clear are both accepted", () => {
    expect(parseSelectCharacterRequest({ characterId: "character.tech-genius" })).toEqual({
      characterId: "character.tech-genius",
    });
    expect(parseSelectCharacterRequest({ characterId: null })).toEqual({
      characterId: null,
    });
  });

  it.each([
    ["no character key at all", {}],
    ["an unknown extra field", { characterId: null, seat: 2 }],
  ])(
    "Given a select-character body with %s, When parsing it, Then it is rejected",
    (_label, request) => {
      expect(() => parseSelectCharacterRequest(request)).toThrow(ContractValidationError);
    },
  );

  it("Given a room command body with a stale revision shape, When parsing it at the API boundary, Then the request is rejected", () => {
    expect(() =>
      parseStartGameRequest({
        commandId: "command-start-1",
        expectedRevision: -1,
      }),
    ).toThrow(ContractValidationError);
  });
});

describe("room modes", () => {
  it("Given the shipped content pack, When reading the selectable modes, Then all four presets are offered in lobby order", () => {
    // Read off `packages/content/src/deadline-dash/modes.ts`, in its own
    // declaration order, which is also ascending session length and therefore the
    // order a lobby should list them in. Written out rather than derived: this
    // package has no dependency on the content pack (see ROOM_MODES' docstring),
    // so this literal *is* the mirror, and a test that computed it from the same
    // constant it is checking would prove nothing.
    expect(ROOM_MODES).toEqual([
      "mode.quick",
      "mode.standard",
      "mode.marathon",
      "mode.campaign",
    ]);
    // A custom ruleset is not a preset: it rides on one of the four above and
    // replaces that preset's rules block. Admitting a `mode.custom` id here would
    // also demand a rank-cost column the content pack does not have.
    expect(ROOM_MODES).not.toContain("mode.custom");
  });

  it("Given spec §4.2's stated default, When reading it, Then the lobby's pre-selection is Standard and is a real mode", () => {
    expect(DEFAULT_ROOM_MODE).toBe("mode.standard");
    expect(ROOM_MODES).toContain(DEFAULT_ROOM_MODE);
  });

  it.each(ROOM_MODES)(
    "Given a create body naming %s, When parsing it, Then the room can actually be created in that preset",
    (mode) => {
      // The point of the whole change: before it, two of these four were
      // unrepresentable, so `mode.standard` — the intended default — could not be
      // validated, let alone played.
      expect(
        parseCreateRoomRequest({ mode, capacity: 4, playerName: "Alex" }),
      ).toEqual({
        mode,
        capacity: 4,
        playerName: "Alex",
        characterId: null,
        rules: null,
      });
    },
  );

  it.each([
    ["a custom-mode id, which is a ruleset and not a preset", "mode.custom"],
    ["an id the content pack does not ship", "mode.endless"],
    ["a bare preset name with no namespace", "quick"],
    ["a differently-cased id", "MODE.QUICK"],
    ["an id with trailing whitespace, which is not normalized away", "mode.quick "],
    ["a non-string", 7],
    ["null", null],
  ])(
    "Given a create body whose mode is %s, When parsing it, Then it is rejected",
    (_label, mode) => {
      expect(() =>
        parseCreateRoomRequest({ mode, capacity: 4, playerName: "Alex" }),
      ).toThrow(ContractValidationError);
    },
  );
});

describe("create-room with a custom ruleset", () => {
  const base = { mode: "mode.standard", capacity: 4, playerName: "Alex" } as const;

  it("Given a create body with no rules key, When parsing it, Then the room plays its preset untouched", () => {
    // The load-bearing property for "the shipped presets stay byte-identical":
    // contracts hands the server a `null`, so there is nothing for it to
    // substitute and `resolveModeRules` returns the preset's own object. An
    // absent key and an explicit null are the same fact, so a client that
    // predates custom modes is still a valid client.
    expect(parseCreateRoomRequest(base).rules).toBeNull();
    expect(parseCreateRoomRequest({ ...base, rules: null }).rules).toBeNull();
    expect(parseCreateRoomRequest({ ...base, rules: undefined }).rules).toBeNull();
    expect(parseCreateRoomRequest({ ...base, rules: null })).toEqual(
      parseCreateRoomRequest(base),
    );
  });

  it("Given a create body carrying a complete ruleset, When parsing it, Then it survives field for field alongside the mode", () => {
    const request = parseCreateRoomRequest({ ...base, rules: validRules() });

    expect(request.rules).toEqual(validRules());
    // `mode` stays meaningful when rules are supplied: the ruleset replaces only
    // the preset's rules block, and the preset still supplies starting
    // resources, token caps, the board and the per-mode rank costs.
    expect(request.mode).toBe("mode.standard");
  });

  it("Given a create body that has been through the wire, When parsing it, Then it round trips", () => {
    const sent = { ...base, characterId: "character.workaholic", rules: validRules() };
    const received: unknown = JSON.parse(JSON.stringify(sent));

    const once = parseCreateRoomRequest(received);
    // Re-parsing the parser's own output must be a no-op: the server persists
    // this object and re-validates it on the way back out of storage, so a
    // ruleset that only survives one pass would fail on reload.
    const twice = parseCreateRoomRequest(JSON.parse(JSON.stringify(once)));

    expect(once).toEqual({
      mode: "mode.standard",
      capacity: 4,
      playerName: "Alex",
      characterId: "character.workaholic",
      rules: validRules(),
    });
    expect(twice).toEqual(once);
  });

  it.each([
    [
      "an unbounded pip adjustment, which lets a player select their roll",
      withBlock("agency", { maxPipAdjust: 12 }),
    ],
    [
      "a negative interest rate, which turns a loan into a grant",
      withBlock("economy", { interestBasisPoints: -5_000 }),
    ],
    [
      "an all-false winPaths, which makes the match unwinnable",
      withBlock("winPaths", {
        promotion: false,
        wealth: false,
        influence: false,
        survival: false,
      }),
    ],
    [
      "a short upkeep ladder, which makes the top ranks rent-free",
      withBlock("economy", { upkeepByRankIndex: [0, 50, 100] }),
    ],
    [
      "an over-long upkeep ladder, which hides charges nobody saw in the lobby",
      withBlock("economy", { upkeepByRankIndex: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }),
    ],
    [
      "a turn clock short enough to hand every turn to the timeout driver",
      withBlock("timers", { turnSeconds: 0 }),
    ],
    [
      "direct messages switched on, which are not a v1 feature",
      withBlock("social", { directMessages: true }),
    ],
  ])(
    "Given a create body whose ruleset carries %s, When parsing it, Then the whole request is refused",
    (_label, rules) => {
      expect(() => parseCreateRoomRequest({ ...base, rules })).toThrow(
        ContractValidationError,
      );
      // ...and the create itself was fine. So the ruleset is what killed it, and
      // the failure mode is a refusal rather than a room quietly created under
      // the preset the host did not ask for.
      expect(() => parseCreateRoomRequest(base)).not.toThrow();
    },
  );

  it("Given a create body whose ruleset is missing fields, When parsing it, Then it is refused rather than filled in from the preset", () => {
    // This is the replace-versus-overlay decision made observable. A partial
    // ruleset is not a friendlier request, it is an unanswerable one: contracts
    // cannot see the preset it would be merging into, so an omitted field would
    // have to be invented here. The lobby composes the complete object client-side
    // from the preset's own rules and posts that.
    const missingBlock: Record<string, unknown> = { ...validRules() };
    delete missingBlock["economy"];

    expect(() => parseCreateRoomRequest({ ...base, rules: missingBlock })).toThrow(
      ContractValidationError,
    );
    expect(() =>
      parseCreateRoomRequest({
        ...base,
        rules: withBlock("agency", { maxPipAdjust: undefined }),
      }),
    ).toThrow(ContractValidationError);
    // An empty object is a ruleset that agreed to nothing — refused, unlike an
    // empty *string* character id, which is read as "skipped the picker" because
    // an empty string cannot name a character and so is never ambiguous.
    expect(() => parseCreateRoomRequest({ ...base, rules: {} })).toThrow(
      ContractValidationError,
    );
    expect(parseCreateRoomRequest({ ...base, characterId: "" }).characterId).toBeNull();
  });

  it.each([
    ["a string", "mode.marathon"],
    ["a number", 1],
    ["an array of rulesets", [validRules()]],
    ["a boolean", true],
  ])(
    "Given a create body whose rules field is %s, When parsing it, Then it is rejected",
    (_label, rules) => {
      expect(() => parseCreateRoomRequest({ ...base, rules })).toThrow(
        ContractValidationError,
      );
    },
  );

  it("Given a ruleset carrying a field this build does not read, When parsing it, Then the request is refused outright", () => {
    // Not silently dropped: an unknown key is either a client this server does
    // not understand or an attempt to seed a field a *later* build will start
    // reading out of the stored blob. Both are worth a 400.
    expect(() =>
      parseCreateRoomRequest({ ...base, rules: { ...validRules(), cheatMode: true } }),
    ).toThrow(ContractValidationError);
    expect(() =>
      parseCreateRoomRequest({
        ...base,
        rules: withBlock("agency", { unlimitedActions: true }),
      }),
    ).toThrow(ContractValidationError);
  });

  it("Given a room played on a different rank ladder, When parsing a create body for it, Then the upkeep table is validated against that ladder", () => {
    // The server passes the content pack's real ladder length, which is the value
    // that actually binds; the mirrored constant in mode-rules.ts is only the
    // fallback. A three-rank pack must not be validated against a nine-rank table.
    const rules = withBlock("economy", {
      upkeepByRankIndex: [0, 100, 250],
      promotionCostByRankIndex: [0, 500, 900],
    });

    expect(() => parseCreateRoomRequest({ ...base, rules })).toThrow(
      ContractValidationError,
    );
    expect(
      parseCreateRoomRequest({ ...base, rules }, { rankLadderLength: 3 }).rules?.economy
        .upkeepByRankIndex,
    ).toEqual([0, 100, 250]);
  });

  it("Given a create body with a ruleset and an unknown top-level field, When parsing it, Then the unknown field is still refused", () => {
    // The optional `rules` key must not become a hole in the exact-key check that
    // guards everything beside it.
    expect(() =>
      parseCreateRoomRequest({ ...base, rules: validRules(), autoStart: true }),
    ).toThrow(ContractValidationError);
  });

  it("Given a create body with a ruleset but no mode, When parsing it, Then it is refused because a ruleset is not a mode", () => {
    // A custom ruleset replaces the preset's *rules*, not the preset. Everything
    // outside `ModeRules` — starting resources, token caps, hand limit, rank
    // costs — still comes from the named mode, so there is no such thing as a
    // room with rules and no mode.
    const withoutMode: Record<string, unknown> = { ...base };
    delete withoutMode["mode"];

    expect(() => parseCreateRoomRequest({ ...withoutMode, rules: validRules() })).toThrow(
      ContractValidationError,
    );
  });
});

describe("member avatar URL validation", () => {
  it("Given an https avatar URL, When validating it, Then it is accepted in canonical form", () => {
    expect(parseAvatarUrl("https://cdn.example.com/a/avatar.png?v=2")).toBe(
      "https://cdn.example.com/a/avatar.png?v=2",
    );
    // WHATWG canonicalization: what is stored must not depend on which of
    // several equivalent spellings the provider happened to use.
    expect(parseAvatarUrl("  https://CDN.example.com  ")).toBe("https://cdn.example.com/");
  });

  it("Given a root-relative path, When validating it, Then it is accepted for a future same-origin upload", () => {
    expect(parseAvatarUrl("/avatars/member-1.png")).toBe("/avatars/member-1.png");
  });

  it.each([
    ["a javascript: URL", "javascript:alert(1)"],
    ["an uppercased javascript: URL", "JavaScript:alert(1)"],
    ["a data: URL", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="],
    ["a blob: URL", "blob:https://example.com/1234"],
    ["a file: URL", "file:///etc/passwd"],
    ["a vbscript: URL", "vbscript:msgbox(1)"],
    ["plain http", "http://cdn.example.com/a.png"],
    ["a protocol-relative URL", "//evil.example.com/a.png"],
    ["a backslash-escaped protocol-relative URL", "/\\evil.example.com/a.png"],
    ["credentials in the authority", "https://user:secret@cdn.example.com/a.png"],
    ["a username with no password", "https://user@cdn.example.com/a.png"],
    ["a relative path with no leading slash", "avatars/member-1.png"],
    ["an empty string", ""],
    ["whitespace only", "   "],
    ["a non-string", 42],
    ["null", null],
    ["undefined", undefined],
  ])(
    "Given %s as a stored avatar, When validating it, Then it degrades to no avatar instead of reaching an img src",
    (_label, value) => {
      expect(parseAvatarUrl(value)).toBeNull();
    },
  );

  it("Given an avatar URL carrying a newline, When validating it, Then it is refused", () => {
    // A URL is pre-encoded by definition, and an unencoded control character is
    // exactly what a header- or markup-injection attempt looks like.
    expect(parseAvatarUrl("https://cdn.example.com/a.png\nX-Evil: 1")).toBeNull();
    expect(parseAvatarUrl("https://cdn.example.com/a .png")).toBeNull();
  });

  it.each([
    ["a NUL byte", "https://cdn.example.com/a\u0000.png"],
    ["a carriage return", "https://cdn.example.com/a\r\nX-Evil: 1"],
    ["a DEL character", "https://cdn.example.com/a\u007f.png"],
    ["a C1 control", "https://cdn.example.com/a\u0085.png"],
    ["a non-breaking space", "https://cdn.example.com/a\u00a0b.png"],
    ["a line separator", "https://cdn.example.com/a\u2028b.png"],
    ["an ideographic space", "https://cdn.example.com/a\u3000b.png"],
  ])(
    "Given an avatar URL containing %s, When validating it, Then it is refused",
    (_label, value) => {
      // Pins the whole refused set — whitespace, C0, DEL and C1 — because the
      // check is a code-point scan rather than a character class, and a rewrite
      // that quietly narrowed it to ASCII would still pass the newline case above.
      expect(parseAvatarUrl(value)).toBeNull();
    },
  );

  it.each([
    ["a double quote in a root-relative path", '/avatars/a.png"onerror=alert(1)'],
    ["a single quote in a root-relative path", "/avatars/a.png'onerror=alert(1)"],
    ["an angle bracket in a root-relative path", "/avatars/a.png><script>"],
    ["a backtick in a root-relative path", "/avatars/a.png`x"],
    ["a backslash in a root-relative path", "/avatars\\a.png"],
    ["a double quote in an https URL", 'https://cdn.example.com/a.png"x'],
  ])(
    "Given an avatar URL containing %s, When validating it, Then it is refused",
    (_label, value) => {
      // The root-relative branch returns the caller's string verbatim, so an
      // attribute-terminating character has to be refused here rather than relied
      // on being escaped downstream: `<img src="/a.png"onerror=…>` executes,
      // because browsers recover from the missing separator by starting a new
      // attribute. The https case is included so the two branches cannot diverge.
      expect(parseAvatarUrl(value)).toBeNull();
    },
  );

  it("Given an over-long avatar URL, When validating it, Then it is refused rather than truncated", () => {
    const tooLong = `https://cdn.example.com/${"a".repeat(AVATAR_URL_MAX_LENGTH)}.png`;

    expect(tooLong.length).toBeGreaterThan(AVATAR_URL_MAX_LENGTH);
    expect(parseAvatarUrl(tooLong)).toBeNull();
    expect(parseAvatarUrl(`https://cdn.example.com/${"a".repeat(64)}.png`)).not.toBeNull();
  });
});

describe("bot seat contracts", () => {
  it.each(BOT_DIFFICULTIES)(
    "Given the supported difficulty %s, When parsing an add-bot body, Then it produces the typed request",
    (difficulty) => {
      expect(parseAddBotRequest({ difficulty })).toEqual({ difficulty });
    },
  );

  it.each([
    ["an unsupported difficulty", { difficulty: "nightmare" }],
    ["a differently-cased difficulty", { difficulty: "Standard" }],
    ["a non-string difficulty", { difficulty: 2 }],
    ["a null difficulty", { difficulty: null }],
    ["no difficulty at all", {}],
  ])(
    "Given an add-bot body with %s, When parsing it, Then the request is rejected",
    (_label, request) => {
      expect(() => parseAddBotRequest(request)).toThrow(ContractValidationError);
    },
  );

  it("Given a real bot member id, When parsing a remove-bot body, Then the colon-separated id survives unchanged", () => {
    const memberId = "bot:11111111-2222-3333-4444-555555555555:0";

    expect(parseRemoveBotRequest({ memberId })).toEqual({ memberId });
  });

  it.each([
    ["a percent-encoded id", { memberId: "bot%3Aroom-1%3A0" }],
    ["an id with a space", { memberId: "bot room 0" }],
    ["an empty id", { memberId: "" }],
    ["a non-string id", { memberId: 7 }],
    ["no member id at all", {}],
  ])(
    "Given a remove-bot body with %s, When parsing it, Then the request is rejected",
    (_label, request) => {
      expect(() => parseRemoveBotRequest(request)).toThrow(ContractValidationError);
    },
  );

  it.each([
    ["null", null],
    ["an array", []],
    ["a string", "standard"],
    ["a number", 1],
  ])(
    "Given %s instead of an object, When parsing either bot body, Then both parsers reject it like their siblings",
    (_label, request) => {
      expect(() => parseAddBotRequest(request)).toThrow(ContractValidationError);
      expect(() => parseRemoveBotRequest(request)).toThrow(ContractValidationError);
    },
  );
});

/**
 * The command-id namespace the server's own background actors own.
 *
 * This guard landed with no tests at all, which for a refusal is the dangerous
 * kind of untested: reverting `parseCommandId` to a bare `parseOpaqueId` would
 * keep every other test in this file green while restoring a one-request freeze
 * of any match containing a bot. The positive controls matter as much as the
 * refusals — a guard that rejected *every* command id would also satisfy a suite
 * that only ever checks that bad input throws.
 */
describe("reserved server-actor command ids", () => {
  const commandParsers = [
    ["start", parseStartGameRequest, {}],
    ["roll", parseRollRequest, {}],
    [
      "respond",
      parseRespondToPromptRequest,
      { decisionPointId: "decision-audit-release", optionId: "attempt-roll" },
    ],
  ] as const;

  it.each(commandParsers)(
    "Given a %s body whose command id impersonates a server actor, When parsing it, Then it is refused for every reserved prefix",
    (_label, parse, extra) => {
      // Driven off the exported list, so adding a third server actor without
      // reserving its prefix fails here rather than in production.
      for (const prefix of SERVER_ACTOR_COMMAND_ID_PREFIXES) {
        // Exactly the shape both drivers mint: <prefix><gameId>:<revision>:<kind>.
        expect(() =>
          parse({ commandId: `${prefix}game-abc:7:roll`, expectedRevision: 7, ...extra }),
        ).toThrow(ContractValidationError);
      }
    },
  );

  it.each(commandParsers)(
    "Given a %s body with an ordinary client command id, When parsing it, Then it is accepted unchanged",
    (_label, parse, extra) => {
      // The positive control: apps/web mints crypto.randomUUID().
      const commandId = "11111111-2222-3333-4444-555555555555";

      expect(parse({ commandId, expectedRevision: 3, ...extra })).toMatchObject({
        commandId,
      });
    },
  );

  it("Given a command id that merely contains a reserved prefix, When parsing it, Then it is still accepted", () => {
    // Anchored, not a substring match: refusing anything containing "bot:"
    // anywhere would reject ids no driver could ever collide with.
    for (const commandId of ["robot:1:2:roll", "x-bot:1", "a.timeout:9"]) {
      expect(parseRollRequest({ commandId, expectedRevision: 1 })).toEqual({
        commandId,
        expectedRevision: 1,
      });
    }
  });

  it("Given a differently-cased reserved prefix, When parsing it, Then it is refused too", () => {
    for (const commandId of ["BOT:game-abc:7:roll", "Timeout:game-abc:7:roll"]) {
      expect(() => parseRollRequest({ commandId, expectedRevision: 7 })).toThrow(
        ContractValidationError,
      );
    }
  });

  it("Given a refused command id, When the error is reported, Then it names the offending field", () => {
    // The route layer logs `field` from this error; "commandId" is what makes the
    // line actionable rather than just another opaque 400.
    try {
      parseRollRequest({ commandId: "bot:game-abc:7:roll", expectedRevision: 7 });
      throw new Error("a reserved command id must not parse");
    } catch (error) {
      expect(error).toBeInstanceOf(ContractValidationError);
      expect((error as ContractValidationError).path).toBe("commandId");
    }
  });

  it("Given the predicate directly, When it classifies ids, Then it answers for the real driver shapes and nothing else", () => {
    expect(isServerActorCommandId("bot:game-abc:7:roll")).toBe(true);
    expect(isServerActorCommandId("timeout:game-abc:7:respond")).toBe(true);
    expect(isServerActorCommandId("11111111-2222-3333-4444-555555555555")).toBe(false);
    expect(isServerActorCommandId("robot:game-abc:7:roll")).toBe(false);
  });
});
