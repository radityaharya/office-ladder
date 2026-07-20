export { deadlineDashBoard } from "./board";
export { deadlineDashCharacters } from "./characters";
export { deadlineDashModes } from "./modes";
export { deadlineDashRanks } from "./ranks";

import { deadlineDashBoard } from "./board";
import { deadlineDashCharacters } from "./characters";
import { deadlineDashModes } from "./modes";
import { deadlineDashRanks } from "./ranks";

export const deadlineDashContent = {
  rulesetId: "deadline-dash-v3.2-normalized.1",
  board: deadlineDashBoard,
  modes: deadlineDashModes,
  ranks: deadlineDashRanks,
  characters: deadlineDashCharacters,
} as const;
