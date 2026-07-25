import type { GameBootstrap, LegalActionSummary } from "@office-ladder/contracts";
import { deadlineDashBoard } from "@office-ladder/content";

import type {
  BoardSpaceKind,
  BoardSpaceView,
  PlayerSeat,
  PlayerTokenView,
} from "./board";

const tileLabels = {
  receptionist: "Receptionist",
  finance: "Finance",
  "energy-restore": "Energy restore",
  meeting: "Meeting",
  work: "Work",
  hr: "Human resources",
  networking: "Networking",
  training: "Training",
  "board-meeting": "Board meeting",
  burnout: "Burnout",
  "ceo-office": "CEO office",
  event: "Office event",
  "ceo-favorite": "CEO favorite",
  sales: "Sales",
  "best-employee": "Best employee",
  audit: "Audit",
  operation: "Operations",
  legal: "Legal",
  "annual-event": "Annual event",
  marketing: "Marketing",
  it: "IT",
} as const;

export function createGameView(bootstrap: GameBootstrap) {
  const game = bootstrap.publicProjection;
  const activePlayer = game.players.find((player) => player.id === game.activePlayerId);
  const players = game.players.flatMap((player): readonly PlayerTokenView[] => {
    const seat = playerSeat(player.seat);
    if (seat === null) return [];
    const name = bootstrap.room.members.find((member) => member.id === player.id)?.displayName ?? `Seat ${seat}`;
    return [{ id: player.id, name, seat, position: player.position, initials: initials(name), state: player.id === game.activePlayerId ? "current" : player.connected ? "idle" : "disconnected" }];
  });
  const activeTile = activePlayer?.position ?? null;
  const activeName = activePlayer ? bootstrap.room.members.find((member) => member.id === activePlayer.id)?.displayName ?? `Seat ${activePlayer.seat}` : "Server";
  const latestEvent = game.eventSummaries.at(-1);

  return {
    activeTile,
    canRoll: findRollAction(bootstrap.legalActions) !== null && game.activePlayerId === bootstrap.self.playerId,
    incident: {
      status: `Round ${game.round} · Turn ${game.turnNumber}`,
      title: game.status === "ended" ? "Final review complete" : `${activeName}'s turn`,
      description: `${game.phase.replaceAll("-", " ")} · Position ${activeTile === null ? "pending" : activeTile + 1}`,
      detail: latestEvent ? <p className="font-mono text-xs text-muted-foreground">Latest committed event: {latestEvent.type.replaceAll(".", " ")} · revision {latestEvent.revision}</p> : undefined,
    },
    players,
    spaces: deadlineDashBoard.spaces.map(toBoardSpace),
  };
}

export function findRollAction(actions: readonly LegalActionSummary[]): Extract<LegalActionSummary, { readonly type: "turn.roll" }> | null {
  return actions.find((action) => action.type === "turn.roll") ?? null;
}

export function findPromptAction(actions: readonly LegalActionSummary[]): Extract<LegalActionSummary, { readonly type: "prompt.respond" }> | null {
  return actions.find((action) => action.type === "prompt.respond") ?? null;
}

function toBoardSpace(tile: (typeof deadlineDashBoard.spaces)[number]): BoardSpaceView {
  const base = { id: tile.id, index: tile.index, kind: tileKind(tile.kind), label: tileLabels[tile.kind], categoryLabel: categoryLabel(tile.kind), detail: tile.kind.replaceAll("-", " ") };
  return tile.placement === "corner" ? { ...base, placement: "corner", coordinate: tile.coordinate } : { ...base, placement: "side", side: tile.side, coordinate: tile.coordinate };
}

function tileKind(kind: keyof typeof tileLabels): BoardSpaceKind {
  if (kind === "receptionist") return "start";
  if (kind === "meeting" || kind === "event" || kind === "networking") return "action";
  if (kind === "burnout" || kind === "audit" || kind === "finance" || kind === "hr" || kind === "legal") return "policy";
  if (kind === "operation") return "transit";
  if (kind === "energy-restore") return "safe";
  if (kind === "board-meeting" || kind === "annual-event") return "corner";
  return "department";
}

function categoryLabel(kind: keyof typeof tileLabels): string {
  const category = tileKind(kind);
  return category === "safe" ? "Break / safe" : category[0]?.toUpperCase() + category.slice(1);
}

function playerSeat(seat: number): PlayerSeat | null {
  if (seat === 1 || seat === 2 || seat === 3 || seat === 4 || seat === 5 || seat === 6) return seat;
  return null;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}
