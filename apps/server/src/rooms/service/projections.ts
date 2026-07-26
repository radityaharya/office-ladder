import {
  toLegalActionSummary,
  type BallotProjection,
  type CallerSelfProjection,
  type GameplayBootstrap,
  type GameplayProjection,
  type LegalActionAgreementTerms,
  type LegalActionBallotTerms,
  type LegalActionContext,
  type LegalActionSummary,
  type OwnPlacementProjection,
  type OwnProjectSabotageProjection,
  type PartyAgreementProjection,
  type PublicAgreementProjection,
  type PublicGameProjection,
  type PublicObjectiveProjection,
  type PublicPlacementProjection,
  type PublicPlayerGameplayProjection,
  type PublicProjectProjection,
  type RevealedProjectSabotageProjection,
  type RoomProjection,
  type RoomBootstrap,
  type SelfObjectiveProjection,
  type TradeItem,
} from "@office-ladder/contracts";
import {
  enumerateLegalActions,
  projectPlayerView,
  projectPublicView,
  type JsonObject,
  type JsonValue,
  type PlayerGameProjection,
  type PlayerId,
  type PublicBallotProjection,
  type PublicObjectiveProjection as EnginePublicObjectiveProjection,
  type PublicProjectProjection as EnginePublicProjectProjection,
  type TradeItem as EngineTradeItem,
} from "@office-ladder/engine";
import { botSeatFor } from "@/rooms/bots/bot-seats";
import {
  characterLabel,
  characterOptions,
  claimedCharacters,
} from "@/rooms/characters";
import { isTurnTimerCurrent } from "@/rooms/turn-timer/turn-timer";
import type { StoredRoom } from "./types";

/**
 * Which character each member should be shown as playing.
 *
 * Before the match starts this is what they actually *claimed* — never the
 * fallback the setup would eventually give them, because a picker pre-filled with
 * an assignment nobody chose is indistinguishable from the choice being ignored.
 * Once a game exists, the canonical state is the only truthful answer: it is what
 * the engine assigned, fallbacks included, and it cannot be changed any more.
 */
function memberCharacterIds(room: StoredRoom): ReadonlyMap<PlayerId, string> {
  const game = room.game;
  if (game === null) return claimedCharacters(room.memberIds, room.memberCharacters);
  const assigned = new Map<PlayerId, string>();
  for (const memberId of room.memberIds) {
    const characterId = game.players[memberId]?.characterId;
    if (characterId !== undefined) assigned.set(memberId, characterId);
  }
  return assigned;
}

export function roomProjection(room: StoredRoom): RoomProjection {
  const characters = memberCharacterIds(room);

  return {
    id: room.id,
    code: room.code,
    status: room.status,
    mode: room.modeId,
    capacity: room.capacity,
    revision: room.revision,
    // Bots are ordinary members: they occupy a real seat in memberIds. The
    // StoredRoom.bots array is the only authority on which of them are bots —
    // never the id shape.
    members: room.memberIds.map((memberId, seat) => {
      const botSeat = botSeatFor(room, memberId);
      const characterId = characters.get(memberId) ?? null;
      return {
        id: memberId,
        displayName: room.memberNames[memberId] ?? memberId,
        seat,
        isHost: memberId === room.hostId,
        isReady: true,
        isConnected: true,
        isBot: botSeat !== null,
        botDifficulty: botSeat?.difficulty ?? null,
        // A bot seat has no user row, so it has no avatar to show; the map is
        // keyed by member id and simply never contains one.
        avatarUrl: room.memberAvatars[memberId] ?? null,
        characterId,
        characterLabel: characterId === null ? null : characterLabel(characterId),
      };
    }),
  };
}

export function createRoomBootstrap(
  room: StoredRoom,
  viewerId: PlayerId,
): RoomBootstrap {
  return {
    room: roomProjection(room),
    selfMemberId: viewerId,
    characterOptions: characterOptions(room.memberIds, room.memberCharacters),
  };
}

/**
 * The turn clock, if the stored one still belongs to this room's current turn.
 *
 * A timer is only reported while its (game revision, player) pair still matches,
 * so a snapshot that somehow kept a timer for a turn already taken shows no
 * countdown rather than a wrong one — and the driver re-arms it on its next pass.
 */
function turnTimerProjection(room: StoredRoom): {
  readonly deadlineAt: string | null;
  readonly turnTimerDurationMs: number | null;
} {
  const timer = room.turnTimer;
  if (!isTurnTimerCurrent(room, timer) || timer === null) {
    return { deadlineAt: null, turnTimerDurationMs: null };
  }
  return { deadlineAt: timer.deadlineAt, turnTimerDurationMs: timer.durationMs };
}

function publicProjection(room: StoredRoom): PublicGameProjection {
  const game = room.game;
  if (game === null) {
    throw new TypeError("Active room is missing its canonical game");
  }
  const view = projectPublicView(game);
  const timer = turnTimerProjection(room);

  return {
    id: game.gameId,
    revision: view.revision,
    status: view.status === "quarantined" ? "paused" : view.status,
    activePlayerId: view.turn.activePlayerId,
    turnNumber: view.turn.number,
    round: view.turn.round,
    phase: view.turn.phase,
    // The engine models turn.deadlineAt but never populates it, so this field
    // would be permanently null if it were read from the projection. Filling the
    // *existing* field from the server-side clock, rather than adding a second
    // one beside it, keeps a single source of truth for "when does this turn
    // expire" — two fields where one is always null is an invitation to read the
    // wrong one. If the engine ever starts maintaining its own deadline, this is
    // the one line that has to reconcile them.
    deadlineAt: timer.deadlineAt,
    turnTimerDurationMs: timer.turnTimerDurationMs,
    players: view.players.map((player) => ({
      id: player.id,
      seat: player.order,
      connected: player.connected,
      position: player.position,
      lapsCompleted: player.lapsCompleted,
      rank: player.rank,
      role: player.role,
      resources: Object.fromEntries(
        Object.entries(player.resources).map(([key, resource]) => [key, resource.value]),
      ),
      tokens: Object.fromEntries(
        Object.entries(player.tokens).map(([key, token]) => [key, token.count]),
      ),
      statusIds: player.statuses.map((status) => status.id),
    })),
    eventSummaries: room.eventSummaries,
    winnerPlayerIds: view.outcome?.winnerPlayerIds ?? [],
  };
}

function selfProjection(room: StoredRoom, viewerId: PlayerId): CallerSelfProjection {
  const game = room.game;
  if (game === null) {
    throw new TypeError("Active room is missing its canonical game");
  }
  const view = projectPlayerView(game, viewerId);

  return {
    playerId: viewerId,
    role: view.self.role,
    characterId: view.self.characterId,
    hand: view.self.hand.map((card) => ({ id: card.id, definitionId: card.definitionId })),
    privateStatusIds: view.self.privateStatuses.map((status) => status.id),
    abilityIds: view.self.abilities.map((ability) => ability.id),
  };
}

/* -------------------------------------------------------------------------- *
 * Gameplay v2 — spec §5, §7.2
 * -------------------------------------------------------------------------- */

/**
 * The partition that makes §7.2's redaction structural rather than conventional.
 *
 * `projectPlayerView` already hands back one array per concept with *this*
 * viewer's hidden items merged in and marked — their `owner-only` placements,
 * their `hidden` sabotage, the `parties-only` agreements they are a party to,
 * their secret objectives with the detail fields filled in. Contracts splits each
 * of those arrays in two, because one array can only be typed loosely enough to
 * hold both halves, and a loosely typed array is one a careless caller can ship
 * to the wrong socket.
 *
 * So everything below reads from the *already redacted* per-viewer view and
 * sorts each entry into the public DTO or the `self` DTO. Nothing here decides
 * what a viewer may see — that decision was made in the engine — and nothing here
 * can widen it, because the public types have no field for the private half. Two
 * consequences worth naming:
 *
 * - A `sealed` ballot projects a count and whether *you* have cast. Its `castBy`
 *   record never crosses, keys included: the keys are voter ids, so a stripped
 *   record still says who has committed.
 * - An `owner-only` placement is absent from other viewers entirely rather than
 *   masked. A masked placeholder still says "something is waiting on that tile",
 *   which is the whole of what the placement is hiding.
 */

function tradeItems(items: readonly EngineTradeItem[]): readonly TradeItem[] {
  return items.map((item) => {
    switch (item.kind) {
      case "money":
        return { kind: "money", amount: item.amount };
      case "card":
        return { kind: "card", cardId: item.cardId };
      case "token":
        return { kind: "token", tokenId: item.tokenId, quantity: item.quantity };
      case "tile":
        return { kind: "tile", tileId: item.tileId };
      case "immunity":
        return { kind: "immunity", rounds: item.rounds };
      case "promise":
        return { kind: "promise", text: item.text };
    }
  });
}

/** A project whose payout has already been settled, so its secrets are spent. */
function projectIsResolved(project: EnginePublicProjectProjection): boolean {
  return project.status === "completed" || project.status === "failed";
}

function revealedSabotage(
  project: EnginePublicProjectProjection,
): readonly RevealedProjectSabotageProjection[] {
  const resolved = projectIsResolved(project);

  return project.sabotage
    .filter((entry) => !entry.hidden || resolved)
    .map((entry) => ({
      playerId: entry.playerId,
      amount: entry.amount,
      hidden: entry.hidden,
      atRound: entry.atRound,
    }));
}

/**
 * The viewer's own sabotage that nobody else can see yet.
 *
 * Only unresolved hidden entries: once the project resolves the same entry is in
 * the public list, and reporting it in both would make the UI show it twice.
 */
function ownSabotage(
  view: PlayerGameProjection,
  viewerId: PlayerId,
): readonly OwnProjectSabotageProjection[] {
  const own: OwnProjectSabotageProjection[] = [];
  for (const project of view.projects) {
    if (projectIsResolved(project)) continue;
    for (const entry of project.sabotage) {
      if (!entry.hidden || entry.playerId !== viewerId) continue;
      own.push({
        projectId: project.id,
        amount: entry.amount,
        hidden: true,
        atRound: entry.atRound,
      });
    }
  }
  return own;
}

function projectProjection(
  project: EnginePublicProjectProjection,
): PublicProjectProjection {
  return {
    id: project.id,
    definitionId: project.definitionId,
    leadPlayerId: project.leadPlayerId,
    tileId: project.tileId,
    status: project.status,
    requiredMoney: project.requiredMoney,
    requiredWork: project.requiredWork,
    contributedMoney: project.contributedMoney,
    contributedWork: project.contributedWork,
    contributions: project.contributions.map((entry) => ({
      playerId: entry.playerId,
      money: entry.money,
      work: entry.work,
      atRound: entry.atRound,
    })),
    sabotage: revealedSabotage(project),
    deadlineRound: project.deadlineRound,
    payout: {
      money: project.payout.money,
      reputation: project.payout.reputation,
      objectiveProgress: project.payout.objectiveProgress,
    },
    openToJoin: project.openToJoin,
    leadBonusBasisPoints: project.leadBonusBasisPoints,
  };
}

function publicPlacements(
  view: PlayerGameProjection,
): readonly PublicPlacementProjection[] {
  const placements: PublicPlacementProjection[] = [];
  for (const placement of view.placements) {
    if (placement.visibility !== "public") continue;
    // `data` is deliberately dropped rather than emptied: a surveillance
    // placement records what it learned about a lander there, and the public DTO
    // has no field it could be assigned into.
    placements.push({
      id: placement.id,
      kind: placement.kind,
      tileId: placement.tileId,
      ownerId: placement.ownerId,
      charges: placement.charges,
      visibility: "public",
      placedAtRound: placement.placedAtRound,
    });
  }
  return placements;
}

function ownPlacements(view: PlayerGameProjection): readonly OwnPlacementProjection[] {
  return view.placements
    .filter((placement) => placement.visibility === "owner-only")
    .map((placement) => ({
      id: placement.id,
      kind: placement.kind,
      tileId: placement.tileId,
      ownerId: placement.ownerId,
      charges: placement.charges,
      visibility: placement.visibility,
      placedAtRound: placement.placedAtRound,
      data: placement.data,
    }));
}

function publicAgreements(
  view: PlayerGameProjection,
): readonly PublicAgreementProjection[] {
  const agreements: PublicAgreementProjection[] = [];
  for (const agreement of view.agreements) {
    if (agreement.visibility !== "public") continue;
    agreements.push({
      id: agreement.id,
      proposerId: agreement.proposerId,
      recipientIds: [...agreement.recipientIds],
      give: tradeItems(agreement.give),
      receive: tradeItems(agreement.receive),
      status: agreement.status,
      offeredAtRound: agreement.offeredAtRound,
      expiresAtRound: agreement.expiresAtRound,
      acceptedBy: [...agreement.acceptedBy],
      visibility: "public",
    });
  }
  return agreements;
}

function partyAgreements(
  view: PlayerGameProjection,
): readonly PartyAgreementProjection[] {
  return view.agreements
    .filter((agreement) => agreement.visibility === "parties-only")
    .map((agreement) => ({
      id: agreement.id,
      proposerId: agreement.proposerId,
      recipientIds: [...agreement.recipientIds],
      give: tradeItems(agreement.give),
      receive: tradeItems(agreement.receive),
      status: agreement.status,
      offeredAtRound: agreement.offeredAtRound,
      expiresAtRound: agreement.expiresAtRound,
      acceptedBy: [...agreement.acceptedBy],
      visibility: agreement.visibility,
    }));
}

/**
 * Whether the engine filled this objective's detail fields in, which is its way
 * of saying "this one is the viewer's own". A secret objective belonging to
 * anybody else arrives with every detail field `null`.
 */
function isDetailed(objective: EnginePublicObjectiveProjection): boolean {
  return objective.definitionId !== null;
}

function publicObjectives(
  view: PlayerGameProjection,
): readonly PublicObjectiveProjection[] {
  const objectives: PublicObjectiveProjection[] = [];
  for (const objective of view.objectives) {
    if (objective.visibility === "public") {
      objectives.push({
        visibility: "public",
        id: objective.id,
        definitionId: objective.definitionId ?? "",
        ownerId: objective.ownerId,
        progress: objective.progress ?? 0,
        target: objective.target ?? 0,
        completedAtRound: objective.completedAtRound,
        rewardPoints: objective.rewardPoints ?? 0,
        rewardMoney: objective.rewardMoney ?? 0,
      });
      continue;
    }
    if (isDetailed(objective)) continue;
    // Existence-only: whose it is and whether it finished, and nothing else.
    objectives.push({
      visibility: "secret",
      id: objective.id,
      ownerId: objective.ownerId,
      completedAtRound: objective.completedAtRound,
    });
  }
  return objectives;
}

function selfObjectives(
  view: PlayerGameProjection,
): readonly SelfObjectiveProjection[] {
  return view.objectives
    .filter((objective) => objective.visibility === "secret" && isDetailed(objective))
    .map((objective) => ({
      visibility: objective.visibility,
      id: objective.id,
      definitionId: objective.definitionId ?? "",
      ownerId: objective.ownerId,
      progress: objective.progress ?? 0,
      target: objective.target ?? 0,
      completedAtRound: objective.completedAtRound,
      rewardPoints: objective.rewardPoints ?? 0,
      rewardMoney: objective.rewardMoney ?? 0,
    }));
}

function ballotProjection(
  ballot: PublicBallotProjection,
  ownCasts: Readonly<Record<string, JsonValue>>,
): BallotProjection {
  const shared = {
    id: ballot.id,
    kind: ballot.kind,
    subjectId: ballot.subjectId,
    subject: ballot.subject,
    audience: [...ballot.audience],
    deadlineAt: ballot.deadlineAt,
    closesAtRound: ballot.closesAtRound,
    resolution: ballot.resolution,
  };

  if (ballot.visibility === "open") {
    return { ...shared, visibility: "open", castBy: ballot.castBy ?? {} };
  }

  return {
    ...shared,
    visibility: "sealed",
    castCount: ballot.castCount,
    // From the viewer's *own* casts, not from the ballot: `castBy` is null for a
    // sealed ballot precisely so nobody can read a membership out of it.
    viewerHasCast: Object.hasOwn(ownCasts, ballot.id),
  };
}

function playerGameplay(
  view: PlayerGameProjection,
): readonly PublicPlayerGameplayProjection[] {
  return view.players.map((player) => ({
    playerId: player.id,
    // The hand itself has no route here: `PublicPlayerProjection` carries a count
    // and no cards, and this DTO has no field for them either.
    handCount: player.handCount,
    heat: {
      value: player.heat.value,
      threshold: player.heat.threshold,
      investigationsOpened: player.heat.investigationsOpened,
      lastIncrementedAtRound: player.heat.lastIncrementedAtRound,
    },
    upkeep: {
      perRound: player.upkeep.perRound,
      lastChargedRound: player.upkeep.lastChargedRound,
      missedPayments: player.upkeep.missedPayments,
    },
    loans: player.loans.map((loan) => ({
      id: loan.id,
      principal: loan.principal,
      outstanding: loan.outstanding,
      interestBasisPoints: loan.interestBasisPoints,
      takenAtRound: loan.takenAtRound,
    })),
    incomeStreams: player.incomeStreams.map((stream) => ({
      id: stream.id,
      kind: stream.kind,
      perRound: stream.perRound,
      remainingRounds: stream.remainingRounds,
      sourceId: stream.sourceId,
    })),
  }));
}

/* -------------------------------------------------------------------------- *
 * Legal actions
 * -------------------------------------------------------------------------- */

function readStringArray(subject: JsonObject, key: string): readonly string[] | null {
  const raw = subject[key];
  if (!Array.isArray(raw)) return null;
  const values = raw.filter((entry): entry is string => typeof entry === "string");

  return values.length === raw.length && values.length > 0 ? values : null;
}

function readNumber(subject: JsonObject, key: string): number | null {
  const raw = subject[key];

  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/**
 * What each ballot will accept, for the ballots this viewer may cast in.
 *
 * Read from the ballot's authored `subject` with the same two readers
 * `execution/ballots.ts` uses, so what the UI is told a ballot accepts and what
 * `validateBallotCast` will actually accept come from one place. Nothing about a
 * ballot's *in-flight* state is copied in: `LegalActionBallotTerms` has no field
 * for a tally, so no amount of carelessness here can put one in a legal action.
 */
function ballotTerms(view: PlayerGameProjection): readonly LegalActionBallotTerms[] {
  return view.ballots.map((ballot) => ({
    ballotId: ballot.id,
    sealed: ballot.visibility === "sealed",
    options: readStringArray(ballot.subject, "options"),
    minBid: readNumber(ballot.subject, "minBid"),
  }));
}

/**
 * The terms of offers awaiting this viewer.
 *
 * Restricted to agreements they are a *recipient* of — which is exactly the set
 * the engine enumerates `agreement.respond` for — so a `parties-only` deal
 * between two other players has no route into a third player's legal actions
 * even though the mapper is fed the whole per-viewer array.
 */
function agreementTerms(
  view: PlayerGameProjection,
  viewerId: PlayerId,
): readonly LegalActionAgreementTerms[] {
  return view.agreements
    .filter((agreement) => agreement.recipientIds.includes(viewerId))
    .map((agreement) => ({
      agreementId: agreement.id,
      give: tradeItems(agreement.give),
      receive: tradeItems(agreement.receive),
      expiresAtRound: agreement.expiresAtRound,
    }));
}

function resourceValue(
  view: PlayerGameProjection,
  viewerId: PlayerId,
  resourceId: string,
): number {
  const player = view.players.find((candidate) => candidate.id === viewerId);
  return player?.resources[resourceId]?.value ?? 0;
}

/**
 * Everything `toLegalActionSummary` needs, and deliberately nothing more.
 *
 * Every field is either public (the frozen ruleset, the other seats) or the
 * viewer's own (their balances, offers made to them, ballots they may cast in).
 * `LegalActionContext` has no field for another player's hand, objectives,
 * hidden placements or in-flight votes, so this function has nothing to be
 * careless with.
 */
function legalActionContext(
  view: PlayerGameProjection,
  viewerId: PlayerId,
): LegalActionContext {
  return {
    rules: view.rules,
    spendable: {
      money: resourceValue(view, viewerId, "money"),
      energy: resourceValue(view, viewerId, "energy"),
      work: resourceValue(view, viewerId, "work-counter"),
    },
    ballots: ballotTerms(view),
    agreements: agreementTerms(view, viewerId),
    otherPlayerIds: view.players
      .map((player) => player.id)
      .filter((playerId) => playerId !== viewerId),
  };
}

/**
 * How many free actions the viewer has left this turn.
 *
 * Derived from the enumerator rather than recomputed: `turn.action` carries its
 * own `remaining`, and the engine does not export the budget function, so the
 * only alternative would be a second copy of `turnActionBudget`'s arithmetic that
 * could drift from the one the transition enforces. No `turn.action` means no
 * free actions are available to this viewer right now, which is the honest
 * answer for anyone who is not the active player.
 */
function freeActionsRemaining(actions: readonly { readonly type: string }[]): number {
  const action = actions.find((candidate) => candidate.type === "turn.action");
  return action !== undefined && "remaining" in action && typeof action.remaining === "number"
    ? action.remaining
    : 0;
}

function gameplayProjection(
  view: PlayerGameProjection,
  viewerId: PlayerId,
  legalActions: readonly { readonly type: string }[],
): GameplayProjection {
  return {
    // The match's frozen ruleset (§5.9), not whatever the content pack says
    // today: a mid-match content deploy must not change what the UI claims the
    // rules are.
    rules: view.rules,
    tileOwnership: view.tileOwnership.map((owned) => ({
      tileId: owned.tileId,
      ownerId: owned.ownerId,
      level: owned.level,
      claimedAtRound: owned.claimedAtRound,
      tollPaidCount: owned.tollPaidCount,
    })),
    placements: publicPlacements(view),
    projects: view.projects.map(projectProjection),
    agreements: publicAgreements(view),
    objectives: publicObjectives(view),
    ballots: view.ballots.map((ballot) =>
      ballotProjection(ballot, view.self.ballotCasts),
    ),
    quarters: view.quarters.map((quarter) => ({
      index: quarter.index,
      startedAtRound: quarter.startedAtRound,
      endsAtRound: quarter.endsAtRound,
      scheduledEventId: quarter.scheduledEventId,
      resolvedEventIds: [...quarter.resolvedEventIds],
    })),
    currentQuarterIndex: view.currentQuarterIndex,
    eliminatedPlayerIds: [...view.eliminatedPlayerIds],
    players: playerGameplay(view),
    self: {
      ownPlacements: ownPlacements(view),
      agreements: partyAgreements(view),
      objectives: selfObjectives(view),
      sabotage: ownSabotage(view, viewerId),
      ballotCasts: view.self.ballotCasts,
      freeActionsRemaining: freeActionsRemaining(legalActions),
    },
    scores:
      view.outcome?.scores.map((score) => ({
        playerId: score.playerId,
        rankPoints: score.rankPoints,
        moneyPoints: score.moneyPoints,
        reputationPoints: score.reputationPoints,
        objectivePoints: score.objectivePoints,
        ownershipPoints: score.ownershipPoints,
        projectPoints: score.projectPoints,
        penaltyPoints: score.penaltyPoints,
        total: score.total,
      })) ?? [],
    winPath: view.outcome?.winPath ?? null,
    endReason: view.outcome?.reason ?? null,
  };
}

export function createBootstrap(
  room: StoredRoom,
  viewerId: PlayerId,
  serverTime: string,
): GameplayBootstrap {
  const game = room.game;
  if (game === null) {
    throw new TypeError("Active room is missing its canonical game");
  }
  const playerView = projectPlayerView(game, viewerId);
  const timer = turnTimerProjection(room);
  // projectPlayerView already returns only prompts addressed to this viewer, so
  // "the clock is waiting on one of these prompts" reduces to "the clock is this
  // viewer's". A player can hold an open audit prompt while somebody else is
  // active, and that prompt is correctly reported with no deadline: nothing will
  // auto-resolve it until the turn comes back to them.
  const viewerIsOnTheClock = timer.deadlineAt !== null && room.turnTimer?.playerId === viewerId;
  const enumerated = enumerateLegalActions(game, viewerId);
  const context = legalActionContext(playerView, viewerId);
  // `toLegalActionSummary` answers null for an action whose option set is empty
  // once the mode's own limits are applied — a `turn.adjust-roll` in a mode with
  // `maxPipAdjust: 0`, an `attack.target` with no reachable seat. Dropping those
  // is what stops the client rendering an enabled control that cannot be pressed.
  const legalActions = enumerated
    .map((action) => toLegalActionSummary(action, context))
    .filter((summary): summary is LegalActionSummary => summary !== null);

  return {
    room: roomProjection(room),
    publicProjection: publicProjection(room),
    self: selfProjection(room, viewerId),
    prompts: playerView.prompts.map((prompt) => ({
      id: prompt.id,
      kind: prompt.kind,
      // The engine leaves every prompt deadline null too. A prompt held by the
      // player whose clock is running *is* what that clock is waiting on —
      // responding is their only legal action — so it carries the same instant.
      deadlineAt: viewerIsOnTheClock ? timer.deadlineAt : prompt.deadlineAt,
      optionIds: prompt.legalResponses.map((option) => option.id),
    })),
    reactions: playerView.reactions,
    legalActions,
    gameplay: gameplayProjection(playerView, viewerId, enumerated),
    serverTime,
  };
}
