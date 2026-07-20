import { deadlineDashContent } from "@office-ladder/content";
import { createGame } from "./create-game";
import type { GameSetup, SetupResult } from "./types";

export function createDeadlineDashGame(
  setup: GameSetup,
  seed: string,
): SetupResult {
  return createGame(setup, seed, deadlineDashContent);
}
