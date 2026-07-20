import { describe, expect, it } from "vitest";

import {
  ContractValidationError,
  parseCreateRoomRequest,
  parseJoinRoomRequest,
  parseRollRequest,
  parseStartGameRequest,
} from "../../src/contracts/rooms";

describe("room API contracts", () => {
  it("Given valid room command bodies, When parsing them at the API boundary, Then each produces its typed request", () => {
    const create = parseCreateRoomRequest({ mode: "mode.quick", capacity: 3 });
    const join = parseJoinRoomRequest({ roomCode: " ab12cd " });
    const start = parseStartGameRequest({
      commandId: "command-start-1",
      expectedRevision: 0,
    });
    const roll = parseRollRequest({
      commandId: "command-roll-1",
      expectedRevision: 1,
    });

    expect(create).toEqual({ mode: "mode.quick", capacity: 3 });
    expect(join).toEqual({ roomCode: "AB12CD" });
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

  it("Given a room command body with a stale revision shape, When parsing it at the API boundary, Then the request is rejected", () => {
    expect(() =>
      parseStartGameRequest({
        commandId: "command-start-1",
        expectedRevision: -1,
      }),
    ).toThrow(ContractValidationError);
  });
});
