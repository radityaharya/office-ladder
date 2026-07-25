import { describe, expect, it } from "vitest";

import {
  ContractValidationError,
  parseCreateRoomRequest,
  parseJoinRoomRequest,
  parseRollRequest,
  parseStartGameRequest,
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

    expect(create).toEqual({ mode: "mode.quick", capacity: 3, playerName: "Alex" });
    expect(join).toEqual({ roomCode: "AB12CD", playerName: "Sam" });
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
  ])(
    "Given a create or join body with an unknown field, When parsing it, Then exact-key validation rejects it",
    (parse, request) => {
      expect(() => parse(request)).toThrow(ContractValidationError);
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
