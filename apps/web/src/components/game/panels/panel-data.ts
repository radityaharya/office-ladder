/**
 * The rail's data layer: one projection in, eleven panels' props out.
 *
 * ## Why this module exists
 *
 * Every destination in this kit was built to take a **view model**, never a
 * transport DTO — `panel-registry.ts` says why, and the reason is a redaction
 * argument rather than a stylistic one: a panel must be handed exactly what a
 * viewer may see (`plans/24-gameplay-v2-spec.md` §7.2), which is a narrower shape
 * than `GameplayProjection`. That left a gap nobody filled: the shell had real
 * data and the panels had real props and nothing mapped one onto the other, so
 * eleven surfaces rendered their empty state forever while a fully populated
 * `gameplay` block sat unread on the bootstrap.
 *
 * This is that mapping, and it is deliberately **the only place** it happens. A
 * host that reaches into `bootstrap.gameplay` itself is a host that will one day
 * put `castBy` on screen.
 *
 * ## Where the hidden-information guarantees actually land
 *
 * They land in the *type* of what comes out, not in the care taken here. That
 * distinction is the whole design:
 *
 * - An opponent's hand leaves this module as {@link OpponentHandCount}, whose only
 *   card-shaped field is a number. There is no code path that could leak a card
 *   because there is nowhere to put one.
 * - A sealed ballot leaves as the `sealed` member of `BallotPanelItem`, which has
 *   `castCount` and no `casts` array — so the in-flight `castBy` record the
 *   server sends for an *open* ballot cannot be attached to a sealed one by
 *   editing this file. §7.2 forbids leaking in-flight votes "including via
 *   `castBy` keys", and the type is what enforces it.
 * - Another seat's secret objective leaves as {@link ConcealedObjective}: an id,
 *   an owner, and nothing else.
 * - Hidden project sabotage does not leave at all. `ProjectPanelItem` has no
 *   field for it — not even a count — so an unresolved secret sabotage is
 *   unrepresentable downstream of here.
 *
 * The one thing this module *must* get right is not putting a private value into
 * a public shape. Every place that could is called out in a comment below.
 *
 * ## What it does not do
 *
 * - **No activity prose.** `turn-rail.tsx`'s `buildActivityLog` already turns the
 *   committed event stream into sentences, and its `ActivityLogEntry` is
 *   structurally assignable to {@link ActivityPanelEntry} on purpose (see the note
 *   on that type). A second sentence table would drift from the first within a
 *   wave, so the rows arrive through {@link PanelDataInput.activity} instead.
 * - **No fetching, no state, no effects.** Pure functions of a bootstrap, so the
 *   whole rail's resting state is what the first synchronous render produces and
 *   `renderToStaticMarkup` sees exactly what a player sees.
 * - **No pacing.** Feed the *paced* bootstrap in if the host is pacing playback
 *   (`useEventPacing`); this module has no opinion and no cursor of its own.
 */
import { deadlineDashContent } from "@office-ladder/content";
import type {
  EffectDescriptor,
  GlobalEventConfig,
  GlobalEventModifier,
  GlobalEventScope,
  ModeConfig,
} from "@office-ladder/content";
import type {
  BallotProjection,
  GameplayBootstrap,
  GameplayProjection,
  JsonObject,
  JsonValue,
  LegalActionSummary,
  PartyAgreementProjection,
  PublicAgreementProjection,
  PublicGameProjection,
  PublicObjectiveProjection,
  PublicPlayerGameplayProjection,
  PublicProjectProjection,
  RoomProjection,
  SafeEventSummary,
  SelfObjectiveProjection,
  TradeItem,
} from "@office-ladder/contracts";

import {
  deckDisplayName,
  derivedCardName,
  describeEffect,
  resolveAuthoredCardCopy,
  type AuthoredCardCopy,
} from "../card";
import type { ActivityPanelEntry } from "./activity-panel";
import {
  agreementsAttention,
  type AgreementPanelItem,
  type AgreementTerm,
} from "./agreements-panel";
import { ballotsAttention, type BallotCast, type BallotPanelItem } from "./ballots-panel";
import type { EventFeedItem } from "./events-panel";
import type { HandCardView, OpponentHandCount } from "./hand-panel";
import { heatAttention, type HeatSeatReadout, type HeatSelfReadout } from "./heat-panel";
import type { MarketBid, MarketLot, MarketLotKind } from "./market-panel";
import type {
  ConcealedObjective,
  ObjectivePanelItem,
  VisibleObjective,
} from "./objectives-panel";
import type { PanelAttention } from "./panel";
import { formatPanelMoney, pluralise } from "./panel-format";
import type { PanelId } from "./panel-registry";
import type {
  ProjectPanelItem,
  ProjectPanelStatus,
  RevealedSabotage,
} from "./projects-panel";
import type { QuarterAnnouncement, QuarterState, QuarterStep } from "./quarter-panel";
import type { SeatPanelRow } from "./seats-panel";

/** Display slots are 1..6; the board has six seat colours and no more. */
const SEAT_COUNT = 6;

/* ========================================================================== */
/* Input and output                                                           */
/* ========================================================================== */

export type PanelDataInput = {
  /**
   * The per-viewer bootstrap. Already redacted by the server for this socket
   * (§7.2, §11.3) — this module narrows it further for presentation but never
   * un-redacts anything, because it has nothing to un-redact it from.
   */
  readonly bootstrap: GameplayBootstrap;
  /**
   * Activity rows, newest-first ordering applied by the caller.
   *
   * Structurally typed so `buildActivityLog(...)` output drops straight in
   * without an adapter and without this module importing the rail. Omit it and
   * the Activity panel renders its teaching empty state, which is the honest
   * result for a host that has not built the log yet.
   */
  readonly activity?: readonly ActivityPanelEntry[];
};

/**
 * Every destination's props, keyed by its registry id.
 *
 * Spread-ready on purpose: `<ProjectsPanel {...data.projects} />`. The host wires
 * twelve destinations without knowing what a project or a ballot is, which is the
 * seam `panel-host.tsx` was built for.
 *
 * `chat` is absent. Chat is not game state (§8.1) and its panel is separately
 * owned; it takes messages from the chat transport, not from `GameState`.
 */
export type PanelData = {
  /** The current round, for any host that needs to caption the rail itself. */
  readonly round: number;
  readonly seats: {
    readonly seats: readonly SeatPanelRow[];
    readonly capacity: number;
  };
  readonly activity: {
    readonly entries: readonly ActivityPanelEntry[];
    readonly revision: number;
  };
  readonly events: { readonly items: readonly EventFeedItem[] };
  readonly hand: {
    readonly cards: readonly HandCardView[];
    readonly opponents: readonly OpponentHandCount[];
    readonly handLimit: number | null;
  };
  readonly projects: {
    readonly projects: readonly ProjectPanelItem[];
    readonly round: number;
  };
  readonly market: { readonly lots: readonly MarketLot[]; readonly round: number };
  readonly agreements: {
    readonly agreements: readonly AgreementPanelItem[];
    readonly round: number;
  };
  readonly ballots: {
    readonly ballots: readonly BallotPanelItem[];
    readonly round: number;
  };
  readonly objectives: { readonly objectives: readonly ObjectivePanelItem[] };
  readonly heat: {
    readonly self: HeatSelfReadout | null;
    readonly seats: readonly HeatSeatReadout[];
  };
  readonly quarter: {
    readonly quarters: readonly QuarterStep[];
    readonly round: number;
    readonly announcement: QuarterAnnouncement | null;
  };
  /**
   * Per-destination attention, for the tab strip's badges.
   *
   * A destination with nothing waiting is `null` rather than a zero count: an
   * attention affordance that is always present stops meaning anything (see
   * `PanelAttentionBadge`). Only the four destinations that can genuinely be
   * *waiting on the viewer* ever populate — a badge on a panel a player cannot
   * act in is noise.
   */
  readonly attention: Readonly<Partial<Record<PanelId, PanelAttention | null>>>;
};

/* ========================================================================== */
/* The viewer's context — resolved once, threaded everywhere                  */
/* ========================================================================== */

/**
 * Everything the eleven selectors need about *who is looking*.
 *
 * Built once per bootstrap so a six-seat table does not run eleven linear
 * searches per row, and so "the viewer" is resolved in exactly one place. Every
 * field is either public (names, slots, the round) or the viewer's own.
 */
export type PanelViewerContext = {
  readonly selfPlayerId: string;
  readonly round: number;
  readonly revision: number;
  readonly room: RoomProjection;
  readonly game: PublicGameProjection;
  readonly gameplay: GameplayProjection;
  /**
   * The viewer's own hand, as the transport sends it: an instance id and a
   * definition id per card, and nothing about anybody else's.
   */
  readonly hand: readonly { readonly id: string; readonly definitionId: string }[];
  /** Display slot 1..6 by player id — the number the board token also carries. */
  readonly slotOf: (playerId: string | null | undefined) => number | null;
  readonly nameOf: (playerId: string | null | undefined) => string;
  readonly actions: readonly LegalActionSummary[];
};

export function createPanelViewerContext(bootstrap: GameplayBootstrap): PanelViewerContext {
  const game = bootstrap.publicProjection;
  const room = bootstrap.room;

  /*
   * Slot is the player's index in turn order, NOT `PublicPlayerProjection.seat`.
   * The server maps `seat: player.order`, which is zero-based, so reading `seat`
   * directly renders a seat-0 token with no colour and shifts every identity rule
   * by one. `turn-rail.tsx`'s `seatSlot` derives it the same way for the same
   * reason; the two are independently owned and must agree, so both derive rather
   * than trusting the field.
   */
  const slots = new Map<string, number>(
    game.players.map((player, index) => [player.id, (index % SEAT_COUNT) + 1]),
  );
  const names = new Map<string, string>(
    room.members.map((member) => [member.id, member.displayName]),
  );

  return {
    selfPlayerId: bootstrap.self.playerId,
    round: game.round,
    revision: game.revision,
    room,
    game,
    gameplay: bootstrap.gameplay,
    hand: bootstrap.self.hand,
    slotOf: (playerId) => {
      if (playerId === null || playerId === undefined) return null;
      return slots.get(playerId) ?? null;
    },
    nameOf: (playerId) => {
      if (playerId === null || playerId === undefined) return "The office";
      const name = names.get(playerId);
      if (name !== undefined && name.length > 0) return name;
      const slot = slots.get(playerId);
      return slot === undefined ? "Unknown seat" : `Seat ${slot}`;
    },
    actions: bootstrap.legalActions,
  };
}

/* ========================================================================== */
/* The aggregate                                                              */
/* ========================================================================== */

/**
 * Derives every panel's props from one bootstrap.
 *
 * One call per render in the host, then eleven spreads. Cheap enough to run
 * unmemoised (it is `O(seats + projects + ballots + events)` with no allocation
 * per cell), but pure and referentially honest, so wrapping it in `useMemo` on
 * the bootstrap identity is safe and free.
 */
export function derivePanelData({ bootstrap, activity = [] }: PanelDataInput): PanelData {
  const context = createPanelViewerContext(bootstrap);
  const round = context.round;

  const projects = derivePanelProjects(context);
  const lots = derivePanelMarketLots(context);
  const agreements = derivePanelAgreements(context);
  const ballots = derivePanelBallots(context);
  const hand = derivePanelHand(context);
  const heat = derivePanelHeat(context);
  const quarter = derivePanelQuarters(context);

  return {
    round,
    seats: {
      seats: derivePanelSeats(context),
      capacity: context.room.capacity,
    },
    activity: { entries: activity, revision: context.revision },
    events: { items: derivePanelEvents(context) },
    hand,
    projects: { projects, round },
    market: { lots, round },
    agreements: { agreements, round },
    ballots: { ballots, round },
    objectives: { objectives: derivePanelObjectives(context) },
    heat,
    quarter,
    attention: {
      agreements: agreementsAttention(agreements),
      ballots: ballotsAttention(ballots),
      heat: heatAttention(heat.self),
      hand: handAttention(hand.cards),
      market: marketAttention(lots),
      quarter: quarterAttention(quarter.announcement),
    },
  };
}

/* ========================================================================== */
/* Seats                                                                      */
/* ========================================================================== */

/**
 * The roster.
 *
 * Public state only, which is what `SeatPanelRow` is shaped for. The v2 economy
 * facts (upkeep, debt, income) are genuinely public — `PublicPlayerGameplayProjection`
 * carries them for every seat — and they belong on the roster rather than in a
 * panel of their own: §12.4 requires upkeep to be visible *before* it bites, and
 * a recurring charge nobody sees until it lands is the surprise deduction that
 * rule exists to forbid.
 */
export function derivePanelSeats(context: PanelViewerContext): readonly SeatPanelRow[] {
  const eliminated = new Set(context.gameplay.eliminatedPlayerIds);
  const economies = new Map<string, PublicPlayerGameplayProjection>(
    context.gameplay.players.map((player) => [player.playerId, player]),
  );

  return context.game.players.map((player) => {
    const member = context.room.members.find((candidate) => candidate.id === player.id);
    const economy = economies.get(player.id) ?? null;

    return {
      playerId: player.id,
      seat: context.slotOf(player.id) ?? 1,
      name: context.nameOf(player.id),
      rankLabel: rankLabel(player.rank),
      tileLabel: tileLabel(player.position),
      money: player.resources["money"] ?? 0,
      presence: member?.isBot === true ? "bot" : player.connected ? "online" : "away",
      active: context.game.activePlayerId === player.id,
      self: player.id === context.selfPlayerId,
      eliminated: eliminated.has(player.id),
      /*
       * Carried, not rendered by this panel. Identity in the roster is the seat
       * colour plus the seat NUMBER (§8) and a 320px rail should not spend 20px
       * on a photo that is null for every bot and most humans. It is here so the
       * board's token layer and any dossier overlay read faces from the same
       * derivation instead of re-walking `room.members` — see the report's
       * `needsOtherOwner` note.
       *
       * Safe in an `img src` and nowhere else: the server vouches for an absolute
       * `https:` URL or a root-relative same-origin path (`parseAvatarUrl`), never
       * for a `style`, an `href` or a CSS `url()`.
       */
      avatarUrl: member?.avatarUrl ?? null,
      economy:
        economy === null
          ? null
          : {
              upkeep: economy.upkeep,
              debtOutstanding: economy.loans.reduce((total, loan) => total + loan.outstanding, 0),
              loanCount: economy.loans.length,
              incomePerRound: economy.incomeStreams.reduce(
                (total, stream) => total + stream.perRound,
                0,
              ),
            },
    } satisfies SeatPanelRow;
  });
}

/* ========================================================================== */
/* Hand                                                                       */
/* ========================================================================== */

type AuthoredDeck = (typeof deadlineDashContent.decks)[number];
type AuthoredCard = AuthoredDeck["cards"][number];

/**
 * The viewer's own hand in full, and everyone else's as counts.
 *
 * The asymmetry is the point and it is structural: `cards` is
 * `HandCardView[]` (name, deck, effects, playability) and `opponents` is
 * {@link OpponentHandCount}`[]` (seat, name, a number). The two collections come
 * from two different places in the payload — `self.hand` and
 * `gameplay.players[].handCount` — and there is no shape in the second that could
 * hold a card even if the server started sending one.
 */
export function derivePanelHand(context: PanelViewerContext): {
  readonly cards: readonly HandCardView[];
  readonly opponents: readonly OpponentHandCount[];
  readonly handLimit: number | null;
} {
  const rules = context.gameplay.rules;
  const playableIds = new Set<string>(
    context.actions.flatMap((action) =>
      action.type === "turn.play-card" ? [...action.cardIds] : [],
    ),
  );
  const canPlayNow = context.actions.some((action) => action.type === "turn.play-card");

  const cards = rules.agency.handEnabled
    ? context.hand.map((entry) => {
        const authored = findAuthoredCard(entry.definitionId);
        const playable = playableIds.has(entry.id);

        return {
          instanceId: entry.id,
          definitionId: entry.definitionId,
          deckId: authored?.deck.id ?? "",
          copy: cardCopy(authored),
          effects: authored?.card.effects ?? [],
          playable,
          blockedReason: playable ? null : handBlockedReason(context, canPlayNow),
        } satisfies HandCardView;
      })
    : [];

  const opponents = context.gameplay.players
    .filter((player) => player.playerId !== context.selfPlayerId)
    .map(
      (player): OpponentHandCount => ({
        seat: context.slotOf(player.playerId) ?? 1,
        name: context.nameOf(player.playerId),
        // The only card-shaped value that crosses this boundary for another seat,
        // and `OpponentHandCount` has no second field it could grow into.
        cardCount: player.handCount,
      }),
    );

  return {
    cards,
    opponents,
    // `handLimit` lives on the content pack's `ModeConfig`, not on `ModeRules` —
    // the rules block carries the on/off switch (`agency.handEnabled`) and the
    // cap stays authored. Reading the room's own mode keeps the two consistent.
    handLimit: rules.agency.handEnabled ? handLimitFor(context.room.mode) : null,
  };
}

/**
 * Why a held card is unavailable, in words.
 *
 * `hand-panel.tsx` prints this rather than only dimming the tile, because a
 * disabled control that will not say why is not legible (§5, §8). Three honest
 * cases and no guessing: the mode does not hold cards, it is not your turn, or
 * the server did not advertise this instance in `turn.play-card`.
 */
function handBlockedReason(context: PanelViewerContext, canPlayNow: boolean): string {
  if (!context.gameplay.rules.agency.handEnabled) {
    return "This mode does not let you hold cards — a drawn card resolves immediately.";
  }
  if (context.game.activePlayerId !== context.selfPlayerId) {
    return "Playable on your own turn.";
  }
  if (!canPlayNow) {
    return "Nothing in your hand can be played in this phase of the turn.";
  }
  return "Not playable right now: this card's own timing or cost is not met.";
}

function findAuthoredCard(
  definitionId: string,
): { readonly deck: AuthoredDeck; readonly card: AuthoredCard } | null {
  for (const deck of deadlineDashContent.decks) {
    const card = deck.cards.find((candidate) => candidate.id === definitionId);
    if (card !== undefined) return { deck, card };
  }
  return null;
}

/**
 * Display copy for a held card.
 *
 * An unmatched definition id still renders a real name rather than a blank tile:
 * the server is authoritative about what is in a hand, and a content/server skew
 * must degrade to a readable card, not to an empty box a player cannot reason
 * about. Same fallback discipline as `resolveAuthoredCardDraw`, which answers
 * null and shows nothing — here there IS something to show, because the player
 * holds it.
 */
function cardCopy(
  authored: { readonly deck: AuthoredDeck; readonly card: AuthoredCard } | null,
): AuthoredCardCopy {
  if (authored !== null) {
    return resolveAuthoredCardCopy(authored.card, authored.deck);
  }
  return { name: "Unlisted card", nameSource: "derived", flavor: null, deckName: "Unfiled" };
}

function handLimitFor(mode: string): number | null {
  const modes: Readonly<Record<string, ModeConfig>> = deadlineDashContent.modes;
  return modes[mode]?.handLimit ?? null;
}

function handAttention(cards: readonly HandCardView[]): PanelAttention | null {
  const playable = cards.filter((card) => card.playable).length;
  if (playable === 0) return null;
  return {
    count: playable,
    summary: `${pluralise(playable, "card")} in your hand can be played now.`,
  };
}

/* ========================================================================== */
/* Projects                                                                   */
/* ========================================================================== */

/**
 * Projects, the centrepiece mechanic.
 *
 * `revealedSabotage` is exactly what the server sent, and the server sends only
 * resolved or non-hidden entries (§5.2: hidden sabotage is revealed on
 * resolution). The viewer's own unresolved hidden sabotage arrives separately on
 * `gameplay.self.sabotage` and is **deliberately not merged in here**: merging it
 * would put a saboteur's own secret into the same array the panel renders for
 * everybody, which is one careless `map` away from telling the lead who hit them.
 */
export function derivePanelProjects(
  context: PanelViewerContext,
): readonly ProjectPanelItem[] {
  const rules = context.gameplay.rules;

  return context.gameplay.projects.map((project) => ({
    id: project.id,
    title: projectTitle(project),
    leadName: context.nameOf(project.leadPlayerId),
    leadSeat: context.slotOf(project.leadPlayerId),
    status: projectStatus(project.status),
    money: { committed: project.contributedMoney, required: project.requiredMoney },
    work: { committed: project.contributedWork, required: project.requiredWork },
    deadlineRound: project.deadlineRound,
    contributorCount: new Set(project.contributions.map((entry) => entry.playerId)).size,
    openToJoin: project.openToJoin && rules.projects.joinable,
    yourMoney: project.contributions
      .filter((entry) => entry.playerId === context.selfPlayerId)
      .reduce((total, entry) => total + entry.money, 0),
    revealedSabotage: project.sabotage.map(
      (entry): RevealedSabotage => ({
        seat: context.slotOf(entry.playerId),
        name: context.nameOf(entry.playerId),
        amount: entry.amount,
      }),
    ),
  }));
}

/** "project.platform-migration" reads as "Platform migration". */
function projectTitle(project: PublicProjectProjection): string {
  const derived = derivedCardName(project.definitionId);
  return derived.length === 0 ? "Untitled project" : derived;
}

/**
 * Narrows the transport's `ProjectStatus` onto the panel's own. Identical member
 * sets today; the mapping is explicit so a new transport status fails to compile
 * here instead of rendering an untoned stamp.
 */
function projectStatus(status: PublicProjectProjection["status"]): ProjectPanelStatus {
  switch (status) {
    case "open":
      return "open";
    case "funded":
      return "funded";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return status satisfies never;
  }
}

/* ========================================================================== */
/* Market — the auction half of the ballot system                             */
/* ========================================================================== */

/**
 * Lots, derived from the auction ballots.
 *
 * There is no separate market collection in `GameState`: §5.8 makes an auction a
 * `BallotState` with `kind: "auction"`, so "market/auction" (the destination §8.5
 * names) and "ballots" are two readings of one array. They are split by the
 * question a player is asking — *what is for sale and at what price* versus *what
 * am I being asked to decide* — and the attention badge lives only on Ballots, so
 * an uncast auction is counted once, not twice.
 *
 * The sealed branch is where the redaction is. A sealed lot gets `bidCount` and
 * has **no `standingBid` field at all**, so `lot.standingBid?.name` is a compile
 * error rather than a leaked leader.
 */
export function derivePanelMarketLots(context: PanelViewerContext): readonly MarketLot[] {
  return context.gameplay.ballots
    .filter((ballot) => ballot.kind === "auction")
    .map((ballot) => {
      const base = {
        id: ballot.id,
        title: ballotSubjectLine(ballot, "lot"),
        kind: lotKind(ballot),
        closesAtRound: ballot.closesAtRound,
        yourBid: numericCast(context.gameplay.self.ballotCasts[ballot.id]),
      } as const;

      if (ballot.visibility === "sealed") {
        return { ...base, visibility: "sealed", bidCount: ballot.castCount };
      }
      return { ...base, visibility: "open", standingBid: standingBid(context, ballot.castBy) };
    });
}

/**
 * The highest bid on an open lot, with whose it is.
 *
 * Only ever reached from the `open` branch above: `castBy` exists on the open
 * member of `BallotProjection` and not on the sealed one, so this function cannot
 * be called with a sealed ballot's casts because a sealed ballot has none.
 */
function standingBid(
  context: PanelViewerContext,
  castBy: Readonly<Record<string, JsonValue>>,
): MarketBid | null {
  let best: MarketBid | null = null;
  for (const [playerId, value] of Object.entries(castBy)) {
    const amount = numericCast(value);
    if (amount === null) continue;
    if (best !== null && amount <= best.amount) continue;
    best = {
      seat: context.slotOf(playerId),
      name: context.nameOf(playerId),
      amount,
    };
  }
  return best;
}

/**
 * What kind of thing a lot is.
 *
 * Read from the authored subject when it names itself, otherwise inferred from
 * the subject id's own namespace. `contract` is the fallback rather than a fifth
 * "unknown" stamp: every lot has to print a kind, and "Contract" is the honest
 * reading of an auction whose subject this UI does not recognise.
 */
function lotKind(ballot: BallotProjection): MarketLotKind {
  const declared = readString(ballot.subject, ["kind", "lotKind", "subjectKind"]);
  if (declared === "tile" || declared === "card" || declared === "favour") return declared;
  if (declared === "contract") return "contract";
  if (ballot.subjectId.startsWith("tile.")) return "tile";
  if (ballot.subjectId.startsWith("card.")) return "card";
  if (ballot.subjectId.startsWith("favour.")) return "favour";
  return "contract";
}

function marketAttention(lots: readonly MarketLot[]): PanelAttention | null {
  const unbid = lots.filter((lot) => lot.yourBid === null).length;
  if (unbid === 0) return null;
  return {
    count: unbid,
    summary: `${pluralise(unbid, "lot")} open that you have not bid on.`,
  };
}

/* ========================================================================== */
/* Ballots                                                                    */
/* ========================================================================== */

/**
 * Votes and auctions the table is collecting.
 *
 * Both kinds, because the destination's own job is "what am I being asked to
 * decide" and an auction asks that as much as a vote does. The sealed branch
 * carries `castCount` and no `casts` array: §7.2 requires that an in-flight
 * sealed ballot leaks nothing, "including via `castBy` keys" — knowing *who has
 * already answered* is itself information, and a map keyed by voter id gives it
 * away even with the values stripped. The server already sends no `castBy` for a
 * sealed ballot; this type means a future server that did could not be rendered.
 */
export function derivePanelBallots(context: PanelViewerContext): readonly BallotPanelItem[] {
  const castable = new Set<string>(
    context.actions.flatMap((action) =>
      action.type === "ballot.cast" ? [action.ballotId] : [],
    ),
  );

  return context.gameplay.ballots.map((ballot) => {
    const base = {
      id: ballot.id,
      subject: ballotSubjectLine(ballot, "ballot"),
      kind: ballot.kind,
      closesAtRound: ballot.closesAtRound,
      audienceCount: ballot.audience.length,
      youMayCast: castable.has(ballot.id),
      // Your own cast is always yours to see — that is what
      // `SelfGameplayProjection.ballotCasts` exists for, since a sealed ballot
      // projects no `castBy` and a player must still be able to read the bid
      // they just placed.
      yourCast: formatCast(context.gameplay.self.ballotCasts[ballot.id], ballot.kind),
    } as const;

    if (ballot.visibility === "sealed") {
      return { ...base, visibility: "sealed", castCount: ballot.castCount };
    }
    return {
      ...base,
      visibility: "open",
      casts: Object.entries(ballot.castBy).flatMap(([playerId, value]): BallotCast[] => {
        const formatted = formatCast(value, ballot.kind);
        if (formatted === null) return [];
        return [
          { seat: context.slotOf(playerId), name: context.nameOf(playerId), value: formatted },
        ];
      }),
    };
  });
}

/**
 * A cast as display text.
 *
 * An auction's cast is money and a vote's is a choice, so they are formatted
 * differently — `$400` versus `Yes`. Anything the panel cannot render as one line
 * (an object, an array, a null) answers `null` and is dropped rather than printed
 * as `[object Object]`.
 */
function formatCast(value: JsonValue | undefined, kind: BallotProjection["kind"]): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") {
    return kind === "auction" ? formatPanelMoney(value) : value.toLocaleString("en-US");
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value.length === 0 ? null : sentenceCase(value);
  return null;
}

/** The numeric reading of a cast, or null. Used for bid amounts only. */
function numericCast(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * What a ballot is about, in one line.
 *
 * `subject` is an authored `JsonObject`, so the wording is read from it when it
 * carries one and derived from `subjectId` when it does not. A derived line is
 * still a real sentence — "Auction: corner office" beats printing an opaque id at
 * a player who has to decide something about it.
 */
function ballotSubjectLine(ballot: BallotProjection, voice: "ballot" | "lot"): string {
  const authored = readString(ballot.subject, ["question", "title", "label", "name", "summary"]);
  if (authored !== null) return authored;

  const derived = derivedCardName(ballot.subjectId);
  const subject = derived.length === 0 ? ballot.subjectId : derived;
  if (voice === "lot") return subject;
  return ballot.kind === "auction" ? `Auction: ${lowerFirst(subject)}` : subject;
}

/* ========================================================================== */
/* Agreements                                                                 */
/* ========================================================================== */

/**
 * Offers, trades and recorded promises.
 *
 * Two arrays merge here, and the merge order is the load-bearing part.
 * `gameplay.agreements` holds the table-visible deals; `gameplay.self.agreements`
 * holds the ones the viewer is a party to, at any visibility. A deal can appear
 * in both, and the party view wins — it is the same deal, and the party's copy is
 * the one guaranteed to carry terms.
 *
 * A `parties-only` deal the viewer is NOT party to appears in neither array: the
 * server omits it entirely (§7.2, and the partition table in
 * `packages/contracts/src/gameplay.ts`). So the `parties-only` disclosure branch
 * of `AgreementPanelItem` is unreachable from a real payload today. It stays in
 * the union deliberately — it is the shape an existence-only projection would
 * take if the design later decides the table should see that a deal exists — and
 * keeping it means adding that projection is a server change, not a redaction
 * redesign in the UI.
 */
export function derivePanelAgreements(
  context: PanelViewerContext,
): readonly AgreementPanelItem[] {
  const awaiting = new Set<string>(
    context.actions.flatMap((action) =>
      action.type === "agreement.respond" ? [action.agreementId] : [],
    ),
  );

  const merged = new Map<string, PublicAgreementProjection | PartyAgreementProjection>();
  for (const agreement of context.gameplay.agreements) merged.set(agreement.id, agreement);
  for (const agreement of context.gameplay.self.agreements) merged.set(agreement.id, agreement);

  return [...merged.values()].map((agreement) => ({
    id: agreement.id,
    proposerName: context.nameOf(agreement.proposerId),
    proposerSeat: context.slotOf(agreement.proposerId),
    recipientNames: agreement.recipientIds.map((id) => context.nameOf(id)),
    status: agreement.status,
    expiresAtRound: agreement.expiresAtRound,
    awaitingYou: awaiting.has(agreement.id),
    disclosure: "visible",
    give: agreement.give.map(tradeItemTerm),
    receive: agreement.receive.map(tradeItemTerm),
  }));
}

/**
 * One clause of a deal, with the one fact that decides whether it is worth
 * anything: `enforced`.
 *
 * §5.5's moral is that a transfer is settled by the engine and a promise is not.
 * The panel prints that on every clause rather than in a footnote, so `promise`
 * is the only kind here that answers `false` — and it is the only kind whose
 * `detail` is the player's own words rather than a description of a mechanic.
 */
function tradeItemTerm(item: TradeItem): AgreementTerm {
  switch (item.kind) {
    case "money":
      return {
        label: formatPanelMoney(item.amount),
        detail: "Cash, moved by the office the moment the deal is accepted.",
        enforced: true,
      };
    case "card":
      return {
        label: "Card",
        detail: "A named card changes hands on accept. You will not see which until it does.",
        enforced: true,
      };
    case "token":
      return {
        label: `${item.quantity}× ${tokenLabel(item.tokenId)}`,
        detail: "Tokens are transferred on accept.",
        enforced: true,
      };
    case "tile":
      return {
        label: `Tile ${item.tileId.replace("tile.board.", "").replaceAll("-", " ")}`,
        detail: "The claim on that tile is reassigned, along with its tolls.",
        enforced: true,
      };
    case "immunity":
      return {
        label: `Immunity ${pluralise(item.rounds, "round")}`,
        detail: "Preventable effects aimed at the holder are ignored for that long.",
        enforced: true,
      };
    case "promise":
      return {
        label: "Promise",
        detail: item.text,
        // The whole reason table talk matters. A player who thinks this binds has
        // been misled by the UI, not by their opponent.
        enforced: false,
      };
    default:
      return item satisfies never;
  }
}

function tokenLabel(tokenId: string): string {
  return tokenId.replace("token.", "").replaceAll("-", " ");
}

/* ========================================================================== */
/* Objectives                                                                 */
/* ========================================================================== */

/**
 * Objectives, and the two shapes they take.
 *
 * The viewer's own objectives (`gameplay.self.objectives`) render in full,
 * secret or not — they are the player's own goals and hiding them from their
 * owner would be a bug rather than a redaction. Another seat's *public* objective
 * also renders in full, because a public objective is public.
 *
 * Another seat's *secret* objective becomes a {@link ConcealedObjective}: an id
 * and an owner, and no title, progress, target or reward, because the type has no
 * field for any of them. §7.2 calls this "existence-only", and existence is
 * genuinely the right amount — it justifies suspicion without handing over the
 * answer.
 *
 * The viewer's own secret objective arrives twice (once redacted in the public
 * array, once in full under `self`), so the self entry is applied last and wins.
 */
export function derivePanelObjectives(
  context: PanelViewerContext,
): readonly ObjectivePanelItem[] {
  const items = new Map<string, ObjectivePanelItem>();

  for (const objective of context.gameplay.objectives) {
    items.set(objective.id, publicObjectiveItem(context, objective));
  }
  for (const objective of context.gameplay.self.objectives) {
    items.set(objective.id, selfObjectiveItem(context, objective));
  }

  return [...items.values()];
}

function publicObjectiveItem(
  context: PanelViewerContext,
  objective: PublicObjectiveProjection,
): ObjectivePanelItem {
  if (objective.visibility === "secret") {
    return {
      kind: "concealed",
      id: objective.id,
      ownerName: context.nameOf(objective.ownerId),
      ownerSeat: context.slotOf(objective.ownerId),
    } satisfies ConcealedObjective;
  }

  return {
    kind: "visible",
    id: objective.id,
    title: objectiveTitle(objective.definitionId),
    detail: objectiveDetail(objective.target, objective.rewardPoints, objective.rewardMoney),
    progress: objective.progress,
    target: objective.target,
    rewardPoints: objective.rewardPoints,
    rewardMoney: objective.rewardMoney,
    ownerName: objective.ownerId === null ? null : context.nameOf(objective.ownerId),
    ownerSeat: context.slotOf(objective.ownerId),
    completedAtRound: objective.completedAtRound,
    secret: false,
  } satisfies VisibleObjective;
}

function selfObjectiveItem(
  context: PanelViewerContext,
  objective: SelfObjectiveProjection,
): VisibleObjective {
  return {
    kind: "visible",
    id: objective.id,
    title: objectiveTitle(objective.definitionId),
    detail: objectiveDetail(objective.target, objective.rewardPoints, objective.rewardMoney),
    progress: objective.progress,
    target: objective.target,
    rewardPoints: objective.rewardPoints,
    rewardMoney: objective.rewardMoney,
    ownerName: objective.ownerId === null ? null : context.nameOf(objective.ownerId),
    ownerSeat: context.slotOf(objective.ownerId),
    completedAtRound: objective.completedAtRound,
    secret: objective.visibility === "secret",
  };
}

/** "objective.bank-five-thousand" reads as "Bank five thousand". */
function objectiveTitle(definitionId: string): string {
  const derived = derivedCardName(definitionId);
  return derived.length === 0 ? "Objective" : derived;
}

/**
 * The objective's own terms, stated rather than left to the meter.
 *
 * No objective content pack exists yet (nothing in `packages/content` authors
 * `ObjectiveId` copy), so this is derived from the projected numbers instead of
 * invented: the target and the reward are facts the server sent, and a sentence
 * built from facts is honest in a way a placeholder description would not be.
 */
function objectiveDetail(target: number, rewardPoints: number, rewardMoney: number): string {
  const reward =
    rewardMoney === 0
      ? `${pluralise(rewardPoints, "point")} at scoring`
      : `${pluralise(rewardPoints, "point")} and ${formatPanelMoney(rewardMoney)} at scoring`;
  return `Reach ${target.toLocaleString("en-US")} to score ${reward}.`;
}

/* ========================================================================== */
/* Heat                                                                       */
/* ========================================================================== */

/**
 * Heat, for the viewer and for the table.
 *
 * Public by design, and this is a rules decision rather than an oversight: heat
 * exists so aggression costs the aggressor (§5.4), and a deterrent nobody can see
 * deters nobody. `self` is null exactly when the mode has heat switched off, which
 * is what makes the panel able to explain why an attack was free instead of
 * rendering an empty meter.
 */
export function derivePanelHeat(context: PanelViewerContext): {
  readonly self: HeatSelfReadout | null;
  readonly seats: readonly HeatSeatReadout[];
} {
  if (!context.gameplay.rules.conflict.heatEnabled) {
    return { self: null, seats: [] };
  }

  const own = context.gameplay.players.find(
    (player) => player.playerId === context.selfPlayerId,
  );

  return {
    self:
      own === undefined
        ? null
        : {
            value: own.heat.value,
            threshold: own.heat.threshold,
            investigationsOpened: own.heat.investigationsOpened,
            lastIncrementedAtRound: own.heat.lastIncrementedAtRound,
          },
    seats: context.gameplay.players.map((player) => ({
      seat: context.slotOf(player.playerId) ?? 1,
      name: context.nameOf(player.playerId),
      value: player.heat.value,
      threshold: player.heat.threshold,
      // "Under review" means the threshold has been crossed AND an investigation
      // was actually opened — a player sitting exactly at the line with no
      // investigation on record is at risk, not under review, and the panel's
      // critical stamp should not claim otherwise.
      underInvestigation:
        player.heat.investigationsOpened > 0 && player.heat.value >= player.heat.threshold,
    })),
  };
}

/* ========================================================================== */
/* Quarters and the event track                                               */
/* ========================================================================== */

/**
 * The fiscal calendar, and next quarter's announced shock.
 *
 * The announcement is the reason this destination exists. §5.7: announce a global
 * event **one quarter ahead**, because "a known-in-advance shock that players can
 * prepare for is a decision; an unannounced one is just variance". A docked panel
 * is how that announcement survives a whole quarter instead of being a toast the
 * player blinked past.
 */
export function derivePanelQuarters(context: PanelViewerContext): {
  readonly quarters: readonly QuarterStep[];
  readonly round: number;
  readonly announcement: QuarterAnnouncement | null;
} {
  const current = context.gameplay.currentQuarterIndex;
  const quarters = context.gameplay.quarters.map(
    (quarter): QuarterStep => ({
      index: quarter.index,
      label: `Q${quarter.index + 1}`,
      startsAtRound: quarter.startedAtRound,
      endsAtRound: quarter.endsAtRound,
      state: quarterState(quarter.index, current),
      scheduledEventLabel: globalEventTitle(quarter.scheduledEventId),
      resolvedEventLabels: quarter.resolvedEventIds
        .map((id) => globalEventTitle(id))
        .filter((label): label is string => label !== null),
    }),
  );

  const next = context.gameplay.quarters.find((quarter) => quarter.index === current + 1);
  const announcedId = next?.scheduledEventId ?? null;
  const title = globalEventTitle(announcedId);

  return {
    quarters,
    round: context.round,
    announcement:
      next === undefined || announcedId === null || title === null
        ? null
        : {
            quarterLabel: `Q${next.index + 1}`,
            title,
            detail: globalEventDetail(announcedId),
            startsAtRound: next.startedAtRound,
          },
  };
}

function quarterState(index: number, currentIndex: number): QuarterState {
  if (index < currentIndex) return "past";
  return index === currentIndex ? "current" : "future";
}

function findGlobalEvent(eventId: string | null): GlobalEventConfig | null {
  if (eventId === null) return null;
  const events: Readonly<Record<string, GlobalEventConfig>> = deadlineDashContent.globalEvents;
  return events[eventId] ?? null;
}

/** "globalEvent.budget-freeze" reads as "Budget freeze". Null stays null. */
function globalEventTitle(eventId: string | null): string | null {
  if (eventId === null) return null;
  const derived = derivedCardName(eventId);
  return derived.length === 0 ? eventId : derived;
}

/**
 * What next quarter's event will do, in one paragraph.
 *
 * Built from the authored event rather than from a translation key: the content
 * pack carries only `descriptionKey`, and this app has no i18n catalogue, so
 * printing the key would tell a player nothing. Its `effects` go through the card
 * module's own `describeEffect` — the same readout the hand and the card face use,
 * so a "pay $500" reads identically wherever it appears — and its `modifiers` go
 * through the table below, because a rule suspended for a whole quarter is not
 * something that happens to a player and has no `EffectDescriptor` to describe it.
 */
function globalEventDetail(eventId: string | null): string {
  const event = findGlobalEvent(eventId);
  if (event === null) {
    return "The office has not said what this one does yet.";
  }

  const clauses = [
    ...event.modifiers.map((modifier) => modifierSentence(modifier)),
    ...event.effects.map((effect) => scopedEffectSentence(effect, event.scope)),
  ].filter((clause) => clause.length > 0);

  if (clauses.length === 0) return "It is scheduled, but changes nothing on its own.";
  return clauses.join(" ");
}

function modifierSentence(modifier: GlobalEventModifier): string {
  switch (modifier.type) {
    case "blockPromotions":
      return "No promotions go through for the whole quarter.";
    case "blockLoans":
      return "No new loans can be taken for the whole quarter.";
    case "blockTileClaims":
      return "No tile can be claimed for the whole quarter.";
    case "suspendUpkeep":
      return "Upkeep is not charged for the whole quarter.";
    case "multiplySalary":
      return `Every salary payment is multiplied by ${modifier.multiplier} for the quarter.`;
    case "multiplyProjectPayout":
      return `Every project payout is multiplied by ${modifier.multiplier} for the quarter.`;
    case "adjustHeatThreshold":
      return modifier.delta < 0
        ? `Scrutiny tightens: the heat threshold drops by ${Math.abs(modifier.delta)} for the quarter.`
        : `Scrutiny relaxes: the heat threshold rises by ${modifier.delta} for the quarter.`;
    case "demoteLowest":
      return `Whoever is lowest on ${modifier.resource} loses a rank when the quarter opens.`;
    default:
      return "";
  }
}

/**
 * One authored effect, prefixed with who it lands on.
 *
 * `describeEffect` writes in the imperative for a self-targeted effect ("Pay
 * $500"), which is the wrong voice for a table-wide announcement — the reader is
 * not necessarily in scope. The scope phrase restores the subject.
 */
function scopedEffectSentence(effect: EffectDescriptor, scope: GlobalEventScope): string {
  const readout = describeEffect(effect);
  return `${scopePhrase(scope)}: ${lowerFirst(readout.sentence)}`;
}

function scopePhrase(scope: GlobalEventScope): string {
  switch (scope) {
    case "all-players":
      return "Everyone at the table";
    case "leader":
      return "Whoever is leading";
    case "trailing-players":
      return "Everyone at the back of the pack";
    case "players-with-heat":
      return "Everyone carrying heat";
    case "players-in-debt":
      return "Everyone carrying debt";
    default:
      return "Everyone in scope";
  }
}

/**
 * The announcement is worth a badge exactly once per quarter turnover.
 *
 * §5.7's rule is that a shock is only a decision if the table sees it coming, and
 * the panel it lives in is behind a tab (§12.2 puts the calendar in tier 2). A
 * badge is the cheapest thing that makes "look at the calendar" happen.
 */
function quarterAttention(announcement: QuarterAnnouncement | null): PanelAttention | null {
  if (announcement === null) return null;
  return {
    count: 1,
    summary: `${announcement.title} is scheduled for ${announcement.quarterLabel}, starting in round ${announcement.startsAtRound}.`,
  };
}

/* ========================================================================== */
/* The card and event feed                                                    */
/* ========================================================================== */

/**
 * Cards issued and office-wide notices, newest first.
 *
 * Everything here is **already committed** — the server applied it before this
 * browser heard about it — which is why the panel presents records rather than
 * alerts, and why nothing in it needs an answer. That is the direct answer to
 * "notif gak modal yang nutupin": a docked record neither covers the board nor
 * resizes it.
 *
 * Only the event types that a player would want to re-read are lifted. Movement,
 * dice and bookkeeping stay in the Activity log — this feed is not a second copy
 * of it, and putting all thirty types in both is how the rail becomes
 * unreadable again.
 */
export function derivePanelEvents(context: PanelViewerContext): readonly EventFeedItem[] {
  const items: EventFeedItem[] = [];

  for (const event of context.game.eventSummaries) {
    const item = feedItem(context, event);
    if (item !== null) items.push(item);
  }

  return items.reverse();
}

/** Committed events that read as a record worth keeping. */
const NOTICE_TITLES: Readonly<Record<string, string>> = {
  CardPlayed: "Card played",
  CardStored: "Card kept in hand",
  EffectPrevented: "Effect prevented",
  PromotionBlocked: "Promotion blocked",
  ManagementRevealed: "Management revealed",
  PlayerPromoted: "Promotion confirmed",
  ClockDeckExhausted: "The clock deck ran out",
  MatchEnded: "Match ended",
};

function feedItem(
  context: PanelViewerContext,
  event: SafeEventSummary,
): EventFeedItem | null {
  const actorPlayerId = event.actorPlayerId;
  const shared = {
    id: event.id,
    audience: audienceFor(context, actorPlayerId),
    actorName: actorPlayerId === null ? null : context.nameOf(actorPlayerId),
    actorSeat: context.slotOf(actorPlayerId),
    occurredAt: event.occurredAt,
  } as const;

  if (event.type === "CardDrawn") {
    const authored = findAuthoredCard(event.card.definitionId);
    return {
      ...shared,
      kind: "card",
      title: authored === null ? derivedCardName(event.card.definitionId) : cardCopy(authored).name,
      source:
        authored === null
          ? `${event.card.deckId.replace("deck.", "").replaceAll("-", " ")} deck`
          : `${deckDisplayName(authored.deck)} deck`,
      summary: cardEffectSummary(authored?.card.effects ?? []),
    };
  }

  const title = NOTICE_TITLES[event.type];
  if (title === undefined) return null;

  return {
    ...shared,
    kind: event.type === "ClockDeckExhausted" || event.type === "MatchEnded" ? "global-event" : "notice",
    title,
    source: null,
    summary: null,
  };
}

/**
 * Mine / theirs / the office — the split the feedback layer already uses.
 *
 * "notif kebanyakan (dipisah yang sendiri atau lawan)" is answered structurally
 * rather than by a name label: `events-panel.tsx` turns this into a tonal step, a
 * seat rule and a text stamp, so a row's owner is readable in peripheral vision.
 */
function audienceFor(
  context: PanelViewerContext,
  actorPlayerId: string | null,
): EventFeedItem["audience"] {
  if (actorPlayerId === null) return "office";
  return actorPlayerId === context.selfPlayerId ? "mine" : "theirs";
}

/**
 * What a drawn card did, in one line.
 *
 * The card's authored effects through the shared readout, capped at two clauses:
 * this is a feed row at rail measure, and a `rollCheck` with four nested outcomes
 * would otherwise print a paragraph. The full detail is the card-draw record's
 * job, which has room for it.
 */
function cardEffectSummary(effects: readonly EffectDescriptor[]): string | null {
  if (effects.length === 0) return null;
  const sentences = effects.slice(0, 2).map((effect) => describeEffect(effect).sentence);
  const more = effects.length > 2 ? ` And ${pluralise(effects.length - 2, "more effect")}.` : "";
  return `${sentences.join(" ")}${more}`;
}

/* ========================================================================== */
/* Small shared readers                                                       */
/* ========================================================================== */

/**
 * The first non-empty string among `fields` of an authored `JsonObject`.
 *
 * Probing a small set of plausible names rather than one, for the same reason
 * `authored-card-copy.ts` does: these objects are authored content whose field
 * names are not yet settled, and a near-miss should still render a real line
 * instead of an opaque id.
 */
function readString(source: JsonObject, fields: readonly string[]): string | null {
  for (const field of fields) {
    const value = source[field];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

/** `rank.senior-manager` reads as "Senior manager"; an unlabelled rank as a tier. */
function rankLabel(rank: { readonly kind: string | null; readonly index: number }): string {
  const kind = rank.kind;
  if (kind === null || kind.length === 0) return `Tier ${rank.index + 1}`;
  return sentenceCase(kind.replace("rank.", "").replaceAll("-", " "));
}

/** 1-based, zero-padded board position: tile 7 (index 6) renders as "07". */
function tileLabel(position: number): string {
  return String(position + 1).padStart(2, "0");
}

function sentenceCase(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function lowerFirst(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}
