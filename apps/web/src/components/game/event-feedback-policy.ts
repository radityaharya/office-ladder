import type {
  LegalActionSummary,
  RoomProjection,
  SafeEventSummary,
} from "@office-ladder/contracts";

export type EventFeedbackState = {
  readonly hydrated: boolean;
  readonly seenEventIds: readonly string[];
};

export type EventNotice = {
  readonly eventId: string;
  readonly eventType: string;
  readonly revision: number;
  readonly actorKind: "local" | "remote" | "system";
  readonly actorName: string;
};

export type CardDrawNotice = {
  readonly eventId: string;
  readonly revision: number;
  readonly actorKind: "local" | "remote" | "system";
  readonly actorName: string;
  readonly card: Extract<SafeEventSummary, { readonly type: "CardDrawn" }>["card"];
};

export type EventFeedbackResult = {
  readonly state: EventFeedbackState;
  readonly notices: readonly EventNotice[];
  readonly cardDraws: readonly CardDrawNotice[];
};

type PromptAction = Extract<
  LegalActionSummary,
  { readonly type: "prompt.respond" }
>;

export function createEventFeedbackState(): EventFeedbackState {
  return { hydrated: false, seenEventIds: [] };
}

export function reduceEventFeedback(
  state: EventFeedbackState,
  events: readonly SafeEventSummary[],
  room: RoomProjection,
  selfPlayerId: string,
): EventFeedbackResult {
  const seenEventIds = new Set(state.seenEventIds);
  const unseenEvents = events.filter((event) => !seenEventIds.has(event.id));
  const nextState = {
    hydrated: true,
    seenEventIds: [...seenEventIds, ...unseenEvents.map((event) => event.id)],
  } satisfies EventFeedbackState;

  if (!state.hydrated) {
    return { state: nextState, notices: [], cardDraws: [] };
  }

  return {
    state: nextState,
    notices: unseenEvents
      .filter((event) => event.type !== "CardDrawn")
      .map((event) => toEventNotice(event, room, selfPlayerId)),
    cardDraws: unseenEvents
      .filter((event) => event.type === "CardDrawn")
      .map((event) => toCardDrawNotice(event, room, selfPlayerId)),
  };
}

export function findLocalPromptAction(
  actions: readonly LegalActionSummary[],
): PromptAction | null {
  return actions.find((action) => action.type === "prompt.respond") ?? null;
}

function toEventNotice(
  event: Exclude<SafeEventSummary, { readonly type: "CardDrawn" }>,
  room: RoomProjection,
  selfPlayerId: string,
): EventNotice {
  const actor = eventActor(event, room, selfPlayerId);
  return {
    eventId: event.id,
    eventType: event.type,
    revision: event.revision,
    actorKind: actor.kind,
    actorName: actor.name,
  };
}

function toCardDrawNotice(
  event: Extract<SafeEventSummary, { readonly type: "CardDrawn" }>,
  room: RoomProjection,
  selfPlayerId: string,
): CardDrawNotice {
  const actor = eventActor(event, room, selfPlayerId);
  return {
    eventId: event.id,
    revision: event.revision,
    actorKind: actor.kind,
    actorName: actor.name,
    card: event.card,
  };
}

function eventActor(
  event: SafeEventSummary,
  room: RoomProjection,
  selfPlayerId: string,
): { readonly kind: CardDrawNotice["actorKind"]; readonly name: string } {
  if (event.actorPlayerId === null) return { kind: "system", name: "System" };
  const member = room.members.find((candidate) => candidate.id === event.actorPlayerId);
  return {
    kind: event.actorPlayerId === selfPlayerId ? "local" : "remote",
    name: member?.displayName ?? `Seat ${member?.seat ?? "?"}`,
  };
}
