import { describe, expect, it } from "vitest";

import {
  AVATAR_URL_MAX_LENGTH,
  BOT_DIFFICULTIES,
  ContractValidationError,
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
  SERVER_ACTOR_COMMAND_ID_PREFIXES,
} from "../src/rooms";

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
