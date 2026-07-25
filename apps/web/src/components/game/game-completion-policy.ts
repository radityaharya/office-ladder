import type { PublicGameProjection } from "@office-ladder/contracts";

type GameCompletionState = {
  readonly status: PublicGameProjection["status"];
  readonly projectionRevision: number;
  readonly feedbackCompleteRevision: number | null;
};

export function shouldShowGameWinner(completion: GameCompletionState): boolean {
  return completion.status === "ended"
    && completion.feedbackCompleteRevision === completion.projectionRevision;
}
