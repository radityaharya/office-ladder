import type {
  AgreementState,
  BallotState,
  GameState,
  JsonValue,
  ModeRules,
  ObjectiveState,
  PlacementState,
  PlayerId,
  ProjectSabotage,
  ProjectState,
} from "../model";
import {
  cloneJsonObject,
  getCard,
  projectCard,
  projectOutcome,
  projectPublicPlayer,
  projectTurn,
} from "./shared";
import type {
  PublicAgreementProjection,
  PublicBallotProjection,
  PublicGameProjection,
  PublicObjectiveProjection,
  PublicPlacementProjection,
  PublicProjectProjection,
} from "./types";

/**
 * Who a projection is being built for.
 *
 * `null` is not "no filtering" — it is the *strictest* audience: the table, a
 * spectator, an unseated room member. Every predicate below is written so that
 * `null` sees only what is unconditionally public, which means the public view
 * is the same code path as a player view rather than a separate one somebody has
 * to remember to keep in step (spec §7.2).
 */
export type ProjectionViewer = PlayerId | null;

/**
 * The match's frozen ruleset is plain authored data — no ids, no functions, no
 * dates — so a structural round trip is both the cheapest and the most faithful
 * copy. Copying rather than aliasing keeps a projection consumer from mutating
 * canonical state through a shared reference.
 */
function cloneRules(rules: ModeRules): ModeRules {
  return JSON.parse(JSON.stringify(rules)) as ModeRules;
}

/**
 * An `owner-only` placement is visible to its owner and to nobody else.
 *
 * Note this is a predicate over *inclusion in the array*, never over which
 * fields get blanked: see `projectPlacements`.
 */
function isPlacementVisibleTo(
  placement: PlacementState,
  viewer: ProjectionViewer,
): boolean {
  return placement.visibility === "public" || placement.ownerId === viewer;
}

/**
 * A `parties-only` agreement is visible to the proposer and to every named
 * recipient. A third party does not learn that the two of them are talking.
 */
function isAgreementVisibleTo(
  agreement: AgreementState,
  viewer: ProjectionViewer,
): boolean {
  if (agreement.visibility === "public") {
    return true;
  }
  if (viewer === null) {
    return false;
  }
  return (
    agreement.proposerId === viewer || agreement.recipientIds.includes(viewer)
  );
}

/**
 * Hidden sabotage is invisible **until resolution** (spec §7.2). Three ways in:
 * the entry was never hidden, the viewer is the saboteur reading their own
 * handiwork back, or the project has resolved and the ledger is open.
 */
function isSabotageVisibleTo(
  entry: ProjectSabotage,
  project: ProjectState,
  viewer: ProjectionViewer,
): boolean {
  if (!entry.hidden) {
    return true;
  }
  if (project.status === "completed" || project.status === "failed") {
    return true;
  }
  return entry.playerId === viewer;
}

/**
 * A secret objective discloses its detail to its owner, and to everyone once it
 * has completed — a completed objective's reward is already public in the score
 * sheet (§5.6 `ScoreBreakdown.objectivePoints`), so withholding the definition
 * after the fact hides nothing and only makes the end screen unreadable. While
 * it is in flight it is existence-only to every other viewer.
 */
function isObjectiveDetailVisibleTo(
  objective: ObjectiveState,
  viewer: ProjectionViewer,
): boolean {
  if (objective.visibility !== "secret") {
    return true;
  }
  if (objective.completedAtRound !== null) {
    return true;
  }
  return objective.ownerId !== null && objective.ownerId === viewer;
}

function projectPlacement(placement: PlacementState): PublicPlacementProjection {
  return {
    id: placement.id,
    kind: placement.kind,
    tileId: placement.tileId,
    ownerId: placement.ownerId,
    charges: placement.charges,
    visibility: placement.visibility,
    placedAtRound: placement.placedAtRound,
    data: cloneJsonObject(placement.data),
  };
}

function projectProject(
  project: ProjectState,
  viewer: ProjectionViewer,
): PublicProjectProjection {
  return {
    id: project.id,
    definitionId: project.definitionId,
    leadPlayerId: project.leadPlayerId,
    tileId: project.tileId,
    status: project.status,
    requiredMoney: project.requiredMoney,
    requiredWork: project.requiredWork,
    contributedMoney: project.contributions.reduce(
      (total, contribution) => total + contribution.money,
      0,
    ),
    contributedWork: project.contributions.reduce(
      (total, contribution) => total + contribution.work,
      0,
    ),
    contributions: project.contributions.map((contribution) => ({
      playerId: contribution.playerId,
      money: contribution.money,
      work: contribution.work,
      atRound: contribution.atRound,
    })),
    // Hidden sabotage is omitted entirely, not summarised: knowing a project has
    // been sabotaged at all is most of what the lead would want to know (§7.2).
    sabotage: project.sabotage
      .filter((entry) => isSabotageVisibleTo(entry, project, viewer))
      .map((entry) => ({
        playerId: entry.playerId,
        amount: entry.amount,
        hidden: entry.hidden,
        atRound: entry.atRound,
      })),
    deadlineRound: project.deadlineRound,
    payout: { ...project.payout },
    openToJoin: project.openToJoin,
    leadBonusBasisPoints: project.leadBonusBasisPoints,
  };
}

function projectAgreement(
  agreement: AgreementState,
): PublicAgreementProjection {
  return {
    id: agreement.id,
    proposerId: agreement.proposerId,
    recipientIds: [...agreement.recipientIds],
    give: agreement.give.map((item) => ({ ...item })),
    receive: agreement.receive.map((item) => ({ ...item })),
    status: agreement.status,
    offeredAtRound: agreement.offeredAtRound,
    expiresAtRound: agreement.expiresAtRound,
    acceptedBy: [...agreement.acceptedBy],
    visibility: agreement.visibility,
  };
}

function projectObjective(
  objective: ObjectiveState,
  viewer: ProjectionViewer,
): PublicObjectiveProjection {
  const disclosed = isObjectiveDetailVisibleTo(objective, viewer);
  return {
    id: objective.id,
    ownerId: objective.ownerId,
    visibility: objective.visibility,
    completedAtRound: objective.completedAtRound,
    definitionId: disclosed ? objective.definitionId : null,
    progress: disclosed ? objective.progress : null,
    target: disclosed ? objective.target : null,
    rewardPoints: disclosed ? objective.rewardPoints : null,
    rewardMoney: disclosed ? objective.rewardMoney : null,
  };
}

function projectBallot(ballot: BallotState): PublicBallotProjection {
  // Sealed and still in flight: the *keys* of `castBy` are voter ids, so the
  // record is withheld wholesale rather than blanked — and it is withheld from
  // the casters too, because "who else has voted" is exactly the information a
  // sealed ballot exists to withhold. A viewer's own cast comes back through
  // `SelfProjection.ballotCasts`, which can only ever hold their own entry.
  const sealedInFlight =
    ballot.visibility === "sealed" && ballot.resolution === null;

  return {
    id: ballot.id,
    kind: ballot.kind,
    subjectId: ballot.subjectId,
    subject: cloneJsonObject(ballot.subject),
    audience: [...ballot.audience],
    deadlineAt: ballot.deadlineAt,
    closesAtRound: ballot.closesAtRound,
    visibility: ballot.visibility,
    castBy: sealedInFlight
      ? null
      : (cloneJsonObject(ballot.castBy) as Readonly<
          Record<string, JsonValue>
        >),
    castCount: Object.keys(ballot.castBy).length,
    resolution:
      ballot.resolution === null ? null : cloneJsonObject(ballot.resolution),
  };
}

/**
 * The whole board as one viewer is entitled to see it.
 *
 * This is the single redaction authority: `projectPublicView` is this function
 * with `viewer === null`, and `projectPlayerView` is this function plus the
 * viewer's own private additions. There is deliberately no "public plus extras"
 * merge step — a second pass that re-adds rows is a pass somebody can get
 * wrong in the other direction.
 */
export function projectGameView(
  state: GameState,
  viewer: ProjectionViewer,
): PublicGameProjection {
  return {
    status: state.status,
    revision: state.revision,
    turn: projectTurn(state.turn),
    boardSize: state.boardSize,
    rules: cloneRules(state.rules),
    players: state.playerOrder.map((playerId) => {
      const player = state.players[playerId];
      if (!player) {
        throw new Error(`Projection references unknown player: ${playerId}`);
      }
      return projectPublicPlayer(player);
    }),
    decks: Object.values(state.decks).map((deck) => ({
      id: deck.id,
      kind: deck.kind,
      drawCount: deck.drawPile.length,
      discardCount: deck.discardPile.length,
      visibleCards: deck.visibleCards.map((cardId) =>
        projectCard(getCard(state, cardId)),
      ),
    })),
    tileOwnership: Object.values(state.tileOwnership).map((ownership) => ({
      tileId: ownership.tileId,
      ownerId: ownership.ownerId,
      level: ownership.level,
      claimedAtRound: ownership.claimedAtRound,
      tollPaidCount: ownership.tollPaidCount,
    })),
    // Omission, not blanking: an `owner-only` placement is absent here entirely,
    // because a redacted placeholder still tells the table something is waiting.
    placements: state.placements
      .filter((placement) => isPlacementVisibleTo(placement, viewer))
      .map(projectPlacement),
    projects: state.projects.map((project) => projectProject(project, viewer)),
    agreements: state.agreements
      .filter((agreement) => isAgreementVisibleTo(agreement, viewer))
      .map(projectAgreement),
    objectives: state.objectives.map((objective) =>
      projectObjective(objective, viewer),
    ),
    ballots: state.ballots.map(projectBallot),
    quarters: state.quarters.map((quarter) => ({
      index: quarter.index,
      startedAtRound: quarter.startedAtRound,
      endsAtRound: quarter.endsAtRound,
      scheduledEventId: quarter.scheduledEventId,
      resolvedEventIds: [...quarter.resolvedEventIds],
    })),
    currentQuarterIndex: state.currentQuarterIndex,
    eliminatedPlayerIds: [...state.eliminatedPlayerIds],
    outcome: projectOutcome(state.outcome),
  };
}

/**
 * The view every spectator and unseated room member receives, and the floor
 * under every player view: nothing here is conditional on who is looking.
 */
export function projectPublicView(state: GameState): PublicGameProjection {
  return projectGameView(state, null);
}
