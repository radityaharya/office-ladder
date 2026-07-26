import { RiArrowLeftLine, RiRefreshLine } from "@remixicon/react";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { deadlineDashModes } from "@office-ladder/content";
import type {
  GameBootstrap,
  GameplayBootstrap,
  LegalActionSummary,
  LegalActionSummaryType,
  PublicPlayerProjection,
} from "@office-ladder/contracts";
import { subscribeRoomUpdates } from "@/realtime/room-channel";

import { ActionControls } from "./actions/action-controls";
import type { ActionCommandDraft, ActionContext } from "./actions/action-model";
import { actionPanel, actionSurface } from "./actions/action-registry";
import { GameBoard } from "./board";
import { ActionTray } from "./action-tray";
import { useDiceFeed } from "./dice";
import { useEventPacing } from "./event-feedback-policy";
import { DeadlineMeter, GameHud } from "./game-hud";
import { CardDrawFeed, GameFeedback } from "./game-feedback";
import { shouldShowGameWinner } from "./game-completion-policy";
import { AttentionNotice, GameLayout } from "./game-layout";
import {
  asGameplayBootstrap,
  createActionContext,
  createAttentionNotice,
  createGameView,
  createOwnershipViews,
  createPlacementViews,
  findPromptAction,
  hasTerritory,
} from "./game-view";
import {
  ActivityPanel,
  AgreementsPanel,
  BallotsPanel,
  derivePanelData,
  EventsPanel,
  HandPanel,
  HeatPanel,
  MarketPanel,
  ObjectivesPanel,
  ProjectsPanel,
  QuarterPanel,
  SeatsPanel,
  type PanelData,
  type PanelId,
} from "./panels";
/* Not re-exported from the panel barrel yet — the chat owner and the panel-kit
   owner both said so. Importing the module directly is the documented interim. */
import { RoomChatPanel, type ChatSeat } from "./panels/chat-panel";
import {
  ActivityLog,
  buildActivityLog,
  formatNumber,
  playerName,
  rankLabel,
  seatSlot,
  tileLabel,
  TurnRail,
  type RailAttention,
  type RailDestinationId,
  type RailPanelContent,
} from "./turn-rail";

type GameClientProps = {
  readonly roomId: string;
};

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "absent" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly bootstrap: GameBootstrap };

class GameRequestError extends Error {
  readonly name = "GameRequestError";

  constructor(readonly status: number) {
    super(`Game request failed with status ${status}`);
  }
}

/**
 * A refusal, attributed to the command it refused.
 *
 * Attribution is what lets one message appear where the player was looking: a
 * rejected `ballot.cast` belongs beside the ballot, not in the bar under the
 * board. `actionSurface`/`actionPanel` resolve the destination from the same
 * registry that decided where the control lives, so the two can never disagree.
 */
export type CommandFailure = {
  readonly type: LegalActionSummaryType;
  readonly message: string;
};

export function GameClient({ roomId }: GameClientProps) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [pendingCommand, setPendingCommand] = useState<LegalActionSummaryType | null>(null);
  const [failure, setFailure] = useState<CommandFailure | null>(null);
  const [feedbackCompleteRevision, setFeedbackCompleteRevision] = useState<number | null>(null);

  /*
   * The intent ledger: one command id per distinct intent, held across retries.
   *
   * §11.1 keys idempotency on `commandId`, and the point of that is only reached
   * if a RETRY re-sends the same id — otherwise a retried submit is a second
   * apply, which with reaction windows and auto-retrying clients stops being
   * theoretical. So the id is derived from the intent (see `commandIntentKey`)
   * rather than minted per click: pressing "Cast" twice on the same ballot at the
   * same revision sends one id twice and the server answers the original outcome;
   * casting a *different* amount is a different intent and gets a new id.
   *
   * `expectedRevision` is part of the key, so the ledger self-expires — every
   * commit moves the revision and every intent at the old one becomes
   * unreachable. The cap only bounds memory across a long match.
   */
  const intents = useRef<Map<string, string>>(new Map());

  const refresh = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal,
      });
      if (response.status === 404) {
        setState({ kind: "absent" });
        return;
      }
      if (!response.ok) throw new GameRequestError(response.status);

      const payload: unknown = await response.json();
      const shape = classifyBootstrap(payload);
      if (shape.kind === "lobby") {
        setState({ kind: "absent" });
        return;
      }
      if (shape.kind === "unknown") {
        setState({
          kind: "error",
          message: "The room answered with a projection this board cannot read.",
        });
        return;
      }
      setState({ kind: "ready", bootstrap: shape.bootstrap });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (error instanceof GameRequestError) {
        setState({ kind: "error", message: "The current game projection could not be loaded." });
        return;
      }
      if (error instanceof TypeError) {
        setState({ kind: "error", message: "The game server could not be reached." });
        return;
      }
      throw error;
    }
  }, [roomId]);

  useEffect(() => {
    const controller = new AbortController();
    const initialRefresh = window.setTimeout(() => void refresh(controller.signal), 0);
    const interval = window.setInterval(() => void refresh(), 5_000);
    const cleanup = subscribeRoomUpdates(roomId, (update) => {
      if (update.changed.some((area) => area !== "room")) void refresh();
    });

    return () => {
      controller.abort();
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
      void cleanup();
    };
  }, [refresh, roomId]);

  /*
   * ------------------------------------------------------------------------
   * Canonical vs. shown. This is the one distinction the whole view rests on.
   * ------------------------------------------------------------------------
   *
   * `canonical` is what the server committed. The server commits a bot's ENTIRE
   * turn as one engine command and publishes it once, so five to ten events land
   * at the same instant with identical `occurredAt` — measured in the live app,
   * one ROLL DIE click drove the activity list 37 -> 42 -> 44 in three bursts
   * inside 2.74s and the turn was back before any of it could be read. Raising
   * the server's bot delay alone only produces burst, pause, burst; the events of
   * one committed turn have to *play out* here.
   *
   * `shown` is the same bootstrap with `eventSummaries` truncated to a
   * presentation cursor that advances one event at a time. Nothing else is
   * touched: `legalActions`, `activePlayerId`, `players`, `resources`, `status`
   * and `revision` are canonical in both, so the paced object can never decide
   * what the player is allowed to do, and it becomes object-identical to
   * `canonical` the moment the queue drains (DESIGN.md §7.2 — motion never
   * becomes the source of truth).
   *
   * `useEventPacing` is called exactly ONCE. Two call sites would be two cursors
   * drifting apart.
   */
  const canonical = state.kind === "ready" ? state.bootstrap : null;
  const paced = useEventPacing(canonical);
  const shown = paced.bootstrap ?? canonical;

  /*
   * Everything derived from the event stream reads `shown`, so the board's floor
   * plate, its `Last` landing mark and the incident line move on the same beat as
   * the log. `canRoll` inside this view model comes from `legalActions`, which is
   * canonical either way — the roll control is never gated on playback.
   */
  const view = useMemo(() => (shown ? createGameView(shown) : null), [shown]);

  /*
   * Canonical, NOT paced — deliberately the opposite choice to `view` above.
   * Everything in the attention band is on a real clock, and a deadline derived
   * from played-back state would understate how long the player actually has.
   */
  const attentionNotice = useMemo(
    () => (canonical ? createAttentionNotice(canonical) : null),
    [canonical],
  );

  /*
   * The dice instrument is a pure derivation of whatever projection it is handed:
   * the newest committed `DiceRolled` in it *is* the roll to report. Handing it
   * the paced projection is what makes a bot's roll surface on its own beat
   * instead of arriving with four other events — and because it is a derivation
   * rather than a ledger, the first synchronous render already shows real faces.
   */
  const diceRoll = useDiceFeed(shown);

  /*
   * ------------------------------------------------------------------------
   * ONE submit, for all twenty-seven commands.
   * ------------------------------------------------------------------------
   *
   * This replaces the two hand-written fetchers that posted to `/roll` and
   * `/respond`. Those aliases still work (wave 5 deletes them), but they are the
   * shape §11.1 rejected: per-command routes, and — because each minted
   * `crypto.randomUUID()` at the call site — an idempotency key that was fresh on
   * every attempt, which is the same as having none.
   *
   * Four properties this function owns, and nothing else does:
   *
   * 1. **The endpoint.** `POST /api/rooms/:roomId/commands`. The command's *type*
   *    selects the payload; the route does auth, entitlement, revision predicate,
   *    submit, rejection mapping and publish exactly once.
   * 2. **The command id.** Stable per intent (see `intents` above), so a retry is
   *    deduplicated by the server's `command_receipts` rather than applied twice.
   *    Controls deliberately cannot mint one — `ActionCommandDraft` omits the
   *    field — because only the layer that owns the retry can know what "the same
   *    intent" means.
   * 3. **`expectedRevision` on every command, not just rolls.** It arrives inside
   *    the draft, taken from the summary the server ADVERTISED the action at, so a
   *    lost race against any of the twenty-seven is a clean 409 instead of a
   *    command applied to a board that has already moved on. With reaction windows
   *    and N-seat ballots that race is the normal case, not the exception.
   * 4. **Attribution of the refusal** to the surface the command came from, so the
   *    message appears where the player was looking.
   *
   * `pendingCommand` is a type, not a boolean: one control reads busy and the
   * other twenty-six stay live. It never gates legality (§7.2) — only the control
   * whose command is in flight.
   */
  const submitCommand = useCallback(
    async (draft: ActionCommandDraft): Promise<void> => {
      const commandId = reserveCommandId(intents.current, draft);

      setPendingCommand(draft.type);
      setFailure(null);
      try {
        const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/commands`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...draft, commandId }),
        });
        if (!response.ok) throw new GameRequestError(response.status);
        await refresh();
      } catch (error) {
        if (error instanceof GameRequestError) {
          setFailure({ type: draft.type, message: refusalMessage(error.status) });
          // A 409 means somebody committed first; re-reading is what makes the
          // next attempt (a NEW intent, at the new revision) able to succeed.
          await refresh();
          return;
        }
        if (error instanceof TypeError) {
          setFailure({
            type: draft.type,
            message:
              "The game server could not be reached. The board will keep polling for the latest projection.",
          });
          return;
        }
        throw error;
      } finally {
        /*
         * The single termination guarantee: the pending type clears on success, on
         * a 409, on any other rejected status, on a network `TypeError` and on a
         * rethrown unexpected error. Every control's busy state is a pure function
         * of this value, so none of them can stick.
         */
        setPendingCommand(null);
      }
    },
    [refresh, roomId],
  );

  /**
   * The prompt dialog's answer, expressed as the same command as everything else.
   *
   * `game-feedback.tsx` owns that dialog and hands back an option id, so this
   * adapts it onto the one submit rather than keeping the `/respond` alias alive
   * for one caller.
   */
  const respondToPrompt = useCallback(
    async (optionId: string): Promise<void> => {
      if (state.kind !== "ready") return;
      const action = findPromptAction(state.bootstrap.legalActions);
      if (action === null) return;

      await submitCommand({
        type: "prompt.respond",
        expectedRevision: action.expectedRevision,
        decisionPointId: action.decisionPointId,
        optionId,
      });
    },
    [state, submitCommand],
  );

  /*
   * ------------------------------------------------------------------------
   * The v2 derivations.
   * ------------------------------------------------------------------------
   *
   * `gameplayCanonical` is the v2 block, narrowed by shape rather than cast: the
   * payload is declared as an intersection, so nothing in the type of what this
   * client holds says whether the server sent it. `null` means a server that has
   * not shipped it yet, and every destination below degrades to its teaching empty
   * state instead of dereferencing `undefined.rules` during render.
   *
   * `gameplayShown` re-attaches that block to the PACED projection. Deliberate
   * split: the panels' event feed follows the presentation cursor (so a bot's turn
   * plays out rather than landing as one burst), while the gameplay collections are
   * canonical — they carry no per-event cursor to pace against, and a stale ballot
   * list would be a lie about what is open right now.
   */
  const gameplayCanonical = useMemo(() => asGameplayBootstrap(canonical), [canonical]);
  const gameplayShown = useMemo((): GameplayBootstrap | null => {
    if (gameplayCanonical === null || shown === null) return null;
    if (shown === canonical) return gameplayCanonical;

    return { ...shown, gameplay: gameplayCanonical.gameplay };
  }, [canonical, gameplayCanonical, shown]);

  /*
   * The activity log is an INPUT to the derivation, not something it computes:
   * `buildActivityLog` already turns the committed event stream into sentences,
   * and a second sentence table inside the panel kit would drift from this one
   * within a wave. Paced, for the same reason the log has always been paced — it
   * is what a player reads to follow the match.
   */
  const activity = useMemo(
    () =>
      shown === null
        ? []
        : buildActivityLog(
            shown.publicProjection,
            shown.room,
            [],
            shown.self.playerId,
          )
            .slice(-RAIL_LOG_ENTRIES)
            .reverse(),
    [shown],
  );

  /*
   * ONE call, eleven panels. A host that reached into `bootstrap.gameplay` itself
   * would be a host that eventually renders `castBy`; every redaction guarantee in
   * the kit lands in the TYPE of what leaves `derivePanelData`, and that only
   * holds if this is the single place it is called.
   */
  const panelData = useMemo(
    () => (gameplayShown === null ? null : derivePanelData({ bootstrap: gameplayShown, activity })),
    [activity, gameplayShown],
  );

  /*
   * Canonical. What a control may spend, and what it is allowed to know about the
   * other seats (a name and a slot). Paced balances would price a control against
   * a projection the server has already moved past, and the player would be shown
   * a refusal for a number the UI told them was legal.
   */
  const actionContext = useMemo(
    () => (canonical === null ? null : createActionContext(canonical)),
    [canonical],
  );

  /* Memoised because the chat hook lists it as a `useMemo` dependency. */
  const chatSeats = useMemo(
    (): readonly ChatSeat[] =>
      (canonical?.room.members ?? []).map((member) => ({
        playerId: member.id,
        seat: member.seat,
        name: member.displayName,
        isBot: member.isBot,
      })),
    [canonical],
  );

  /*
   * Stable identity so `GameFeedback`'s idle effect does not re-run on every
   * pacing beat. `canonical?.publicProjection.revision` is the only thing this
   * closes over that can change.
   */
  const projectionRevision = canonical?.publicProjection.revision ?? null;
  const handleIdleChange = useCallback(
    (idle: boolean) => {
      setFeedbackCompleteRevision(idle ? projectionRevision : null);
    },
    [projectionRevision],
  );

  if (state.kind === "loading") return <GameLoading />;
  if (state.kind === "absent") return <GameAbsent roomId={roomId} />;
  if (state.kind === "error") return <GameError message={state.message} onRetry={() => void refresh()} roomId={roomId} />;
  // `shown` is non-null whenever `view` is, but TypeScript cannot see that
  // through the memo, and the slots below need the narrowing.
  if (!view || !shown) return null;

  /*
   * The winner screen is gated on TWO independent signals, and they answer
   * different questions on purpose:
   *
   * 1. `shouldShowGameWinner` — has the feedback layer gone idle at the *same*
   *    revision the projection is at? "Idle" means the local player owes the
   *    server no decision (see GameFeedback). Card draws deliberately do NOT hold
   *    this back: they self-dismiss, so waiting on them would delay the match
   *    report for a notice nobody had to clear, and the report already prints the
   *    closing log entries that carry the same card. Loosening this to
   *    `status === "ended"` alone would swallow a still-open prompt; dropping the
   *    revision comparison would leave the report unreachable.
   * 2. `!paced.isPlayingBack` — has the view caught up? Without this the report
   *    replaces the board mid-playback and the last turn of the match — the one
   *    that ended it — is never seen. The queue always drains (its plan makes
   *    progress on every tick and collapses a large backlog), and reduced motion
   *    reveals everything instantly, so this can delay the report but never
   *    withhold it.
   *
   * `GameWinner` still receives the CANONICAL bootstrap: the report is a record
   * of the closed match and must be true, not paced.
   */
  if (
    !paced.isPlayingBack &&
    shouldShowGameWinner({
      status: state.bootstrap.publicProjection.status,
      projectionRevision: state.bootstrap.publicProjection.revision,
      feedbackCompleteRevision,
    })
  ) {
    return <GameWinner bootstrap={state.bootstrap} roomId={roomId} />;
  }

  const canonicalBootstrap = state.bootstrap;
  const actions = canonicalBootstrap.legalActions;
  /*
   * Canonical, never paced — this is the same rule the attention band follows and
   * for the same reason. A control's legality and its price come from what the
   * server advertised at the revision it advertised it, so playback can delay what
   * a player READS but never what they may DO (DESIGN.md §7.2).
   */
  const context = actionContext ?? EMPTY_ACTION_CONTEXT;
  const submit = (draft: ActionCommandDraft) => void submitCommand(draft);
  const surfaceFailure = (surface: "turn" | "decision") =>
    failure !== null && actionSurface(failure.type) === surface ? failure.message : null;

  return (
    <main className="game-viewport">
      {/*
        Paced: this owns the prompt dialog (the ONE overlay left, and only when
        the game genuinely cannot proceed without this player) plus the toast
        allowlist and the screen-reader batch summary. Feeding it `shown` is what
        turns five simultaneous toasts into one per beat.
      */}
      <GameFeedback
        bootstrap={shown}
        error={surfaceFailure("decision")}
        isResponding={pendingCommand === "prompt.respond"}
        onIdleChange={handleIdleChange}
        onRespond={(optionId) => void respondToPrompt(optionId)}
      />
      <GameLayout
        hud={
          /*
           * Canonical. The HUD reads no events — it reports the local seat's
           * resources, rank and whose turn it is, and every one of those must
           * agree with the roll control beside it rather than with playback.
           *
           * `serverTime` is what turns the header's clock from a bar that starts
           * full into a real proportion: the geometry is `deadlineAt - serverTime`,
           * two of the server's own instants, so it never consults the browser's
           * clock (which the contract warns may be minutes wrong). It must come
           * from the CANONICAL bootstrap — a countdown played back late is a lie
           * about a deadline.
           */
          <GameHud
            game={canonicalBootstrap.publicProjection}
            room={canonicalBootstrap.room}
            selfCharacterId={canonicalBootstrap.self.characterId}
            selfPlayerId={canonicalBootstrap.self.playerId}
            serverTime={canonicalBootstrap.serverTime}
          />
        }
        board={
          /*
           * Territory comes from the CANONICAL gameplay block, and `territory`
           * from the frozen RULESET rather than from whether anything is claimed
           * yet: the board reserves its per-tile seat gutter for the whole match
           * from that answer, so the first claim of a game cannot reflow the room
           * name on all 44 tiles.
           */
          <GameBoard
            activeTile={view.activeTile}
            incident={view.incident}
            label="Deadline Dash office board"
            landedTile={view.landedTile}
            ownership={
              gameplayCanonical === null ? undefined : createOwnershipViews(gameplayCanonical)
            }
            placements={
              gameplayCanonical === null ? undefined : createPlacementViews(gameplayCanonical)
            }
            players={view.players}
            spaces={view.spaces}
            territory={gameplayCanonical === null ? undefined : hasTerritory(gameplayCanonical)}
          />
        }
        actionTray={
          /*
            Canonical `canRoll` and canonical active-player name. DESIGN.md
            §7.2: the roll control is live the instant the server says the
            action is legal, whatever is still animating or playing back.

            The catch-up control used to sit above this as a second stacked row.
            It now lives in the rail head — see `catchUp` below.

            The `commands` lane is the registry's TURN surface: the roll plus
            everything else whose object is your own position and your own turn
            (pips, the free action, the desk you are standing on, the promotion you
            can afford, the fine you owe). It is `ActionControls`' fixed-height
            `bar`, which renders a resting readout rather than collapsing, so the
            region still hosts nothing that comes and goes.
          */
          <ActionTray
            activePlayerName={activePlayerName(canonicalBootstrap)}
            canRoll={view.canRoll}
            commands={
              <ActionControls
                actions={actions}
                context={context}
                label="Your commands"
                onSubmit={submit}
                pending={pendingCommand}
                resting={restingTurnCopy(view.canRoll)}
                surface="turn"
              />
            }
            dice={diceRoll}
            isRolling={pendingCommand === "turn.roll"}
            onRoll={() => void submitRoll(actions, submit)}
            rollError={surfaceFailure("turn")}
          />
        }
        turnRail={
          /* Paced: the activity log is the thing the player reads to follow
             the match, so it is the primary consumer of the presentation
             cursor. The seat dossiers in the same rail read canonical
             `game.players`. */
          <TurnRail
            catchUp={
              /*
                Gated on `isBehind` rather than `isPlayingBack` deliberately:
                playback is true for a second or two of EVERY turn, so gating on
                it would make this appear and vanish constantly — worse chrome
                than none. Pressing it reveals everything committed at the
                current revision; it does not change the game.

                Hosted in the rail head rather than the action region because
                there it moved the board 32px (631px -> 599px) every time it
                appeared. The rail is a definite grid track, so a control
                arriving here redistributes rail height and costs the board
                nothing.
              */
              paced.isBehind ? (
                <button
                  className="dice-catchup"
                  data-slot="dice-catchup"
                  onClick={paced.skip}
                  type="button"
                >
                  <span className="dice-catchup-label">Playing back</span>
                  <span className="dice-catchup-count">{paced.pendingCount}</span>
                  <span className="dice-catchup-action">Catch up</span>
                </button>
              ) : null
            }
            game={shown.publicProjection}
            panels={buildRailPanels({
              actions,
              cardFeed: <CardDrawFeed bootstrap={shown} />,
              chat: (
                <RoomChatPanel
                  chatMode={chatRules(canonicalBootstrap).chat}
                  chrome="none"
                  emoteReactionsEnabled={chatRules(canonicalBootstrap).emoteReactions}
                  roomId={roomId}
                  seats={chatSeats}
                  selfPlayerId={canonicalBootstrap.self.playerId}
                />
              ),
              context,
              data: panelData,
              failure,
              onSubmit: submit,
              pending: pendingCommand,
            })}
            room={canonicalBootstrap.room}
            selfPlayerId={canonicalBootstrap.self.playerId}
          />
        }
        attention={
          /*
            Canonical, never paced: a countdown derived from played-back state
            would be a lie about a real deadline. The band is a permanently
            reserved row, so what changes here is only the text inside it —
            nothing in this prop can move the board.

            The deadline is now an INSTRUMENT rather than a wall-clock string:
            `DeadlineMeter` renders §12.3's depleting bar, degrades to discrete
            steps under `prefers-reduced-motion`, and runs no clock of its own —
            its resting geometry is two server instants and its motion is one CSS
            animation, re-stated on every projection update so it re-syncs instead
            of drifting.

            The decision controls sit in the same row. `inline` layout renders
            nothing when nothing is legal, so an arriving control cannot change the
            band's height — the band's row is a fixed 40px either way.
          */
          attentionNotice === null ? null : (
            <AttentionNotice
              actions={
                <ActionControls
                  actions={actions}
                  context={context}
                  error={surfaceFailure("decision")}
                  label="Open decision"
                  layout="inline"
                  onSubmit={submit}
                  pending={pendingCommand}
                  surface="decision"
                />
              }
              deadline={
                attentionNotice.deadline === null ? null : (
                  <DeadlineMeter
                    deadlineAt={attentionNotice.deadline.deadlineAt}
                    durationMs={attentionNotice.deadline.durationMs}
                    expiryNote={ATTENTION_EXPIRY_NOTE}
                    label={attentionNotice.label}
                    owner="self"
                    serverTime={canonicalBootstrap.serverTime}
                    subject="you"
                  />
                )
              }
              detail={attentionNotice.detail}
              label={attentionNotice.label}
              tone={attentionNotice.tone}
            />
          )
        }
      />
    </main>
  );
}

/**
 * What the server does when the band's clock reaches zero.
 *
 * Stated in words because the bar is deliberately not a number (§12.3) and a
 * player still has to know the consequence. The bar itself decides nothing: the
 * server commits on the player's behalf whether or not any client noticed, so a
 * client acting on its own idea of "now" could only race a decision already made.
 */
const ATTENTION_EXPIRY_NOTE =
  "At zero the server answers for you and the match continues.";

/** How many of the newest log entries the rail's Activity panel keeps rendered. */
const RAIL_LOG_ENTRIES = 40;

/**
 * A context with nothing spendable and nobody to target.
 *
 * Only reachable in the one frame before the first projection lands, and it is
 * inert rather than absent on purpose: `ActionControls` renders only what the
 * server enumerated, and with no bootstrap there is nothing enumerated, so this
 * can never price a control.
 */
const EMPTY_ACTION_CONTEXT: ActionContext = {
  spendable: { money: 0, energy: 0, work: 0 },
  seats: [],
};

function restingTurnCopy(canRoll: boolean): string {
  return canRoll
    ? "Roll to continue. Anything else you may do this turn appears here."
    : "Nothing is yours to do yet. The lane fills when it is your move.";
}

/**
 * The tray's legacy `onRoll` path, expressed as the one command.
 *
 * `ActionTray` keeps the prop for callers that pass no lane; when a lane is
 * supplied the lane owns the roll, so this only fires from that legacy path — and
 * it still goes through the same submit, so there is no second transport.
 */
function submitRoll(
  actions: readonly LegalActionSummary[],
  submit: (draft: ActionCommandDraft) => void,
): void {
  const action = actions.find((candidate) => candidate.type === "turn.roll");
  if (action === undefined) return;

  submit({ type: "turn.roll", expectedRevision: action.expectedRevision });
}

/**
 * The room's social ruleset.
 *
 * Read from the mode PRESET because `RoomProjection` does not carry the resolved
 * `ModeRules` yet — the server resolves it (`chat/room-access.ts`) and now
 * publishes it on the lobby payload, but contracts has not widened the DTO, so it
 * is invisible to this app's types. Correct for a shipped preset and wrong for a
 * lobby-authored custom ruleset, which `RoomChatPanel` then self-corrects from the
 * server's own refusal (`CHAT_DISABLED` proves `off`, `CHAT_TEXT_NOT_ALLOWED`
 * proves `quick`). Reported to the contracts owner.
 */
function chatRules(bootstrap: GameBootstrap) {
  return deadlineDashModes[bootstrap.room.mode].rules.social;
}

function activePlayerName(bootstrap: GameBootstrap): string {
  const activePlayerId = bootstrap.publicProjection.activePlayerId;
  return activePlayerId ? playerName(bootstrap.room, activePlayerId) : "The server";
}

/* ------------------------------------------------------------------------- */
/* Idempotency: one command id per intent.                                   */
/* ------------------------------------------------------------------------- */

/** Ledger cap. Bounds memory across a long match; see `reserveCommandId`. */
const MAX_TRACKED_INTENTS = 96;

/**
 * A stable key for "the same intent".
 *
 * The whole draft, stably stringified: type, `expectedRevision` and every payload
 * field. Two identical drafts are one intent and share one command id; a draft
 * differing in *any* field — a different ballot, a different amount, a different
 * revision — is a different intent and gets its own.
 *
 * Keys are sorted, because `JSON.stringify` preserves insertion order and two
 * controls building the same payload in a different field order would otherwise
 * look like two intents. Nested objects are handled the same way; every payload
 * contracts accepts is plain JSON.
 *
 * Exported for tests: this is the function the deduplication rests on, and it is
 * pure.
 */
export function commandIntentKey(draft: ActionCommandDraft): string {
  return stableStringify(draft);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);

  return `{${entries.join(",")}}`;
}

/**
 * The command id for a draft: the one already minted for this intent, or a new
 * one.
 *
 * This is what makes §11.1's idempotency reachable from the client. Pressing a
 * control twice, or a retry after a dropped response, re-sends the SAME id, and
 * the server answers with the original outcome instead of applying twice — which
 * with reaction windows and N-seat ballots is a live concern rather than a
 * hypothetical.
 *
 * A refused command deliberately keeps its id: the server records receipts only
 * for commands that APPLIED, so re-sending after a rejection is a fresh attempt
 * rather than a replay of a refusal.
 *
 * Eviction is oldest-first (`Map` preserves insertion order). Safe because
 * `expectedRevision` is part of the key: every commit moves the revision, so an
 * evicted entry is one whose intent can no longer be submitted anyway.
 *
 * Exported for tests.
 */
export function reserveCommandId(
  ledger: Map<string, string>,
  draft: ActionCommandDraft,
): string {
  const key = commandIntentKey(draft);
  const existing = ledger.get(key);
  if (existing !== undefined) return existing;

  const commandId = crypto.randomUUID();
  ledger.set(key, commandId);
  while (ledger.size > MAX_TRACKED_INTENTS) {
    const oldest = ledger.keys().next();
    if (oldest.done === true) break;
    ledger.delete(oldest.value);
  }

  return commandId;
}

/**
 * One refusal sentence per status, for any of the twenty-seven commands.
 *
 * §11.1 requires that "the client must be able to render a refusal without
 * knowing which command it was", and this is that: the status carries the
 * meaning, and the surface the message lands on carries the context. Which
 * command failed is stated by WHERE the message appears, not by naming it twice.
 *
 * Exported for tests.
 */
export function refusalMessage(status: number): string {
  if (status === 409) {
    return "Somebody committed first, so that was refused. The board is re-reading; try again.";
  }
  if (status === 403) {
    return "That is not yours to do. The board is re-reading the projection.";
  }
  if (status === 404) return "That is no longer on the board.";
  if (status === 401) return "Your session expired. Sign in again to keep playing.";
  if (status === 429) return "Too many commands too quickly. Wait a moment and try again.";
  if (status >= 500) return "The server could not commit that. It will accept a retry.";

  return "That command was not accepted. Try again after the projection refreshes.";
}

/* ------------------------------------------------------------------------- */
/* The rail: twelve destinations.                                            */
/* ------------------------------------------------------------------------- */

/**
 * Rail destination id -> panel-kit id.
 *
 * The two vocabularies name the same twelve surfaces and differ in exactly one
 * place: the rail calls the card/event destination `feed`, the kit calls it
 * `events`. Mapped rather than renamed because both ids are load-bearing in their
 * own module's tests and its stylesheet.
 */
const RAIL_TO_PANEL: Readonly<Record<RailDestinationId, PanelId>> = {
  seats: "seats",
  activity: "activity",
  hand: "hand",
  projects: "projects",
  objectives: "objectives",
  market: "market",
  agreements: "agreements",
  heat: "heat",
  ballots: "ballots",
  chat: "chat",
  quarter: "quarter",
  feed: "events",
};

type RailPanelInput = {
  /** Null until the server ships the v2 block; every panel then rests. */
  readonly data: PanelData | null;
  readonly actions: readonly LegalActionSummary[];
  readonly context: ActionContext;
  readonly onSubmit: (draft: ActionCommandDraft) => void;
  readonly pending: LegalActionSummaryType | null;
  readonly failure: CommandFailure | null;
  readonly chat: ReactNode;
  readonly cardFeed: ReactNode;
};

/**
 * Every rail destination's content, badge and summary — twelve entries.
 *
 * The rail used to receive exactly ONE (`feed`), which is why eleven surfaces the
 * panel kit had already built rendered their empty state forever while a fully
 * populated `gameplay` block sat unread on the bootstrap. This function is the
 * seam that closes that gap, and it is the only place the two halves meet.
 *
 * Three things it is careful about:
 *
 * - **Every panel is mounted `chrome="none"`.** `RailPanel` already draws a 28px
 *   header, and nesting the kit's own header inside it would put two headings in
 *   one region.
 * - **Controls come from the REGISTRY, not from each panel's handler props.** The
 *   panels expose `onContribute`/`onBid`/`onCast`/... , but `ActionControls
 *   surface="rail"` is typed against the contracts payload, renders the real
 *   pickers with the server's own ceilings, and — decisively — renders only what
 *   the server enumerated. Wiring the bare callbacks as well would give each
 *   command two paths to two different command ids for one intent.
 * - **The refusal lands on the panel that owns the command**, resolved through the
 *   same registry that decided where the control lives, so a rejected `ballot.cast`
 *   reports itself beside the ballot rather than in the bar under the board.
 *
 * Exported so the composition is assertable without mounting the whole client.
 */
export function buildRailPanels({
  data,
  actions,
  context,
  onSubmit,
  pending,
  failure,
  chat,
  cardFeed,
}: RailPanelInput): readonly RailPanelContent[] {
  const failedPanel =
    failure !== null && actionSurface(failure.type) === "rail"
      ? actionPanel(failure.type)
      : null;

  function controls(panelId: PanelId): ReactNode {
    return (
      <ActionControls
        actions={actions}
        context={context}
        error={failedPanel === panelId ? failure?.message ?? null : null}
        onSubmit={onSubmit}
        panelId={panelId}
        pending={pending}
        surface="rail"
      />
    );
  }

  function entry(
    id: RailDestinationId,
    body: ReactNode,
    summary?: string,
  ): RailPanelContent {
    const panelId = RAIL_TO_PANEL[id];
    const attention = railAttention(data, actions, panelId);

    return {
      id,
      content: (
        <>
          {body}
          {controls(panelId)}
        </>
      ),
      ...(attention === null ? {} : { attention }),
      ...(summary === undefined ? {} : { summary }),
    };
  }

  /*
   * With no gameplay block there is nothing to derive, so every destination keeps
   * its own resting copy — except `feed`, which carries the card notice the v1
   * projection already supports, and `chat`, which is not game state at all and is
   * self-sufficient (§8.1). That is the honest degradation: a server that has not
   * shipped §5 yet shows a rail that teaches instead of a rail that lies.
   */
  if (data === null) {
    return [
      { id: "feed", content: cardFeed },
      { id: "chat", content: chat },
    ];
  }

  return [
    entry("seats", <SeatsPanel {...data.seats} chrome="none" />, `${formatNumber(data.seats.seats.length)}/${formatNumber(data.seats.capacity)}`),
    entry("activity", <ActivityPanel {...data.activity} chrome="none" />, `R${formatNumber(data.activity.revision)}`),
    entry("hand", <HandPanel {...data.hand} chrome="none" />, handSummary(data)),
    entry("projects", <ProjectsPanel {...data.projects} chrome="none" />, countSummary(data.projects.projects.length)),
    entry("objectives", <ObjectivesPanel {...data.objectives} chrome="none" />, countSummary(data.objectives.objectives.length)),
    entry("market", <MarketPanel {...data.market} chrome="none" />, countSummary(data.market.lots.length)),
    entry("agreements", <AgreementsPanel {...data.agreements} chrome="none" />, countSummary(data.agreements.agreements.length)),
    entry("heat", <HeatPanel {...data.heat} chrome="none" />),
    entry("ballots", <BallotsPanel {...data.ballots} chrome="none" />, countSummary(data.ballots.ballots.length)),
    /* Chat is not derived and must not be: it is not game state, and it owns its
       own transport, history pagination and mode narrowing. Self-sufficient — no
       chat state belongs in this hub. */
    { id: "chat", content: chat },
    /* No summary on `quarter` or `heat`: both are single readouts whose own body
       already states the number, and `quarterSummary` is a SENTENCE — the rail's
       summary lane is a short mono readout beside a 28px heading, not prose. */
    entry("quarter", <QuarterPanel {...data.quarter} chrome="none" />),
    entry(
      "feed",
      <>
        {cardFeed}
        <EventsPanel {...data.events} chrome="none" />
      </>,
      countSummary(data.events.items.length),
    ),
  ];
}

/**
 * A destination's badge: "something in here needs you", as a number.
 *
 * Two independent sources, and the derived one wins where it exists:
 *
 * - `data.attention` is populated only for the destinations that can genuinely be
 *   *waiting on the viewer* (an uncast ballot, an unanswered offer, a hand over its
 *   limit, heat at the threshold, an announced quarter event). It carries a
 *   sentence for assistive tech, which a bare count cannot.
 * - The registry's legal-action count is the fallback: a panel holding a command
 *   the server says is legal is a panel worth opening.
 *
 * A zero is never synthesised — an attention affordance that is always present
 * stops meaning anything.
 */
function railAttention(
  data: PanelData | null,
  actions: readonly LegalActionSummary[],
  panelId: PanelId,
): RailAttention | null {
  const derived = data?.attention[panelId] ?? null;
  if (derived !== null && derived.count > 0) {
    return { count: derived.count, tone: "caution" };
  }

  const legal = actions.filter(
    (action) => actionSurface(action.type) === "rail" && actionPanel(action.type) === panelId,
  ).length;

  return legal > 0 ? { count: legal, tone: "info" } : null;
}

function countSummary(count: number): string {
  return formatNumber(count);
}

function handSummary(data: PanelData): string {
  const limit = data.hand.handLimit;

  return limit === null
    ? formatNumber(data.hand.cards.length)
    : `${formatNumber(data.hand.cards.length)}/${formatNumber(limit)}`;
}

export type BootstrapShape =
  | { readonly kind: "game"; readonly bootstrap: GameBootstrap }
  | { readonly kind: "lobby" }
  | { readonly kind: "unknown" };

/**
 * `GET /api/rooms/:roomId` is polymorphic and answers **200 either way**.
 *
 * A room whose canonical game exists returns a `GameBootstrap`. A room that has
 * not started — or one whose game is gone, which the server normalizes to the
 * `abandoned` status — returns the *lobby* shape `{ room, selfMemberId }` with
 * no `publicProjection` at all (see `bootstrap()` in
 * apps/server/src/rooms/service/create-room-service.ts, which branches on
 * `room.game === null`).
 *
 * Casting that lobby payload to `GameBootstrap` made `createGameView` read
 * `undefined.players` *during render*, so visiting `/rooms/:id/game` before the
 * host pressed start replaced the whole view with the router's error component —
 * and `GameAbsent`, the screen written for exactly this case, was unreachable
 * because the only path to it was an HTTP 404. Narrowing on the discriminating
 * field is what makes that screen reachable.
 *
 * The three outcomes are kept distinct on purpose: a *missing* `publicProjection`
 * is the documented lobby answer and means "no match yet", whereas a
 * `publicProjection` that is present but malformed is a real protocol failure and
 * must read as an error rather than as a room nobody has started.
 */
export function classifyBootstrap(payload: unknown): BootstrapShape {
  if (!isRecord(payload)) return { kind: "unknown" };
  if (!isRecord(payload["room"]) || !Array.isArray(payload["room"]["members"])) {
    return { kind: "unknown" };
  }
  if (payload["publicProjection"] === undefined || payload["publicProjection"] === null) {
    return { kind: "lobby" };
  }

  const projection = payload["publicProjection"];
  const self = payload["self"];
  if (
    !isRecord(projection) ||
    !Array.isArray(projection["players"]) ||
    !Array.isArray(projection["eventSummaries"]) ||
    typeof projection["revision"] !== "number" ||
    !isRecord(self) ||
    typeof self["playerId"] !== "string" ||
    !Array.isArray(payload["legalActions"])
  ) {
    return { kind: "unknown" };
  }

  return { kind: "game", bootstrap: payload as unknown as GameBootstrap };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* ------------------------------------------------------------------------- */
/* Non-board modes.                                                          */
/*                                                                           */
/* Each is the same terminal in a different mode, not a card centred on an    */
/* empty page (DESIGN.md §4.5): a 48px header bar, a 40px telemetry strip,    */
/* then one report region whose content aligns to the shell's left gutter.    */
/* ------------------------------------------------------------------------- */

type ShellTone = "active" | "caution" | "critical" | "info" | "neutral";

function ShellBar({ title, state }: { readonly title: string; readonly state: string }) {
  return (
    <header className="game-shell-bar" data-slot="game-shell-bar">
      <p className="game-shell-bar-title">Deadline Dash</p>
      <span aria-hidden="true" className="game-shell-bar-rule" />
      <p className="game-shell-label">{title}</p>
      <span aria-hidden="true" className="game-shell-bar-spacer" />
      <p className="game-shell-label">{state}</p>
    </header>
  );
}

function ShellStrip({
  readouts,
}: {
  readonly readouts: readonly {
    readonly label: string;
    readonly value: string;
    readonly tone?: ShellTone;
  }[];
}) {
  return (
    <dl
      aria-label="Terminal state"
      className="game-shell-strip"
      data-slot="game-shell-strip"
      /* Suppressed-scrollbar overflow region: without a tab stop its readouts are
         pointer-only on a narrow viewport (§8). Mirrors `.hud-strip`. */
      tabIndex={0}
    >
      {readouts.map((readout) => (
        <div className="game-shell-cell" key={readout.label}>
          <dt className="game-shell-label">{readout.label}</dt>
          <dd>
            {readout.tone === undefined ? null : (
              <span
                aria-hidden="true"
                className="game-shell-led"
                data-tone={readout.tone}
              />
            )}
            <span className="game-shell-value">{readout.value}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function BackToRoomLink({
  roomId,
  primary = false,
}: {
  readonly roomId: string;
  readonly primary?: boolean;
}) {
  return (
    <Link
      className={primary ? "game-shell-btn game-shell-btn-primary" : "game-shell-btn"}
      data-slot="game-shell-back"
      params={{ roomId }}
      to="/rooms/$roomId"
    >
      <RiArrowLeftLine aria-hidden="true" className="game-shell-btn-glyph" />
      Back to room
    </Link>
  );
}

export function GameLoading() {
  return (
    <main className="game-viewport">
      <div aria-busy="true" className="game-shell-report" data-slot="game-loading">
        <ShellBar state="Connecting" title="Terminal" />
        <ShellStrip
          readouts={[
            { label: "Link", value: "Opening", tone: "info" },
            { label: "Source", value: "Room projection" },
            { label: "Poll", value: "5s" },
          ]}
        />
        <div className="game-shell-body">
          <p className="game-shell-kicker">Reading projection</p>
          <h1 className="game-shell-title">Connecting to the floor terminal.</h1>
          <p className="game-shell-copy">
            The board, seats and activity log are rebuilt from the server&apos;s committed
            projection. This screen holds until the first read lands.
          </p>
          <ul aria-hidden="true" className="game-shell-skeleton" data-slot="game-loading-skeleton">
            {["seats", "board", "telemetry", "log", "actions"].map((row, index) => (
              <li key={row}>
                <span className="game-shell-skeleton-bar" style={{ width: `${88 - index * 12}px` }} />
                <span className="game-shell-skeleton-bar" style={{ width: `${160 - index * 16}px` }} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}

export function GameAbsent({ roomId }: { readonly roomId: string }) {
  return (
    <main className="game-viewport">
      <div className="game-shell-report" data-slot="game-absent">
        <ShellBar state="No match" title="Terminal" />
        <ShellStrip
          readouts={[
            { label: "Match", value: "Not started", tone: "neutral" },
            { label: "Room", value: "Open" },
          ]}
        />
        <div className="game-shell-body">
          <p className="game-shell-kicker">No active match</p>
          <h1 className="game-shell-title">This room has not started a shift.</h1>
          <p className="game-shell-copy">
            The board only exists once the host starts the match. Three seats are the
            minimum, and bots count toward it — one human plus two bots is a legal table.
          </p>
          <div className="game-shell-actions">
            <BackToRoomLink primary roomId={roomId} />
          </div>
        </div>
      </div>
    </main>
  );
}

export function GameError({
  message,
  onRetry,
  roomId,
}: {
  readonly message: string;
  readonly onRetry: () => void;
  readonly roomId: string;
}) {
  return (
    <main className="game-viewport">
      <div className="game-shell-report" data-slot="game-error">
        <ShellBar state="Feed dropped" title="Terminal" />
        <ShellStrip
          readouts={[
            { label: "Link", value: "Dropped", tone: "critical" },
            { label: "Poll", value: "Still running" },
          ]}
        />
        <div className="game-shell-body">
          <p className="game-shell-kicker">Projection unavailable</p>
          <h1 className="game-shell-title">The board feed dropped.</h1>
          <p className="game-shell-notice" data-slot="game-error-message" role="alert">
            <span
              aria-hidden="true"
              className="game-shell-led game-shell-notice-led"
              data-tone="critical"
            />
            <span>{message}</span>
          </p>
          <p className="game-shell-copy">
            The terminal keeps polling every five seconds on its own. Retry forces an
            immediate re-read instead of waiting for the next tick.
          </p>
          <div className="game-shell-actions">
            <button
              className="game-shell-btn game-shell-btn-primary"
              data-slot="game-error-retry"
              onClick={onRetry}
              type="button"
            >
              <RiRefreshLine aria-hidden="true" className="game-shell-btn-glyph" />
              Retry
            </button>
            <BackToRoomLink roomId={roomId} />
          </div>
        </div>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------------- */
/* End-of-match report.                                                      */
/* ------------------------------------------------------------------------- */

const CLOSING_LOG_ENTRIES = 8;

type StandingRow = {
  readonly player: PublicPlayerProjection;
  readonly name: string;
  readonly slot: number;
  readonly isWinner: boolean;
  readonly isSelf: boolean;
  readonly isBot: boolean;
};

/**
 * The match report. Reaching `rank.director` is the only win condition, so the
 * report states that outcome plainly and then does what a terminal does with a
 * closed shift: prints the final standings as a table and the last committed log
 * lines underneath. No celebration — the payoff is the record, not a banner.
 */
export function GameWinner({
  bootstrap,
  roomId,
}: {
  readonly bootstrap: GameBootstrap;
  readonly roomId: string;
}) {
  const game = bootstrap.publicProjection;
  const winnerIds = new Set(game.winnerPlayerIds);
  const standings = buildStandings(bootstrap, winnerIds);
  const selfWon = winnerIds.has(bootstrap.self.playerId);
  const winnerNames = standings
    .filter((row) => row.isWinner)
    .map((row) => row.name);
  // The fourth argument marks the viewer's own rows (`YOU` stamp, one tonal
  // step), so the report's closing entries carry the same mine-vs-theirs
  // treatment the live rail does instead of reading as all-anonymous.
  const closingEntries = buildActivityLog(game, bootstrap.room, [], bootstrap.self.playerId)
    .slice(-CLOSING_LOG_ENTRIES)
    .reverse();

  return (
    <main className="game-viewport">
      <div className="game-shell-report" data-slot="game-winner">
        <ShellBar state="Match closed" title="Match report" />
        <ShellStrip
          readouts={[
            { label: "Status", value: "Closed", tone: "active" },
            { label: "Outcome", value: outcomeValue(winnerNames) },
            { label: "Rounds", value: formatNumber(game.round) },
            { label: "Turns", value: formatNumber(game.turnNumber) },
            { label: "Seats", value: formatNumber(game.players.length) },
            { label: "Revision", value: `R${formatNumber(game.revision)}` },
          ]}
        />
        <div className="game-shell-body">
          <p className="game-shell-kicker">
            <span aria-hidden="true" className="game-shell-led" data-tone="active" />
            Shift complete
          </p>
          <h1 className="game-shell-title">{winnerHeadline(selfWon, winnerNames)}</h1>
          <p className="game-shell-copy">
            Reaching Director closes the match for everyone. Promotions are automatic once
            their money and reputation cost is met, so the standings below are simply where
            each seat stood when the floor locked at revision {formatNumber(game.revision)}.
          </p>

          <section aria-labelledby="game-winner-standings" className="game-shell-section">
            <header className="game-shell-section-head">
              <h2 className="game-shell-section-heading" id="game-winner-standings">
                Final standings
              </h2>
              <span className="game-shell-caption">
                {formatNumber(standings.length)} seats
              </span>
            </header>
            <div className="game-shell-table-scroll">
              <table className="game-shell-table" data-slot="game-winner-standings">
                <thead>
                  <tr>
                    <th data-align="end" scope="col">
                      Pos
                    </th>
                    <th scope="col">Seat</th>
                    <th scope="col">Employee</th>
                    <th scope="col">Rank</th>
                    <th data-align="end" scope="col">
                      Tile
                    </th>
                    <th data-align="end" scope="col">
                      Money
                    </th>
                    <th data-align="end" scope="col">
                      Rep
                    </th>
                    <th data-align="end" scope="col">
                      Energy
                    </th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((row, index) => (
                    <tr
                      data-outcome={row.isWinner ? "winner" : "closed"}
                      data-slot="game-winner-standing"
                      key={row.player.id}
                    >
                      <td data-align="end" data-numeric="true">
                        {index + 1}
                      </td>
                      <td>
                        <span
                          aria-hidden="true"
                          className={`game-shell-seat game-shell-seat-${row.slot}`}
                        >
                          {row.slot}
                        </span>
                        <span className="sr-only">Seat {row.slot}</span>
                      </td>
                      <td>
                        {row.name}
                        {row.isSelf ? " (you)" : ""}
                        {row.isBot ? " · Bot" : ""}
                      </td>
                      <td>{rankLabel(row.player)}</td>
                      <td data-align="end" data-numeric="true">
                        {tileLabel(row.player.position)}
                      </td>
                      <td data-align="end" data-numeric="true">
                        ${formatNumber(row.player.resources["money"] ?? 0)}
                      </td>
                      <td data-align="end" data-numeric="true">
                        {formatNumber(row.player.resources["reputation"] ?? 0)}
                      </td>
                      <td data-align="end" data-numeric="true">
                        {formatNumber(row.player.resources["energy"] ?? 0)}
                      </td>
                      <td>
                        <span
                          className="game-shell-tag"
                          data-tone={row.isWinner ? "accent" : "neutral"}
                        >
                          {row.isWinner ? "Director" : "Not promoted"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="game-winner-log" className="game-shell-section">
            <header className="game-shell-section-head">
              <h2 className="game-shell-section-heading" id="game-winner-log">
                Closing entries
              </h2>
              <span className="game-shell-caption">
                Last {formatNumber(closingEntries.length)} committed
              </span>
            </header>
            <ActivityLog
              emptyLabel="No entries were committed before the match closed."
              entries={closingEntries}
            />
          </section>

          <div className="game-shell-actions">
            <BackToRoomLink roomId={roomId} />
          </div>
        </div>
      </div>
    </main>
  );
}

export function outcomeValue(winnerNames: readonly string[]): string {
  if (winnerNames.length === 0) return "No Director";
  if (winnerNames.length === 1) return `${winnerNames[0]} · Director`;

  return `${formatNumber(winnerNames.length)} Directors`;
}

export function winnerHeadline(selfWon: boolean, winnerNames: readonly string[]): string {
  if (selfWon) return "You reached Director.";
  if (winnerNames.length === 1) return `${winnerNames[0]} reached Director.`;
  if (winnerNames.length > 1) return `${winnerNames.join(" and ")} reached Director.`;

  return "The match closed without a Director.";
}

/**
 * Highest rank first, then money, then reputation — the same order the promotion
 * ladder itself uses. Any declared winner is pinned to the top so the report's
 * first row is always the seat that actually closed the match, even if a future
 * end condition ever settles on someone who is not the richest at the table.
 */
function buildStandings(
  bootstrap: GameBootstrap,
  winnerIds: ReadonlySet<string>,
): readonly StandingRow[] {
  const game = bootstrap.publicProjection;

  return game.players
    .map((player): StandingRow => {
      const member = bootstrap.room.members.find(
        (candidate) => candidate.id === player.id,
      );

      return {
        player,
        name: member?.displayName ?? playerName(bootstrap.room, player.id),
        slot: seatSlot(game, player.id),
        isWinner: winnerIds.has(player.id),
        isSelf: player.id === bootstrap.self.playerId,
        isBot: member?.isBot ?? false,
      };
    })
    .sort((left, right) => {
      if (left.isWinner !== right.isWinner) return left.isWinner ? -1 : 1;
      if (left.player.rank.index !== right.player.rank.index) {
        return right.player.rank.index - left.player.rank.index;
      }
      const moneyGap =
        (right.player.resources["money"] ?? 0) - (left.player.resources["money"] ?? 0);
      if (moneyGap !== 0) return moneyGap;

      return (
        (right.player.resources["reputation"] ?? 0) -
        (left.player.resources["reputation"] ?? 0)
      );
    });
}
