import { deadlineDashBoard } from "@office-ladder/content";
import type {
  GameBootstrap,
  LegalActionSummary,
  PublicGameProjection,
} from "@office-ladder/contracts";

import type {
  BoardPlateMarker,
  BoardPlateReadout,
  BoardSpaceView,
  BoardZone,
  PlayerSeat,
  PlayerTokenView,
} from "./board";
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
 * What the shell's attention band should be showing, or `null` for "nothing is
 * on a clock".
 *
 * The band is a fixed row in the shell grid (see `GameLayout`), so this only
 * decides its CONTENT — nothing here can move the board. It is the home for
 * anything time-limited: today the only such thing is an open decision, and v2
 * adds reaction windows, closing ballots and the quarter/event track.
 *
 * Deliberately derived from the CANONICAL bootstrap by the caller, not from the
 * paced one: a countdown that plays back late is a lie about a deadline.
 */
export type AttentionNoticeDescriptor = {
  readonly label: string;
  readonly detail: string;
  readonly tone: "info" | "caution" | "critical";
  /** Pre-formatted clock, or null. The band never runs a clock of its own. */
  readonly deadline: string | null;
};

export function createAttentionNotice(
  bootstrap: GameBootstrap,
): AttentionNoticeDescriptor | null {
  const game = bootstrap.publicProjection;
  const prompt = findPromptAction(bootstrap.legalActions);
  const deadline = readDeadline(game);

  if (prompt !== null) {
    return {
      label: "Decision",
      detail: `${promptKindLabel(prompt)} is waiting on you.`,
      tone: "caution",
      deadline,
    };
  }
  if (game.status === "paused") {
    return { label: "Paused", detail: "The match is paused.", tone: "info", deadline: null };
  }

  return null;
}

/**
 * Read through a shape check rather than the declared type: the turn-timer and
 * prompt fields are being reshaped in packages/contracts, and a band that
 * degrades to "no deadline" is better than one that cannot compile.
 */
function readDeadline(game: PublicGameProjection): string | null {
  const candidate: { readonly deadlineAt?: unknown } = game;
  if (typeof candidate.deadlineAt !== "string") return null;
  return /T(\d{2}:\d{2}:\d{2})/.exec(candidate.deadlineAt)?.[1] ?? null;
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
