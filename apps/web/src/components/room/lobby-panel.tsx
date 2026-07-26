import { EmptySeat } from "./empty-seat";
import { PlayerDossier } from "./player-dossier";
import { evaluateStartCheck, ReadinessSummary } from "./readiness-summary";
import {
  botDifficultyLabel,
  type BotRequisition,
  type LobbyState,
  type StartControl,
} from "./types";

type LobbyPanelProps = {
  readonly state: LobbyState;
};

export function LobbyPanel({ state }: LobbyPanelProps) {
  switch (state.kind) {
    case "loading":
      return <LobbyLoading seatCount={state.seatCount ?? 6} />;
    case "error":
      return <LobbyError message={state.message} onRetry={state.onRetry} />;
    case "ready": {
      const minimumPlayers = state.minimumPlayers ?? 3;
      const maximumPlayers = state.maximumPlayers ?? 6;
      const roomStatus = state.roomStatus ?? "open";
      const openSeats = Math.max(0, maximumPlayers - state.players.length);
      const check = evaluateStartCheck(state.players, minimumPlayers, roomStatus);
      const requisition = state.botRequisition ?? null;

      return (
        <section className="shell-panel" aria-labelledby="lobby-roster-title">
          <div className="shell-panel-head">
            <h2 id="lobby-roster-title" className="shell-label shell-high">
              Roster
            </h2>
            <span className="shell-caption shell-medium">
              {state.players.length} of {maximumPlayers} seats filled
            </span>
          </div>

          <ReadinessSummary
            players={state.players}
            minimumPlayers={minimumPlayers}
            maximumPlayers={maximumPlayers}
            roomStatus={roomStatus}
          />

          <div className="shell-roster-head">
            <span className="shell-label">Seat</span>
            <span className="shell-label">Member</span>
            <span className="shell-label">Type</span>
            <span className="shell-label">Assignment</span>
            <span className="shell-label shell-seat-actions">Status</span>
          </div>

          <div role="list" aria-label="Room roster" className="shell-roster">
            {state.players.map((player) => (
              <PlayerDossier
                key={player.id}
                player={player}
                characterOptions={state.characterOptions}
                onCharacterChange={
                  state.onCharacterChange
                    ? (characterId) => state.onCharacterChange?.(player.id, characterId)
                    : undefined
                }
                onReadyChange={
                  state.onReadyChange
                    ? (isReady) => state.onReadyChange?.(player.id, isReady)
                    : undefined
                }
                onRemoveBot={
                  player.isBot && state.onRemoveBot
                    ? () => state.onRemoveBot?.(player.id)
                    : undefined
                }
                isRemoving={state.removingMemberId === player.id}
                disabled={state.startControl.kind === "loading"}
              />
            ))}
            {Array.from({ length: openSeats }, (_, index) => {
              const seatNumber = state.players.length + index + 1;
              return (
                <EmptySeat
                  key={seatNumber}
                  seatNumber={seatNumber}
                  required={seatNumber <= minimumPlayers}
                />
              );
            })}
          </div>

          {requisition ? (
            <BotRequisitionSection requisition={requisition} />
          ) : check.seatsToMinimum > 0 ? (
            <div className="shell-region shell-seam-top">
              <p className="shell-msg shell-msg-info">
                <span className="shell-led shell-led-info shell-msg-led" aria-hidden="true" />
                <span className="shell-msg-body">
                  <span className="shell-label shell-medium">Waiting</span> The host still needs
                  to seat {check.seatsToMinimum} more{" "}
                  {check.seatsToMinimum === 1 ? "member" : "members"} — either players joining
                  with the room code, or bot seats.
                </span>
              </p>
            </div>
          ) : null}

          <StartSection
            control={state.startControl}
            onStart={state.onStart}
            error={state.startError ?? null}
          />
        </section>
      );
    }
    default:
      return assertNever(state);
  }
}

/**
 * Host-only. A non-host never renders this at all — a control they cannot use
 * has no business being on their screen, disabled or otherwise.
 */
function BotRequisitionSection({
  requisition,
}: {
  readonly requisition: BotRequisition;
}) {
  const isPending = requisition.state === "pending";
  const isBlocked = requisition.state === "full" || requisition.state === "closed";
  const addCount = Math.max(1, requisition.seatsToMinimum);
  const addLabel = isPending
    ? "Adding bot"
    : addCount > 1
      ? `Add ${addCount} bots`
      : "Add bot";

  return (
    <section className="shell-region shell-seam-top" aria-labelledby="bot-requisition-title">
      <div className="shell-split">
        <div className="shell-stack">
          <h3 id="bot-requisition-title" className="shell-label shell-high">
            Bot seats
          </h3>
          <p className="shell-body shell-medium shell-prose">
            A bot takes a real seat and counts toward the minimum headcount, so one player plus
            two bots is enough to start a match.
          </p>
        </div>

        <div className="shell-row-inline">
          <label className="shell-field" htmlFor="bot-difficulty">
            <span className="shell-field-label">Difficulty</span>
            <span className="shell-select-wrap">
              <select
                id="bot-difficulty"
                name="botDifficulty"
                className="shell-select"
                value={requisition.difficulty}
                disabled={isPending || isBlocked}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  const match = requisition.difficulties.find(
                    (difficulty) => difficulty === value,
                  );
                  if (match !== undefined) requisition.onDifficultyChange(match);
                }}
              >
                {requisition.difficulties.map((difficulty) => (
                  <option key={difficulty} value={difficulty}>
                    {botDifficultyLabel(difficulty)}
                  </option>
                ))}
              </select>
            </span>
          </label>

          <button
            type="button"
            className={
              requisition.emphasis === "primary"
                ? "shell-btn shell-btn-primary"
                : "shell-btn shell-btn-outline"
            }
            data-action="add-bot"
            disabled={isPending || isBlocked}
            aria-busy={isPending}
            onClick={() => requisition.onAdd(addCount)}
          >
            {addLabel}
          </button>
        </div>
      </div>

      {requisition.state === "full" ? (
        <p className="shell-msg shell-msg-caution shell-gap-top">
          <span className="shell-led shell-led-caution shell-msg-led" aria-hidden="true" />
          <span className="shell-msg-body">
            <span className="shell-label shell-medium">Full</span> Every seat is taken. Remove a
            bot before adding another.
          </span>
        </p>
      ) : null}

      {requisition.state === "closed" ? (
        <p className="shell-msg shell-msg-info shell-gap-top">
          <span className="shell-led shell-led-info shell-msg-led" aria-hidden="true" />
          <span className="shell-msg-body">
            <span className="shell-label shell-medium">Locked</span> Bot seats can only change
            while the room is open.
          </span>
        </p>
      ) : null}

      {requisition.error !== null ? (
        <p className="shell-msg shell-msg-error shell-gap-top" role="alert">
          <span className="shell-led shell-led-critical shell-msg-led" aria-hidden="true" />
          <span className="shell-msg-body">
            <span className="shell-label shell-medium">Rejected</span> {requisition.error}
          </span>
        </p>
      ) : null}
    </section>
  );
}

function StartSection({
  control,
  onStart,
  error,
}: {
  readonly control: StartControl;
  readonly onStart?: () => void;
  readonly error: string | null;
}) {
  if (control.kind === "hidden") {
    return error === null ? null : (
      <div className="shell-region shell-seam-top">
        <StartError message={error} />
      </div>
    );
  }

  const isLoading = control.kind === "loading";
  const isEnabled = control.kind === "enabled";
  const note =
    control.kind === "blocked"
      ? control.reason
      : isLoading
        ? "Dealing characters and opening the floor."
        : "Everyone on the roster is seated. Start when ready.";
  const label = isLoading
    ? (control.label ?? "Starting match")
    : isEnabled
      ? (control.label ?? "Start match")
      : "Start match";

  return (
    <div className="shell-region shell-region-surface shell-seam-top">
      <div className="shell-split">
        <p className="shell-body shell-medium shell-prose">{note}</p>
        <button
          type="button"
          className={
            isEnabled
              ? "shell-btn shell-btn-primary shell-btn-lg"
              : "shell-btn shell-btn-outline shell-btn-lg"
          }
          data-action="start-match"
          disabled={!isEnabled || onStart === undefined}
          aria-busy={isLoading}
          onClick={onStart}
        >
          {label}
        </button>
      </div>
      {error === null ? null : (
        <div className="shell-gap-top">
          <StartError message={error} />
        </div>
      )}
    </div>
  );
}

function StartError({ message }: { readonly message: string }) {
  return (
    <p className="shell-msg shell-msg-error" role="alert">
      <span className="shell-led shell-led-critical shell-msg-led" aria-hidden="true" />
      <span className="shell-msg-body">
        <span className="shell-label shell-medium">Not started</span> {message}
      </span>
    </p>
  );
}

/**
 * Skeleton rows on the roster's own grid at surface-sunken — never a spinner
 * floating in the middle of an empty table (DESIGN.md §6.3).
 */
function LobbyLoading({ seatCount }: { readonly seatCount: number }) {
  return (
    <section className="shell-panel" aria-busy="true" aria-label="Loading roster">
      <div className="shell-panel-head">
        <span className="shell-label shell-high">Roster</span>
        <span className="shell-caption shell-medium">Reading room record</span>
      </div>

      <div className="shell-strip">
        {["Start check", "Headcount", "Occupancy", "Human", "Bot", "Ready"].map((label) => (
          <div className="shell-strip-cell" key={label}>
            <span className="shell-label shell-medium">{label}</span>
            <span className="shell-skel shell-skel-block" style={{ width: "56px" }} />
          </div>
        ))}
      </div>

      <div>
        {Array.from({ length: seatCount }, (_, index) => (
          <div className="shell-skel-row" key={index}>
            <span className="shell-skel shell-skel-block" style={{ width: "24px" }} />
            <span className="shell-skel shell-skel-block" style={{ flex: "1 1 0%" }} />
            <span className="shell-skel shell-skel-block" style={{ width: "88px" }} />
            <span className="shell-skel shell-skel-block" style={{ width: "64px" }} />
          </div>
        ))}
      </div>
    </section>
  );
}

function LobbyError({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry?: () => void;
}) {
  return (
    <section className="shell-panel" aria-labelledby="lobby-error-title">
      <div className="shell-panel-head">
        <h2 id="lobby-error-title" className="shell-label shell-high">
          Room unavailable
        </h2>
      </div>
      <div className="shell-region shell-stack-wide">
        <p className="shell-msg shell-msg-error" role="alert">
          <span className="shell-led shell-led-critical shell-msg-led" aria-hidden="true" />
          <span className="shell-msg-body">
            <span className="shell-label shell-medium">Error</span> {message}
          </span>
        </p>
        {onRetry ? (
          <div>
            <button
              type="button"
              className="shell-btn shell-btn-outline"
              onClick={onRetry}
            >
              Retry
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function assertNever(value: never): never {
  throw new TypeError(`Unhandled room state: ${String(value)}`);
}
