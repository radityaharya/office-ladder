import type { RollTurnCommand } from "../commands";
import type {
  DiceRolledEvent,
  GameEvent,
  PlayerMovedEvent,
  ResourceChangedEvent,
  SalaryAwardedEvent,
  TileResolvedEvent,
} from "../events";
import type { GameState, PlayerState, TileId } from "../model";
import type { BoardMovementResult } from "../rules";
import { createEventMetadata } from "./events";
import type { SalaryResolution } from "./roll-salary";
import type { TransitionContext } from "./types";

export type RollEventInput = {
  readonly state: GameState;
  readonly command: RollTurnCommand;
  readonly context: TransitionContext;
  readonly player: PlayerState;
  readonly die: number;
  /**
   * Spaces actually traversed, which is the die adjusted by any movement
   * status the player carries. `die` stays the raw face for DiceRolled.
   */
  readonly spaces: number;
  readonly rngCursor: number;
  readonly movement: BoardMovementResult;
  readonly salary: SalaryResolution;
  /**
   * Money actually credited, which is `salary.amount` after any
   * `status.next-salary-multiplier` the player held. `salary.amount` stays the
   * unmultiplied rank figure; reporting *that* would leave a client summing
   * SalaryAwarded permanently out of step with canonical money.
   */
  readonly awardedSalary: number;
  readonly tileId: TileId;
};

export function createRollEvents(input: RollEventInput): readonly GameEvent[] {
  const events: GameEvent[] = [];
  const metadata = () =>
    createEventMetadata(
      input.state,
      input.command,
      input.context.logicalTimestamp,
      input.state.eventSequence + events.length + 1,
    );
  const diceRolled: DiceRolledEvent = {
    ...metadata(),
    type: "DiceRolled",
    payload: {
      playerId: input.player.id,
      dice: [input.die],
      total: input.die,
      purpose: "normal-movement",
      rngStream: "dice",
      rngCursor: input.rngCursor,
    },
  };
  events.push(diceRolled);
  const playerMoved: PlayerMovedEvent = {
    ...metadata(),
    type: "PlayerMoved",
    payload: {
      playerId: input.player.id,
      from: input.player.position,
      to: input.movement.destination,
      distance: input.spaces,
      direction: "forward",
      lapsGained: input.movement.laps,
    },
  };
  events.push(playerMoved);

  if (input.salary.amount > 0) {
    const salaryAwarded: SalaryAwardedEvent = {
      ...metadata(),
      type: "SalaryAwarded",
      payload: {
        playerId: input.player.id,
        amount: input.awardedSalary,
        rankId: input.salary.rankId,
      },
    };
    events.push(salaryAwarded);
    const resourceChanged: ResourceChangedEvent = {
      ...metadata(),
      type: "ResourceChanged",
      payload: {
        playerId: input.player.id,
        resourceId: input.salary.moneyResource.id,
        previousValue: input.salary.moneyResource.value,
        newValue: input.salary.moneyResource.value + input.awardedSalary,
        reason: "salary",
      },
    };
    events.push(resourceChanged);
  }

  const tileResolved: TileResolvedEvent = {
    ...metadata(),
    type: "TileResolved",
    payload: {
      playerId: input.player.id,
      tileId: input.tileId,
      position: input.movement.destination,
    },
  };
  events.push(tileResolved);
  return events;
}
