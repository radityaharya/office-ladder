export type MovementDirection = "forward" | "backward";

export interface MoveAroundBoardInput {
  position: number;
  spaces: number;
  boardSize: number;
  receptionistIndex?: number;
  direction?: MovementDirection;
}

export interface BoardMovementResult {
  /** Ordered positions entered during movement. The starting position is excluded. */
  path: readonly number[];
  destination: number;
  passedReceptionist: boolean;
  stoppedOnReceptionist: boolean;
  /** Salary awards earned through forward traversal. */
  receptionistSalaryAwards: number;
  /** Whether an exact stop may trigger Receptionist landing rewards. */
  receptionistLandingRewardEligible: boolean;
  /** Completed forward laps. Backward movement never increments laps. */
  laps: number;
}

function assertBoardIndex(value: number, boardSize: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value >= boardSize) {
    throw new RangeError(`${name} must be a valid board index`);
  }
}

export function moveAroundBoard({
  position,
  spaces,
  boardSize,
  receptionistIndex = 0,
  direction = "forward",
}: MoveAroundBoardInput): BoardMovementResult {
  if (!Number.isSafeInteger(boardSize) || boardSize < 1) {
    throw new RangeError("Board size must be a positive safe integer");
  }

  assertBoardIndex(position, boardSize, "Position");
  assertBoardIndex(receptionistIndex, boardSize, "Receptionist index");

  if (!Number.isSafeInteger(spaces) || spaces < 0) {
    throw new RangeError("Movement spaces must be a non-negative safe integer");
  }

  if (direction !== "forward" && direction !== "backward") {
    throw new RangeError("Movement direction must be forward or backward");
  }

  const step = direction === "forward" ? 1 : -1;
  const path: number[] = [];
  let current = position;

  for (let distance = 0; distance < spaces; distance += 1) {
    current = (current + step + boardSize) % boardSize;
    path.push(current);
  }

  const stoppedOnReceptionist =
    path.length > 0 && current === receptionistIndex;
  const receptionistVisits =
    direction === "forward"
      ? path.reduce(
          (count, boardIndex) =>
            count + (boardIndex === receptionistIndex ? 1 : 0),
          0,
        )
      : 0;

  return {
    path,
    destination: current,
    passedReceptionist:
      receptionistVisits > (stoppedOnReceptionist ? 1 : 0),
    stoppedOnReceptionist,
    receptionistSalaryAwards: receptionistVisits,
    receptionistLandingRewardEligible:
      direction === "forward" && stoppedOnReceptionist,
    laps: receptionistVisits,
  };
}
