import { describe, expect, it } from "vitest";

import { commandRejectionLevel } from "../../src/rooms/service/rejection";
import type { RoomServiceErrorCode } from "../../src/rooms/service/types";

/**
 * The point of this classification is that "the client double-clicked" and "our
 * engine broke an invariant" stop looking identical in a log. The default matters
 * more than any individual entry: an unclassified code must be loud.
 */
describe("commandRejectionLevel", () => {
  it("Given a rejection a correct client can provoke, When classifying it, Then it is info", () => {
    const clientFaults: readonly RoomServiceErrorCode[] = [
      "STALE_REVISION",
      "NOT_ACTOR_TURN",
      "ROOM_FULL",
      "ROOM_NOT_OPEN",
      "ACTOR_NOT_MEMBER",
      "ACTOR_NOT_HOST",
      "MINIMUM_PLAYERS_NOT_MET",
      "ROOM_CODE_NOT_FOUND",
      "INVALID_PROMPT_RESPONSE",
      "INSUFFICIENT_RESOURCE",
    ];

    for (const code of clientFaults) {
      expect(commandRejectionLevel(code)).toBe("info");
    }
  });

  it("Given a rejection only this server can cause, When classifying it, Then it is warn", () => {
    const ourFaults: readonly RoomServiceErrorCode[] = [
      "INVARIANT_VIOLATION",
      "CONTENT_MISMATCH",
      "SERIALIZATION_FAILED",
      "RESOLUTION_CYCLE_DETECTED",
      "NO_PROGRESS_DETECTED",
      "RESOLUTION_DEPTH_EXCEEDED",
      "AUTHORIZED_STARTER_NOT_FOUND",
      "DUPLICATE_CHARACTER_ID",
    ];

    for (const code of ourFaults) {
      expect(commandRejectionLevel(code)).toBe("warn");
    }
  });

  it("Given an impersonation refusal, When classifying it, Then it is warn, because no honest client can produce one", () => {
    // A session actor naming a bot seat, or the driver naming a human seat.
    expect(commandRejectionLevel("ACTOR_IS_BOT")).toBe("warn");
    expect(commandRejectionLevel("ACTOR_NOT_BOT")).toBe("warn");
  });

  it("Given a code nobody has classified, When classifying it, Then it defaults to warn rather than to silence", () => {
    // The allow-list is deliberately the *quiet* side: adding an engine error
    // code without touching rejection.ts must make it loud, not invisible.
    expect(commandRejectionLevel("FRAME_LIMIT_EXCEEDED")).toBe("warn");
    expect(commandRejectionLevel("CHAINED_DRAW_LIMIT_EXCEEDED")).toBe("warn");
    expect(commandRejectionLevel("ROOM_CODE_UNAVAILABLE")).toBe("warn");
  });
});
