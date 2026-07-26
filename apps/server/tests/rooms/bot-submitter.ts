import {
  createBotCommandSubmitter,
  type BotCommandSubmitter,
} from "../../src/rooms/bots/bot-command-submitter";
import type { RoomRepository, RoomService } from "../../src/rooms/service/types";

/**
 * The bot driver's command transport, wired the way `default-driver.ts` wires it
 * but with the clock switched off.
 *
 * Every test that builds a driver needs one, and building it inline four times
 * would make the transport look like a test detail rather than the thing under
 * test. `turnTimeoutMs: 0` matches the harnesses' own room services: an armed
 * deadline in a test that is not about the clock is enforcement nobody asked for.
 */
export function botSubmitterFor(
  roomService: RoomService,
  repository: RoomRepository,
  options: { readonly now?: () => string; readonly turnTimeoutMs?: number } = {},
): BotCommandSubmitter {
  return createBotCommandSubmitter({
    roomService,
    repository,
    now: options.now ?? (() => "2026-07-26T12:00:00.000Z"),
    turnTimeoutMs: options.turnTimeoutMs ?? 0,
  });
}
