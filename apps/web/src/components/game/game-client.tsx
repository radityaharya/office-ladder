import { RiArrowLeftLine, RiRefreshLine } from "@remixicon/react";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { GameBootstrap, PublicPlayerProjection } from "@office-ladder/contracts";
import { subscribeRoomUpdates } from "@/realtime/room-channel";

import { GameBoard } from "./board";
import { ActionTray } from "./action-tray";
import { useDiceFeed } from "./dice";
import { useEventPacing } from "./event-feedback-policy";
import { GameHud } from "./game-hud";
import { CardDrawFeed, GameFeedback } from "./game-feedback";
import { shouldShowGameWinner } from "./game-completion-policy";
import { AttentionNotice, GameLayout } from "./game-layout";
import {
  createAttentionNotice,
  createGameView,
  findPromptAction,
  findRollAction,
} from "./game-view";
import {
  ActivityLog,
  buildActivityLog,
  formatNumber,
  playerName,
  rankLabel,
  seatSlot,
  tileLabel,
  TurnRail,
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

export function GameClient({ roomId }: GameClientProps) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [isRolling, setIsRolling] = useState(false);
  const [rollError, setRollError] = useState<string | null>(null);
  const [isResponding, setIsResponding] = useState(false);
  const [respondError, setRespondError] = useState<string | null>(null);
  const [feedbackCompleteRevision, setFeedbackCompleteRevision] = useState<number | null>(null);

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
      setRollError(null);
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

  const roll = useCallback(async (): Promise<void> => {
    if (state.kind !== "ready") return;
    const action = findRollAction(state.bootstrap.legalActions);
    if (!action || state.bootstrap.publicProjection.activePlayerId !== state.bootstrap.self.playerId) return;

    setIsRolling(true);
    setRollError(null);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/roll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: crypto.randomUUID(), expectedRevision: action.expectedRevision }),
      });
      if (!response.ok) throw new GameRequestError(response.status);
      await refresh();
    } catch (error) {
      if (error instanceof GameRequestError) {
        setRollError(error.status === 409 ? "The turn changed before that roll reached the server. Refreshing the board." : "The roll was not accepted. Try again after the projection refreshes.");
        await refresh();
        return;
      }
      if (error instanceof TypeError) {
        setRollError("The game server could not be reached. The board will keep polling for the latest projection.");
        return;
      }
      throw error;
    } finally {
      // The single termination guarantee for the optimistic rolling state: it
      // clears on success, on a 409, on any other rejected status, on a network
      // TypeError, and on a rethrown unexpected error. The instrument's rolling
      // phase is a pure function of this flag, so it can never stick on.
      setIsRolling(false);
    }
  }, [refresh, roomId, state]);

  const respondToPrompt = useCallback(async (optionId: string): Promise<void> => {
    if (state.kind !== "ready") return;
    const action = findPromptAction(state.bootstrap.legalActions);
    if (!action) return;

    setIsResponding(true);
    setRespondError(null);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/respond`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          expectedRevision: action.expectedRevision,
          decisionPointId: action.decisionPointId,
          optionId,
        }),
      });
      if (!response.ok) throw new GameRequestError(response.status);
      await refresh();
    } catch (error) {
      if (error instanceof GameRequestError) {
        setRespondError(error.status === 409 ? "The turn changed before that response reached the server. Refreshing the board." : "That response was not accepted. Try again after the projection refreshes.");
        await refresh();
        return;
      }
      if (error instanceof TypeError) {
        setRespondError("The game server could not be reached.");
        return;
      }
      throw error;
    } finally {
      setIsResponding(false);
    }
  }, [refresh, roomId, state]);

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
        error={respondError}
        isResponding={isResponding}
        onIdleChange={handleIdleChange}
        onRespond={(optionId) => void respondToPrompt(optionId)}
      />
      <GameLayout
        hud={
          /*
           * Canonical. The HUD reads no events — it reports the local seat's
           * resources, rank and whose turn it is, and every one of those must
           * agree with the roll control beside it rather than with playback.
           */
          <GameHud
            game={state.bootstrap.publicProjection}
            room={state.bootstrap.room}
            selfCharacterId={state.bootstrap.self.characterId}
            selfPlayerId={state.bootstrap.self.playerId}
          />
        }
        board={
          <GameBoard
            activeTile={view.activeTile}
            incident={view.incident}
            label="Deadline Dash office board"
            landedTile={view.landedTile}
            players={view.players}
            spaces={view.spaces}
          />
        }
        actionTray={
          /*
            Canonical `canRoll` and canonical active-player name. DESIGN.md
            §7.2: the roll control is live the instant the server says the
            action is legal, whatever is still animating or playing back.

            The catch-up control used to sit above this as a second stacked row.
            It now lives in the rail head — see `catchUp` below.
          */
          <ActionTray
            activePlayerName={activePlayerName(state.bootstrap)}
            canRoll={view.canRoll}
            dice={diceRoll}
            isRolling={isRolling}
            onRoll={() => void roll()}
            rollError={rollError}
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
            panels={[
              {
                /*
                  Events, as the TRACK tab's card-feed destination.

                  Non-blocking by construction: a drawn card reports something
                  the server ALREADY committed, so it never dims, never covers
                  the board and never needs a click. Living in the rail rather
                  than in the action stack under the board is what keeps the
                  board a fixed size — the rail shares the board's grid ROW, so
                  a card arriving costs the board nothing. `.card-feed`'s
                  container query reflows the notice to the rail's measure
                  rather than to the viewport.
                */
                content: <CardDrawFeed bootstrap={shown} />,
                id: "feed",
              },
            ]}
            room={state.bootstrap.room}
            selfPlayerId={state.bootstrap.self.playerId}
          />
        }
        attention={
          /*
            Canonical, never paced: a countdown derived from played-back state
            would be a lie about a real deadline. The band is a permanently
            reserved row, so what changes here is only the text inside it —
            nothing in this prop can move the board.
          */
          attentionNotice === null ? null : (
            <AttentionNotice
              deadline={attentionNotice.deadline}
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

function activePlayerName(bootstrap: GameBootstrap): string {
  const activePlayerId = bootstrap.publicProjection.activePlayerId;
  return activePlayerId ? playerName(bootstrap.room, activePlayerId) : "The server";
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
