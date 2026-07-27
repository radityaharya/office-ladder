import { deadlineDashBoard } from "@office-ladder/content";
import type {
  GameBootstrap,
  GameplayBootstrap,
  LegalActionSummary,
  PublicGameProjection,
} from "@office-ladder/contracts";

import type {
  BoardPlacementView,
  BoardPlateMarker,
  BoardPlateReadout,
  BoardSpaceView,
  BoardTileOwnershipView,
  BoardZone,
  PlayerSeat,
  PlayerTokenView,
} from "./board";
/* The actions directory ships no barrel, so every import of it names the module.
   Deliberately not adding one: `apps/web/src/components/game/actions/` belongs to
   another owner this round. */
import type { ActionContext, ActionSeat } from "./actions/action-model";
import { seatSlot } from "./turn-rail";

type ContentTile = (typeof deadlineDashBoard.spaces)[number];
type ContentTileKind = ContentTile["kind"];

/**
 * Facility code + tonal zone per authored tile kind. The code is what makes a
 * zone readable without relying on colour (DESIGN.md §8): every tile shows it.
 * Keyed exhaustively off the content pack so a new tile kind fails typecheck
 * here rather than rendering an unlabelled square.
 */
const tileFacilities = {
  receptionist: { code: "RCP", zone: "landmark" },
  "board-meeting": { code: "BRD", zone: "landmark" },
  "annual-event": { code: "ANL", zone: "landmark" },
  audit: { code: "AUD", zone: "hazard" },
  burnout: { code: "BRN", zone: "hazard" },
  work: { code: "WRK", zone: "workfloor" },
  "energy-restore": { code: "BRK", zone: "break" },
  meeting: { code: "MTG", zone: "social" },
  networking: { code: "NET", zone: "social" },
  event: { code: "EVT", zone: "social" },
  finance: { code: "FIN", zone: "service" },
  hr: { code: "HR", zone: "service" },
  legal: { code: "LGL", zone: "service" },
  it: { code: "IT", zone: "service" },
  marketing: { code: "MKT", zone: "service" },
  sales: { code: "SLS", zone: "service" },
  operation: { code: "OPS", zone: "service" },
  training: { code: "TRN", zone: "service" },
  "ceo-office": { code: "CEO", zone: "service" },
  "ceo-favorite": { code: "FAV", zone: "service" },
  "best-employee": { code: "BST", zone: "service" },
} as const satisfies Record<
  ContentTileKind,
  { readonly code: string; readonly zone: BoardZone }
>;

const zoneLabels = {
  landmark: "Landmark",
  workfloor: "Work floor",
  service: "Service desk",
  social: "Social",
  break: "Break room",
  hazard: "Hazard",
} as const satisfies Record<BoardZone, string>;

/** Segments of a tile's displayNameKey that are initialisms, not words. */
const nameInitialisms = new Set(["ceo", "hr", "it"]);

/**
 * Shorter whole-word forms for the room names that do not fit a narrow cell.
 *
 * The board renders both forms and swaps between them with a container query, so
 * no label ever hyphenates mid-word ("Operati/on") or ellipsises mid-word
 * ("Best em…") — the two failure modes the square board produced at 50px cells.
 * Every entry here is a real word or a complete pair of words, never a chopped
 * one, and the full name always stays in the tile's accessible name. Names not
 * listed are already short enough at every width the board renders at.
 */
const shortTileNames: Record<string, string> = {
  "Annual event": "Annual",
  "Best employee": "Best",
  "Board meeting": "Boardroom",
  "CEO favorite": "Favorite",
  "CEO office": "CEO",
  "Coffee machine": "Coffee",
  "Employee lounge": "Lounge",
  "Lunch break": "Lunch",
  "Office gossip": "Gossip",
  Receptionist: "Reception",
  "Smoking area": "Smoking",
};

export function createGameView(bootstrap: GameBootstrap) {
  const game = bootstrap.publicProjection;
  const spaces = deadlineDashBoard.spaces.map(toBoardSpace);
  const activePlayer =
    game.players.find((player) => player.id === game.activePlayerId) ?? null;
  const activeTile = activePlayer?.position ?? null;
  const landedTile = resolveLandedTile(game, activeTile);
  const activeSpace = spaceAt(spaces, activeTile);
  const activeName = activePlayer
    ? memberName(bootstrap, activePlayer.id, seatSlot(game, activePlayer.id))
    : "The server";
  const promptAction = findPromptAction(bootstrap.legalActions);
  const latestEvent = game.eventSummaries.at(-1);

  const players = game.players.flatMap((player): readonly PlayerTokenView[] => {
    // `PublicPlayerProjection.seat` is the engine's turn `order`, which is
    // ZERO-based in the real projection (`projections.ts` maps `seat:
    // player.order`, and `game-setup.ts` assigns `order` from a 0-based index).
    // Reading it directly dropped the player in slot 0 from the board entirely —
    // `playerSeat(0)` is null — which the 1-based test fixtures hid. `seatSlot`
    // derives 1..6 from the player's index in the already turn-ordered
    // `game.players`, which is also what the rail uses, so a token's seat colour
    // and its dossier row's seat colour are guaranteed to agree.
    const seat = playerSeat(seatSlot(game, player.id));
    if (seat === null) return [];

    const member = bootstrap.room.members.find(
      (candidate) => candidate.id === player.id,
    );
    const name = member?.displayName ?? `Seat ${seat}`;

    return [
      {
        id: player.id,
        name,
        seat,
        position: player.position,
        initials: initials(name),
        isBot: member?.isBot ?? false,
        /*
         * The photo on the token. `player-token.tsx` gates the value again at the
         * render boundary (`renderableAvatarUrl`) and only ever puts it in an
         * `img src`, so this is one field on an object literal that already looks
         * the member up for `displayName` — without it the whole faced-plate
         * layout the board built is dead code.
         *
         * `null` for a bot by contract, which the token relies on: an empty face
         * cell for a machine would be a lie, so it draws its hatched rule instead.
         */
        avatarUrl: member?.avatarUrl ?? null,
        state:
          player.id === game.activePlayerId
            ? "current"
            : player.connected
              ? "idle"
              : "disconnected",
      },
    ];
  });

  return {
    activeTile,
    landedTile,
    canRoll:
      findRollAction(bootstrap.legalActions) !== null &&
      game.activePlayerId === bootstrap.self.playerId,
    incident: {
      status:
        game.status === "ended"
          ? "Match closed"
          : `Round ${game.round} · Turn ${game.turnNumber}`,
      title:
        game.status === "ended" ? "Final review complete" : `${activeName}'s turn`,
      description: describeFloor({
        activeName,
        game,
        hasPrompt: promptAction !== null,
        spaceLabel: activeSpace?.label ?? null,
      }),
      marker: floorMarker(game, promptAction !== null),
      readouts: floorReadouts(game, activeTile, activeSpace),
      detail: latestEvent
        ? `Committed through revision ${latestEvent.revision} · ${latestEvent.type}`
        : "No committed events yet.",
    },
    players,
    spaces,
  };
}

/**
 * What the shell's attention band should be showing. Never `null`.
 *
 * The band is a fixed row in the shell grid (see `GameLayout`), so this only
 * decides its CONTENT — nothing here can move the board. It is the home for
 * anything time-limited: a reaction window, an open decision, and in v2 closing
 * ballots and the quarter/event track.
 *
 * **At rest that is not nothing.** This used to return `null` whenever no
 * decision was open, which was most of the match, and the band then rendered the
 * literal string "ATTENTION —": a reserved 40px instrument row spent saying
 * nothing, in a UI whose governing complaint is "i genuinely cant follow the
 * game". The resting answer to "what is the table waiting for" is whose turn it
 * is and how long they have left — the one fact a watching player wants, and
 * until now the one they had to go and find in the rail head.
 *
 * The reservation is unchanged; only what fills it is. Priority still runs
 * reaction -> decision -> match state -> whose turn, so an open decision
 * addressed to the viewer outranks the resting line exactly as before.
 *
 * Deliberately derived from the CANONICAL bootstrap by the caller, not from the
 * paced one: a countdown that plays back late is a lie about a deadline, and the
 * resting turn line is a countdown like any other.
 */
export type AttentionNoticeDescriptor = {
  readonly label: string;
  readonly detail: string;
  readonly tone: "info" | "caution" | "critical";
  /**
   * The window this notice is on, as the server's own two numbers, or `null`
   * when nothing here is timed.
   *
   * This used to be a pre-formatted `string` — the result of a
   * `/T(\d{2}:\d{2}:\d{2})/` regex over `deadlineAt`, which is a *timestamp*, not
   * a countdown: it told a player the wall-clock instant their eight-second
   * reaction window closes and left them to subtract. §12.3 requires a depleting
   * bar precisely because that subtraction is the whole problem. So the pair
   * leaves here raw and the band renders a `DeadlineMeter` over it.
   *
   * `durationMs` gives the bar its scale and is `null` when the server did not
   * arm one; the meter then degrades to a resting lane rather than inventing a
   * proportion.
   */
  readonly deadline: AttentionDeadline | null;
};

export type AttentionDeadline = {
  readonly deadlineAt: string | null;
  readonly durationMs: number | null;
  /**
   * Own versus opponent, carried structurally as well as in the sentence — the
   * same two values `DeadlineMeter` takes, because the band's clock and the rail
   * head's clock are the same instrument and must not disagree about whose it is.
   *
   * This travels WITH the pair rather than beside it: a deadline with no owner is
   * not describable, and the band used to hardcode "self" because the only clocks
   * it ever hosted were the viewer's own. The resting turn line is the first one
   * that can belong to somebody else, and a self-toned (amber, "this needs you")
   * bar on a bot's turn is exactly the noise §12.1 exists to remove.
   */
  readonly owner: "self" | "opponent";
  /** Who the clock is on, e.g. `"you"` or `"seat 3"`. */
  readonly subject: string;
  /** What the server does at zero, stated in words (§12.3 forbids a number). */
  readonly expiryNote: string;
};

/*
 * What the server does when a band clock reaches zero, per kind of clock. Stated
 * in words because the bar is deliberately not a number and a player still has to
 * know the consequence. The turn wordings match `TurnClock`'s (game-hud.tsx) so
 * the two instruments describe the same deadline the same way.
 */
const SERVER_ANSWERS_FOR_YOU = "At zero the server answers for you and the match continues.";
const SERVER_ROLLS_FOR_YOU =
  "At zero the server rolls for you, so the table is never blocked.";
const SERVER_ROLLS_FOR_THEM =
  "At zero the server rolls on their behalf, so the table is never blocked.";

/**
 * What the band should be showing, in priority order: an open reaction window
 * first (it is the shortest clock in the game and the only one measured in
 * seconds), then an open decision, then the match's own state, then — always —
 * whose turn it is and how long they have left.
 *
 * A reaction window outranks a prompt because losing it is silent — the server
 * closes it and the effect lands — whereas an unanswered prompt stalls the turn
 * and keeps asking. Both outrank the resting line, which is by construction the
 * least urgent thing the band can say: it is what fills the row when nothing is
 * being asked of anybody.
 *
 * The tail never falls through to `null`. One row, one answer, always.
 */
export function createAttentionNotice(bootstrap: GameBootstrap): AttentionNoticeDescriptor {
  const reaction = openReaction(bootstrap);
  if (reaction !== null) {
    return {
      label: "Reaction",
      detail: `${reactionKindLabel(reaction.kind)} — this window closes on its own.`,
      tone: "critical",
      deadline: {
        deadlineAt: reaction.deadlineAt,
        durationMs: reactionWindowMs(bootstrap),
        owner: "self",
        subject: "you",
        expiryNote: SERVER_ANSWERS_FOR_YOU,
      },
    };
  }

  const prompt = findPromptAction(bootstrap.legalActions);
  if (prompt !== null) {
    const game = bootstrap.publicProjection;

    return {
      label: "Decision",
      detail: `${promptKindLabel(prompt)} is waiting on you.`,
      tone: "caution",
      deadline: promptDeadline(bootstrap, prompt) ?? {
        deadlineAt: game.deadlineAt,
        durationMs: game.turnTimerDurationMs,
        owner: "self",
        subject: "you",
        expiryNote: SERVER_ANSWERS_FOR_YOU,
      },
    };
  }

  return restingNotice(bootstrap);
}

/**
 * The band with nothing being asked of anybody: whose turn it is, and their
 * clock.
 *
 * This is the state the band spends most of a match in, which is why it gets a
 * real answer rather than a placeholder. It is deliberately ONE line and one
 * answer — not a second activity feed. The rail's Activity panel is the feed; the
 * band says who the table is waiting for and nothing else.
 *
 * Own versus opponent is carried three ways, none of them a name label alone
 * (§12.1): the label word, the tone (caution when it is on you, info when it is
 * not), and the deadline's `owner`, which tones the bar itself.
 */
function restingNotice(bootstrap: GameBootstrap): AttentionNoticeDescriptor {
  const game = bootstrap.publicProjection;

  if (game.status === "paused") {
    return { label: "Paused", detail: "The match is paused.", tone: "info", deadline: null };
  }
  if (game.status === "ended") {
    return { label: "Result", detail: matchResultDetail(bootstrap), tone: "info", deadline: null };
  }
  if (game.status === "setup") {
    return {
      label: "Standing by",
      detail: "The match has not started yet.",
      tone: "info",
      deadline: null,
    };
  }

  const activePlayerId = game.activePlayerId;
  if (activePlayerId === null) {
    /* Between turns: the server holds the move and no seat's clock is armed, so
       a bar here would be a proportion of nothing. */
    return {
      label: "Standing by",
      detail: "Nobody is on the clock.",
      tone: "info",
      deadline: null,
    };
  }

  const seat = seatSlot(game, activePlayerId);
  if (activePlayerId === bootstrap.self.playerId) {
    return {
      label: "Your turn",
      detail: "The table is waiting on you.",
      tone: "caution",
      deadline: {
        deadlineAt: game.deadlineAt,
        durationMs: game.turnTimerDurationMs,
        owner: "self",
        subject: "you",
        expiryNote: SERVER_ROLLS_FOR_YOU,
      },
    };
  }

  return {
    label: "Turn",
    detail: `${memberName(bootstrap, activePlayerId, seat)} is taking their turn.`,
    tone: "info",
    deadline: {
      deadlineAt: game.deadlineAt,
      durationMs: game.turnTimerDurationMs,
      owner: "opponent",
      subject: `seat ${seat}`,
      expiryNote: SERVER_ROLLS_FOR_THEM,
    },
  };
}

/**
 * The one sentence a finished match owes the band.
 *
 * `winnerPlayerIds` is plural because the ruleset allows a shared result; the
 * band is one row, so anything other than a single winner reports the fact and
 * leaves the detail to the result screen.
 */
function matchResultDetail(bootstrap: GameBootstrap): string {
  const game = bootstrap.publicProjection;
  const winners = game.winnerPlayerIds;
  if (winners.includes(bootstrap.self.playerId)) return "You took the match.";

  const [winner] = winners;
  if (winners.length === 1 && winner !== undefined) {
    return `${memberName(bootstrap, winner, seatSlot(game, winner))} took the match.`;
  }

  return "The match is over.";
}

/**
 * A reaction window this viewer can still act in.
 *
 * `hasPassed`/`hasPlayed` are the viewer's own answer, so a window they have
 * already resolved is not still shouting at them — but the window itself stays
 * open for the other seats, which is why this reads the viewer's flags rather
 * than the window's existence.
 */
function openReaction(
  bootstrap: GameBootstrap,
): GameBootstrap["reactions"][number] | null {
  return (
    bootstrap.reactions.find(
      (candidate) => !candidate.hasPassed && !candidate.hasPlayed,
    ) ?? null
  );
}

/**
 * The reaction window's full budget, from the ruleset the MATCH froze at
 * `game.start` — not from the content pack as it stands today, because a mid-match
 * deploy must not change what the bar claims (§5.9).
 *
 * `ReactionProjection` carries an instant but no duration, so without this the
 * bar has an end and no scale. Read through an optional narrowing because a
 * plain `GameBootstrap` has no `gameplay` block at all.
 */
function reactionWindowMs(bootstrap: GameBootstrap): number | null {
  const seconds = asGameplayBootstrap(bootstrap)?.gameplay.rules.interaction
    .reactionWindowSeconds;

  return typeof seconds === "number" && seconds > 0 ? seconds * 1_000 : null;
}

/**
 * The prompt's own deadline, when the server armed one.
 *
 * `PromptProjection.deadlineAt` documents itself as "the same instant as
 * `PublicGameProjection.deadlineAt` while this prompt is what the clock is
 * waiting on", so the turn timer's duration is the right scale for it — the
 * caller falls back to the turn pair when no prompt row carries an instant.
 */
function promptDeadline(
  bootstrap: GameBootstrap,
  prompt: Extract<LegalActionSummary, { readonly type: "prompt.respond" }>,
): AttentionDeadline | null {
  const row = bootstrap.prompts.find(
    (candidate) => candidate.id === prompt.decisionPointId,
  );
  if (row === undefined || row.deadlineAt === null) return null;

  return {
    deadlineAt: row.deadlineAt,
    durationMs: bootstrap.publicProjection.turnTimerDurationMs,
    /* A prompt in the band is by definition addressed to this viewer —
       `findPromptAction` reads their own legal actions — so this clock is
       always theirs. */
    owner: "self",
    subject: "you",
    expiryNote: SERVER_ANSWERS_FOR_YOU,
  };
}

function reactionKindLabel(kind: string): string {
  if (kind === "prevention") return "An effect is about to land";
  if (kind === "end-turn") return "The turn is closing";
  if (kind === "promotion-block") return "A promotion is on the table";

  return sentenceCase(kind.replaceAll("-", " "));
}

function promptKindLabel(prompt: object): string {
  const candidate: { readonly kind?: unknown } = prompt;
  if (typeof candidate.kind !== "string" || candidate.kind.length === 0) {
    return "A decision";
  }
  return sentenceCase(candidate.kind.replaceAll("-", " "));
}

export function findRollAction(
  actions: readonly LegalActionSummary[],
): Extract<LegalActionSummary, { readonly type: "turn.roll" }> | null {
  return actions.find((action) => action.type === "turn.roll") ?? null;
}

export function findPromptAction(
  actions: readonly LegalActionSummary[],
): Extract<LegalActionSummary, { readonly type: "prompt.respond" }> | null {
  return actions.find((action) => action.type === "prompt.respond") ?? null;
}

/* -------------------------------------------------------------------------- */
/* The v2 blocks: narrowing, board territory, and the action context.         */
/* -------------------------------------------------------------------------- */

/**
 * `GameplayBootstrap` when the server sent the v2 block, `null` when it did not.
 *
 * `GameplayBootstrap` is declared as an *intersection* with `GameBootstrap`
 * (contracts, §5.9) so the v2 payload is purely additive — which also means the
 * declared type of everything this client already holds says nothing about
 * whether `gameplay` is there. A shape check is the only honest narrowing, and
 * the alternative — casting — would put eleven panels one field access away from
 * a render-time `undefined.rules`, which is exactly the class of failure that
 * made `/rooms/:id/game` unreachable before.
 *
 * Deliberately shallow: it proves the block EXISTS and carries the two
 * collections everything downstream indexes. It does not re-validate the
 * projection, because the server is the authority on its own redaction and a
 * second validator here would be a second thing to keep in step.
 */
export function asGameplayBootstrap(
  bootstrap: GameBootstrap | null,
): GameplayBootstrap | null {
  if (bootstrap === null) return null;
  /*
   * Read through an index rather than a declared optional field: `GameBootstrap`
   * does not declare `gameplay` at all, so a `{ gameplay?: unknown }` annotation
   * is rejected outright ("no properties in common"). Indexing is the honest
   * expression of "this key may or may not be here".
   */
  const gameplay = readField(bootstrap, "gameplay");
  if (typeof gameplay !== "object" || gameplay === null) return null;
  if (readField(gameplay, "rules") === undefined) return null;
  if (!Array.isArray(readField(gameplay, "tileOwnership"))) return null;
  if (!Array.isArray(readField(gameplay, "placements"))) return null;

  const self = readField(gameplay, "self");
  if (typeof self !== "object" || self === null) return null;
  if (!Array.isArray(readField(self, "ownPlacements"))) return null;

  return bootstrap as GameplayBootstrap;
}

function readField(source: object, key: string): unknown {
  return (source as Record<string, unknown>)[key];
}

/**
 * Claimed tiles, as the board's own view model.
 *
 * Two things this resolves that the projection deliberately leaves open:
 *
 * - `ownerSeat` is `seatSlot(game, ownerId)` — the 1..6 turn-order slot — and NOT
 *   `PublicPlayerProjection.seat`, which is the engine's zero-based `order`. The
 *   token mapper above records what reading `seat` directly cost last time (a
 *   seat-0 player vanishing from the board), and an ownership rule drawn in the
 *   wrong seat colour is the same bug wearing a different hat.
 * - `ownerName` comes from the room's members, because the projection carries ids
 *   and the tile's accessible name has to say "owned by Morgan".
 */
export function createOwnershipViews(
  bootstrap: GameplayBootstrap,
): readonly BoardTileOwnershipView[] {
  const game = bootstrap.publicProjection;

  return bootstrap.gameplay.tileOwnership.flatMap(
    (owned): readonly BoardTileOwnershipView[] => {
      const seat = playerSeat(seatSlot(game, owned.ownerId));
      if (seat === null) return [];

      return [
        {
          tileId: owned.tileId,
          ownerSeat: seat,
          ownerName: memberName(bootstrap, owned.ownerId, seat),
          level: owned.level,
          isSelf: owned.ownerId === bootstrap.self.playerId,
        },
      ];
    },
  );
}

/**
 * Everything on the board that was PUT there: the table's public placements plus
 * the viewer's own, which may be `owner-only`.
 *
 * The two lists are concatenated and nothing is filtered. Another player's
 * `owner-only` placement is absent from this viewer's payload entirely — the
 * server redacted it — so reconstructing the full set here in order to hide part
 * of it again would put the hidden half back into the DOM. The board's own prop
 * documentation says the same thing; this is the call site that has to honour it.
 *
 * A duplicate is possible in principle (a public placement of the viewer's own
 * appearing in both lists), so ids are de-duplicated — two marks for one
 * placement would over-report the board.
 */
export function createPlacementViews(
  bootstrap: GameplayBootstrap,
): readonly BoardPlacementView[] {
  const game = bootstrap.publicProjection;
  const selfPlayerId = bootstrap.self.playerId;
  const seen = new Set<string>();
  const views: BoardPlacementView[] = [];

  for (const placement of [
    ...bootstrap.gameplay.placements,
    ...bootstrap.gameplay.self.ownPlacements,
  ]) {
    if (seen.has(placement.id)) continue;
    const seat = playerSeat(seatSlot(game, placement.ownerId));
    if (seat === null) continue;
    seen.add(placement.id);

    views.push({
      id: placement.id,
      tileId: placement.tileId,
      kind: placement.kind,
      ownerSeat: seat,
      ownerName: memberName(bootstrap, placement.ownerId, seat),
      visibility: placement.visibility,
      charges: placement.charges,
      isSelf: placement.ownerId === selfPlayerId,
    });
  }

  return views;
}

/**
 * Whether this match is a territory match at all.
 *
 * Read from the frozen RULESET rather than from the state of play, because the
 * board reserves its seat gutter for the whole match from this answer: derived
 * from "is anything claimed yet" instead, the first claim of a game would reflow
 * the room name on all 44 tiles.
 */
export function hasTerritory(bootstrap: GameplayBootstrap): boolean {
  const board = bootstrap.gameplay.rules.board;

  return board.ownershipEnabled || board.placementsEnabled;
}

/**
 * What every action control needs beyond its own legal-action summary.
 *
 * Three deliberate restrictions, all of them the same restriction as
 * `ActionContext`'s own: `spendable` is the VIEWER's balances and there is
 * nowhere to put another seat's; `seats` carries public identity only (id, name,
 * slot); and `labels` is display copy, never a rule. A control cannot price an
 * action from anything else because it is handed nothing else.
 */
export function createActionContext(bootstrap: GameBootstrap): ActionContext {
  const game = bootstrap.publicProjection;
  const self = game.players.find((player) => player.id === bootstrap.self.playerId);
  const resources = self?.resources ?? {};

  const seats: readonly ActionSeat[] = game.players.map((player) => ({
    playerId: player.id,
    name: memberName(bootstrap, player.id, seatSlot(game, player.id)),
    seat: seatSlot(game, player.id),
  }));

  return {
    spendable: {
      money: resources["money"] ?? 0,
      energy: resources["energy"] ?? 0,
      /*
       * The engine's own key for the work counter — `resource.work-counter`
       * projected as `work-counter` (see the server's `legalActionContext`). Not
       * `work`: that key does not exist on the projection and every sabotage and
       * contribution ceiling would silently read 0, disabling controls the
       * engine would have accepted.
       */
      work: resources["work-counter"] ?? 0,
    },
    seats,
    labels: { tiles: TILE_LABELS },
    /*
     * `placement.place` prices KINDS, not squares, so the tile has to come from
     * where the actor is standing. Null when they are nowhere yet, which the
     * control states rather than guessing a square.
     */
    tileId: self === undefined ? null : (tileIdAt(self.position) ?? null),
    round: game.round,
  };
}

/** Content tile ids to authored room names, for every control that prints one. */
const TILE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  deadlineDashBoard.spaces.map((tile) => [tile.id, tileName(tile)]),
);

function tileIdAt(position: number): string | undefined {
  return deadlineDashBoard.spaces.find((tile) => tile.index === position)?.id;
}

function toBoardSpace(tile: ContentTile): BoardSpaceView {
  const facility = tileFacilities[tile.kind];
  const label = tileName(tile);
  const base = {
    id: tile.id,
    index: tile.index,
    zone: facility.zone,
    code: facility.code,
    label,
    shortLabel: shortTileNames[label],
    zoneLabel: zoneLabels[facility.zone],
    kindId: tile.kind,
    detail: tile.kind.replaceAll("-", " "),
  };

  return tile.placement === "corner"
    ? { ...base, placement: "corner", coordinate: tile.coordinate }
    : { ...base, placement: "side", side: tile.side, coordinate: tile.coordinate };
}

/**
 * The authored room name, recovered from `deadlineDash.board.tile.<name>.name`.
 * Falls back to the facility code if the key ever stops matching that shape —
 * several spaces share a kind but not a name (Pantry / Smoking area / Lunch
 * break are all `energy-restore`), so the key is the only real name source
 * until the content pack ships authored display strings.
 */
function tileName(tile: ContentTile): string {
  const segment = tile.displayNameKey.split(".").at(-2) ?? "";
  const words = segment
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(" ")
    .filter((word) => word.length > 0)
    .map((word) => (nameInitialisms.has(word) ? word.toUpperCase() : word));
  const first = words[0];
  if (first === undefined) return tileFacilities[tile.kind].code;

  return [
    nameInitialisms.has(first.toLowerCase()) ? first : sentenceCase(first),
    ...words.slice(1),
  ].join(" ");
}

function sentenceCase(word: string): string {
  return `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
}

/**
 * The space the previous mover is standing on. `PlayerMoved` carries no
 * destination, but a player does not move again until their next turn, so their
 * current projected position *is* the space they last landed on.
 */
function resolveLandedTile(
  game: PublicGameProjection,
  activeTile: number | null,
): number | null {
  const lastMove = game.eventSummaries.findLast(
    (event) => event.type === "PlayerMoved",
  );
  const moverId = lastMove?.actorPlayerId ?? null;
  if (moverId === null) return null;

  const mover = game.players.find((player) => player.id === moverId);
  if (!mover || mover.position === activeTile) return null;

  return mover.position;
}

function describeFloor({
  activeName,
  game,
  hasPrompt,
  spaceLabel,
}: {
  readonly activeName: string;
  readonly game: PublicGameProjection;
  readonly hasPrompt: boolean;
  readonly spaceLabel: string | null;
}): string {
  if (game.status === "ended") {
    return "The floor is closed. Reaching Director ended the match.";
  }
  if (game.status === "setup") {
    return "The floor plan is staged. Seats are placed at the reception desk.";
  }
  if (hasPrompt) {
    return `${activeName} has an open decision to resolve before the next roll.`;
  }
  if (spaceLabel === null) {
    return "Movement rolls one six-sided die, clockwise from the reception desk.";
  }

  return `${activeName} is standing on ${spaceLabel}. Movement rolls one six-sided die, clockwise.`;
}

function floorMarker(
  game: PublicGameProjection,
  hasPrompt: boolean,
): BoardPlateMarker {
  if (game.status === "ended") return { tone: "active", label: "Match closed" };
  if (hasPrompt) return { tone: "caution", label: "Decision required" };
  if (game.status === "paused") return { tone: "neutral", label: "Paused" };
  if (game.status === "setup") return { tone: "neutral", label: "Staging" };

  return { tone: "info", label: "Turn in progress" };
}

function floorReadouts(
  game: PublicGameProjection,
  activeTile: number | null,
  activeSpace: BoardSpaceView | null,
): readonly BoardPlateReadout[] {
  return [
    {
      label: "Space",
      value:
        activeTile === null
          ? "—"
          : `${String(activeTile + 1).padStart(2, "0")}/${deadlineDashBoard.spaces.length}`,
    },
    { label: "Facility", value: activeSpace?.code ?? "—" },
    { label: "Zone", value: activeSpace?.zoneLabel ?? "—" },
    { label: "To reception", value: spacesToReception(activeTile) },
    { label: "Phase", value: sentenceCase(game.phase.replaceAll("-", " ")) },
  ];
}

/**
 * Spaces the active player still has to travel to reach the reception desk,
 * which is where a lap pays salary. Derived from the space they are standing on
 * and the ring's own length — no projection field is being invented here.
 */
function spacesToReception(activeTile: number | null): string {
  if (activeTile === null) return "—";

  const total: number = deadlineDashBoard.spaces.length;
  const desk = deadlineDashBoard.spaces.find((tile) => tile.kind === "receptionist");
  if (!desk || total === 0) return "—";

  const gap = (((desk.index - activeTile) % total) + total) % total;
  const remaining = gap === 0 ? total : gap;
  return `${remaining} ${remaining === 1 ? "space" : "spaces"}`;
}

function spaceAt(
  spaces: readonly BoardSpaceView[],
  index: number | null,
): BoardSpaceView | null {
  if (index === null) return null;

  return spaces.find((space) => space.index === index) ?? null;
}

function memberName(
  bootstrap: GameBootstrap,
  playerId: string,
  seat: number,
): string {
  return (
    bootstrap.room.members.find((member) => member.id === playerId)?.displayName ??
    `Seat ${seat}`
  );
}

function playerSeat(seat: number): PlayerSeat | null {
  if (seat === 1 || seat === 2 || seat === 3 || seat === 4 || seat === 5 || seat === 6) {
    return seat;
  }

  return null;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
