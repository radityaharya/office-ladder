import { deadlineDashContent } from "../../content/deadline-dash";
import { createGame } from "./create-game";
import type { GameSetup, SetupResult } from "./types";

export function createDeadlineDashGame(
  setup: GameSetup,
  seed: string,
): SetupResult {
  return createGame(setup, seed, deadlineDashContent);
}
