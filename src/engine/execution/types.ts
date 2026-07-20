import type { deadlineDashContent } from "../../content/deadline-dash";
import type { GameEvent } from "../events";
import type { EngineResult, GameState, LogicalTimestamp } from "../model";
import type { RandomSource } from "../random";

export type TransitionContent = typeof deadlineDashContent;

export type TransitionContext = {
  readonly logicalTimestamp: LogicalTimestamp;
  readonly content: TransitionContent;
  readonly random?: RandomSource;
};

export type TransitionValue = {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
};

export type TransitionResult = EngineResult<TransitionValue>;
