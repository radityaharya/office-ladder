import type {
  AbilityId,
  AgreementId,
  AgreementStatus,
  BallotId,
  CardDefinitionId,
  CardInstanceId,
  CharacterId,
  DecisionPointId,
  DeckId,
  DeckKind,
  GameStatus,
  HeatState,
  IncomeStreamState,
  JsonObject,
  JsonValue,
  LoanState,
  LogicalTimestamp,
  MatchOutcome,
  ModeRules,
  ObjectiveId,
  PlacementId,
  PlacementKind,
  PlayerId,
  ProjectId,
  ProjectPayout,
  ProjectStatus,
  PromptOptionId,
  QuarterState,
  RankState,
  ResourceState,
  RoleId,
  RoleKind,
  StatusId,
  TileId,
  TokenState,
  TradeItem,
  TurnState,
  UpkeepState,
} from "../model";

export type PublicRoleProjection =
  | {
      readonly revealed: false;
    }
  | {
      readonly revealed: true;
      readonly kind: RoleKind | null;
    };

export interface PublicStatusProjection {
  readonly id: StatusId;
  readonly sourceId: string | null;
  readonly stacks: number;
  readonly remainingTurns: number | null;
  readonly expiresAtRound: number | null;
  readonly data: JsonObject;
}

export interface PublicPlayerProjection {
  readonly id: PlayerId;
  readonly order: number;
  readonly connected: boolean;
  readonly position: number;
  readonly lapsCompleted: number;
  readonly rank: RankState;
  readonly role: PublicRoleProjection;
  readonly resources: Readonly<Record<string, ResourceState>>;
  readonly tokens: Readonly<Record<string, TokenState>>;
  readonly statuses: readonly PublicStatusProjection[];
  readonly skipTurns: number;
  readonly inAudit: boolean;
  /**
   * How many cards this player holds — never which ones. A hidden hand projects
   * as a count, so there is no shape here that could carry the contents even by
   * accident (spec §7.2).
   */
  readonly handCount: number;
  readonly upkeep: UpkeepState;
  readonly loans: readonly LoanState[];
  readonly incomeStreams: readonly IncomeStreamState[];
  /**
   * Deliberately public: heat is only a deterrent if the table can see who has
   * been throwing punches.
   */
  readonly heat: HeatState;
}

export interface ProjectedCard {
  readonly id: CardInstanceId;
  readonly definitionId: CardDefinitionId;
  readonly deckId: DeckId;
  readonly data: JsonObject;
}

export interface PublicDeckProjection {
  readonly id: DeckId;
  readonly kind: DeckKind | null;
  readonly drawCount: number;
  readonly discardCount: number;
  readonly visibleCards: readonly ProjectedCard[];
}

export interface PublicTileOwnershipProjection {
  readonly tileId: TileId;
  readonly ownerId: PlayerId;
  readonly level: number;
  readonly claimedAtRound: number;
  readonly tollPaidCount: number;
}

/**
 * A placed object on a tile.
 *
 * Redaction here is **by omission, not by blanking**: an `owner-only` placement
 * is absent from every viewer's array except its owner's. A redacted placeholder
 * would still tell the table that *something* is waiting on that tile, which is
 * exactly the information an owner-only placement is meant to withhold.
 */
export interface PublicPlacementProjection {
  readonly id: PlacementId;
  readonly kind: PlacementKind;
  readonly tileId: TileId;
  readonly ownerId: PlayerId;
  readonly charges: number;
  readonly visibility: "public" | "owner-only";
  readonly placedAtRound: number;
  readonly data: JsonObject;
}

export interface PublicProjectContributionProjection {
  readonly playerId: PlayerId;
  readonly money: number;
  readonly work: number;
  readonly atRound: number;
}

/**
 * Sabotage of a project.
 *
 * Same omission rule as placements: an entry with `hidden: true` appears only in
 * the saboteur's own view. Hidden sabotage by anyone else is absent from the
 * array entirely — not summarised, not counted — because knowing a project *has*
 * been sabotaged is most of what the lead would want to know.
 */
export interface PublicProjectSabotageProjection {
  readonly playerId: PlayerId;
  readonly amount: number;
  readonly hidden: boolean;
  readonly atRound: number;
}

export interface PublicProjectProjection {
  readonly id: ProjectId;
  readonly definitionId: string;
  readonly leadPlayerId: PlayerId;
  readonly tileId: TileId | null;
  readonly status: ProjectStatus;
  readonly requiredMoney: number;
  readonly requiredWork: number;
  /** Sum of `contributions[].money`, pre-summed so the client never has to. */
  readonly contributedMoney: number;
  /** Sum of `contributions[].work`. */
  readonly contributedWork: number;
  readonly contributions: readonly PublicProjectContributionProjection[];
  readonly sabotage: readonly PublicProjectSabotageProjection[];
  readonly deadlineRound: number;
  readonly payout: ProjectPayout;
  readonly openToJoin: boolean;
  readonly leadBonusBasisPoints: number;
}

/**
 * An offer. A `parties-only` agreement is absent from the views of players who
 * are neither the proposer nor a recipient.
 */
export interface PublicAgreementProjection {
  readonly id: AgreementId;
  readonly proposerId: PlayerId;
  readonly recipientIds: readonly PlayerId[];
  readonly give: readonly TradeItem[];
  readonly receive: readonly TradeItem[];
  readonly status: AgreementStatus;
  readonly offeredAtRound: number;
  readonly expiresAtRound: number;
  readonly acceptedBy: readonly PlayerId[];
  readonly visibility: "public" | "parties-only";
}

/**
 * An objective, redacted to **existence-only** when it is secret and not the
 * viewer's own: you learn that a secret objective exists and whose it is, and
 * that it eventually completed, but never what it asks for or how close it is.
 *
 * The detail fields are `null` rather than absent so the shape stays uniform
 * across viewers and survives the JSON boundary without optional properties.
 */
export interface PublicObjectiveProjection {
  readonly id: ObjectiveId;
  /** `null` = table-wide. */
  readonly ownerId: PlayerId | null;
  readonly visibility: "public" | "secret";
  readonly completedAtRound: number | null;
  readonly definitionId: string | null;
  readonly progress: number | null;
  readonly target: number | null;
  readonly rewardPoints: number | null;
  readonly rewardMoney: number | null;
}

/**
 * A vote or auction.
 *
 * While a sealed ballot is in flight, `castBy` is `null` — not an empty record,
 * and not a filtered one. Its *keys* are voter ids, so exposing the record at
 * all would leak who has already committed; `castCount` carries the only part
 * that is safe to show, because a number names nobody.
 */
export interface PublicBallotProjection {
  readonly id: BallotId;
  readonly kind: "vote" | "auction";
  readonly subjectId: string;
  readonly subject: JsonObject;
  readonly audience: readonly PlayerId[];
  readonly deadlineAt: LogicalTimestamp | null;
  readonly closesAtRound: number;
  readonly visibility: "open" | "sealed";
  readonly castBy: Readonly<Record<string, JsonValue>> | null;
  readonly castCount: number;
  readonly resolution: JsonObject | null;
}

export interface PublicGameProjection {
  readonly status: GameStatus;
  readonly revision: number;
  readonly turn: TurnState;
  readonly boardSize: number;
  /** The match's frozen ruleset: the client renders panels from this, not from content. */
  readonly rules: ModeRules;
  readonly players: readonly PublicPlayerProjection[];
  readonly decks: readonly PublicDeckProjection[];
  readonly tileOwnership: readonly PublicTileOwnershipProjection[];
  readonly placements: readonly PublicPlacementProjection[];
  readonly projects: readonly PublicProjectProjection[];
  readonly agreements: readonly PublicAgreementProjection[];
  readonly objectives: readonly PublicObjectiveProjection[];
  readonly ballots: readonly PublicBallotProjection[];
  readonly quarters: readonly QuarterState[];
  readonly currentQuarterIndex: number;
  readonly eliminatedPlayerIds: readonly PlayerId[];
  readonly outcome: MatchOutcome | null;
}

export interface PrivateStatusProjection {
  readonly id: StatusId;
  readonly sourceId: string | null;
  readonly stacks: number;
  readonly remainingTurns: number | null;
  readonly expiresAtRound: number | null;
  readonly data: JsonObject;
}

export interface PrivateAbilityProjection {
  readonly id: AbilityId;
  readonly usesRemaining: number | null;
  readonly cooldownLapsRemaining: number;
  readonly data: JsonObject;
}

export interface PrivateRoleProjection {
  readonly id: RoleId;
  readonly kind: RoleKind | null;
  readonly revealed: boolean;
}

export interface SelfProjection {
  readonly role: PrivateRoleProjection;
  readonly characterId: CharacterId;
  readonly hand: readonly ProjectedCard[];
  readonly privateStatuses: readonly PrivateStatusProjection[];
  readonly abilities: readonly PrivateAbilityProjection[];
  /**
   * This viewer's own ballot casts, keyed by `BallotId`.
   *
   * Needed because `PublicBallotProjection.castBy` is `null` for a sealed ballot
   * in flight — without this a player could not see the bid they themselves just
   * placed. Only ever the viewer's own entries.
   */
  readonly ballotCasts: Readonly<Record<string, JsonValue>>;
}

export interface PlayerPromptOptionProjection {
  readonly id: PromptOptionId;
  readonly value: JsonValue;
}

export interface PlayerPromptResponseProjection {
  readonly optionId: PromptOptionId;
  readonly value: JsonValue;
}

export interface PlayerPromptProjection {
  readonly id: DecisionPointId;
  readonly kind: string;
  readonly legalResponses: readonly PlayerPromptOptionProjection[];
  readonly deadlineAt: LogicalTimestamp | null;
  readonly defaultResponse: PlayerPromptResponseProjection;
  readonly response: PlayerPromptResponseProjection | null;
}

export interface PlayerReactionProjection {
  readonly id: DecisionPointId;
  readonly kind: "prevention" | "end-turn" | "promotion-block";
  readonly hasPriority: boolean;
  readonly hasPassed: boolean;
  readonly hasPlayed: boolean;
  readonly deadlineAt: LogicalTimestamp | null;
}

/**
 * One viewer's whole view of the game.
 *
 * The inherited collections are **per-viewer, not public-plus-extras**. A player
 * view's `placements`, `projects`, `agreements` and `objectives` are the public
 * set with that viewer's own hidden items merged in — their `owner-only`
 * placements, their `hidden` sabotage, the `parties-only` agreements they are a
 * party to, and their secret objectives with the detail fields filled in. There
 * is deliberately no parallel "my hidden things" collection: one array per
 * concept means a UI cannot render the public one and forget the private one,
 * and a server fan-out cannot ship the wrong array to the wrong socket.
 *
 * This is why WS fan-out has to be per-socket rather than per-topic: two viewers
 * of the same revision do not receive the same payload.
 */
export interface PlayerGameProjection extends PublicGameProjection {
  readonly self: SelfProjection;
  readonly prompts: readonly PlayerPromptProjection[];
  readonly reactions: readonly PlayerReactionProjection[];
}
