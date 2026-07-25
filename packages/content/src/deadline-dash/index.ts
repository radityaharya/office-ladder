export { deadlineDashBoard } from "./board";
export { deadlineDashCharacters } from "./characters";
export { deadlineDashDecks } from "./decks";
export { deadlineDashModes } from "./modes";
export { deadlineDashRanks } from "./ranks";

import { deadlineDashBoard } from "./board";
import { deadlineDashCharacters } from "./characters";
import { deadlineDashDecks } from "./decks";
import { deadlineDashModes } from "./modes";
import { deadlineDashRanks } from "./ranks";

export const deadlineDashContent = {
  rulesetId: "deadline-dash-v3.2-normalized.1",
  board: deadlineDashBoard,
  modes: deadlineDashModes,
  ranks: deadlineDashRanks,
  characters: deadlineDashCharacters,
  decks: deadlineDashDecks,
} as const;
