"use client";

import type { ReactNode } from "react";

import type { ModeRules } from "@office-ladder/contracts";

import { CustomRulesBuilder } from "./custom-rules-builder";
import {
  customRulesToSend,
  DEFAULT_MODE_SELECTION,
  ModePicker,
  selectionModeId,
  type ModeSelection,
} from "./mode-picker";
import type { ModePresetId } from "./mode-presets";
import type {
  ActionState,
  CharacterOption,
  CreateJoinPanelProps,
  RoomFormSubmitEvent,
} from "./types";

/**
 * What creating a room now needs, on top of the two identity fields.
 *
 * `modeId` is always a shipped preset — a custom ruleset is created under the
 * preset it was derived from and then applied on top, because `mode.custom` is
 * not a content preset (spec §4.2). `customRules` is `null` whenever the room's
 * preset already *is* the ruleset, so an untouched "Custom" selection posts
 * nothing extra.
 */
export type CreateRoomSubmission = {
  readonly playerName: string;
  readonly characterId: string;
  readonly modeId: ModePresetId;
  readonly customRules: ModeRules | null;
};

export type CreateJoinPanelModeProps = {
  readonly modeSelection?: ModeSelection;
  readonly onModeSelectionChange?: (selection: ModeSelection) => void;
};

type PanelProps = Omit<CreateJoinPanelProps, "onCreate"> &
  CreateJoinPanelModeProps & {
    readonly onCreate: (request: CreateRoomSubmission) => void;
  };

/**
 * Room entry as a two-slot requisition form: one vertical hairline between the
 * two columns, both flush to the shared shell grid — no floating cards
 * (DESIGN.md §4.1, §4.3, §4.5).
 *
 * The create column now carries the match's ruleset as well as its identity
 * fields. That is the whole point of this panel's existence: for four waves the
 * configurable-ruleset system had no selector anywhere, so every room ever
 * created was `mode.quick` — the literal that used to be hardcoded into the
 * create call.
 */
export function CreateJoinPanel({
  characterOptions,
  createState = { kind: "idle" },
  joinState = { kind: "idle" },
  modeSelection = DEFAULT_MODE_SELECTION,
  onModeSelectionChange,
  onCreate,
  onJoin,
}: PanelProps) {
  const createDisabled =
    createState.kind === "loading" || createState.kind === "disabled";

  return (
    <section className="shell-panel" aria-labelledby="room-entry-title">
      <div className="shell-panel-head">
        <h2 id="room-entry-title" className="shell-label shell-high">
          Room access
        </h2>
        <span className="shell-caption shell-medium">Two routes onto the floor</span>
      </div>

      <div className="shell-columns">
        <RoomEntryForm
          kind="create"
          state={createState}
          characterOptions={characterOptions}
          extraFields={
            <>
              <ModePicker
                selection={modeSelection}
                disabled={createDisabled}
                onSelectionChange={(next) => {
                  onModeSelectionChange?.(next);
                }}
              />
              {modeSelection.kind === "custom" ? (
                <CustomRulesBuilder
                  draft={modeSelection.draft}
                  disabled={createDisabled}
                  onDraftChange={(draft) => {
                    onModeSelectionChange?.({ kind: "custom", draft });
                  }}
                />
              ) : null}
            </>
          }
          onSubmit={(event) => {
            const formData = new FormData(event.currentTarget);
            onCreate({
              playerName: String(formData.get("playerName") ?? ""),
              characterId: String(formData.get("characterId") ?? ""),
              modeId: selectionModeId(modeSelection),
              customRules: customRulesToSend(modeSelection),
            });
          }}
        />
        <RoomEntryForm
          kind="join"
          state={joinState}
          characterOptions={characterOptions}
          onSubmit={(event) => {
            const formData = new FormData(event.currentTarget);
            onJoin({
              playerName: String(formData.get("playerName") ?? ""),
              characterId: String(formData.get("characterId") ?? ""),
              roomCode: String(formData.get("roomCode") ?? "").trim().toUpperCase(),
            });
          }}
        />
      </div>
    </section>
  );
}

function RoomEntryForm({
  kind,
  state,
  characterOptions,
  extraFields,
  onSubmit,
}: {
  readonly kind: "create" | "join";
  readonly state: ActionState;
  readonly characterOptions: readonly CharacterOption[];
  readonly extraFields?: ReactNode;
  readonly onSubmit: (event: RoomFormSubmitEvent) => void;
}) {
  const isCreate = kind === "create";
  const isLoading = state.kind === "loading";
  const isDisabled = isLoading || state.kind === "disabled";
  const errorId = `${kind}-error`;

  function submit(event: RoomFormSubmitEvent): void {
    event.preventDefault();
    onSubmit(event);
  }

  return (
    <form
      className="shell-region shell-stack-wide"
      onSubmit={submit}
      aria-busy={isLoading}
      aria-labelledby={`${kind}-form-title`}
    >
      <div className="shell-stack">
        <h3 id={`${kind}-form-title`} className="shell-headline shell-high">
          {isCreate ? "Open a room" : "Join a room"}
        </h3>
        <p className="shell-body shell-medium shell-prose">
          {isCreate
            ? "You become host. Fill the roster with players or bot seats, then start."
            : "Enter the six-character code the host shared."}
        </p>
      </div>

      <div className="shell-field">
        <label className="shell-field-label" htmlFor={`${kind}-player-name`}>
          Display name
        </label>
        <input
          id={`${kind}-player-name`}
          className="shell-input"
          name="playerName"
          type="text"
          minLength={2}
          maxLength={24}
          autoComplete="nickname"
          placeholder="Quartermaster"
          aria-describedby={state.kind === "error" ? errorId : undefined}
          aria-invalid={state.kind === "error"}
          disabled={isDisabled}
          required
        />
      </div>

      {isCreate ? null : (
        <div className="shell-field">
          <label className="shell-field-label" htmlFor="join-room-code">
            Room code
          </label>
          <input
            id="join-room-code"
            className="shell-input shell-input-code"
            name="roomCode"
            type="text"
            minLength={6}
            maxLength={6}
            autoComplete="off"
            spellCheck={false}
            placeholder="Q4W8ZT"
            aria-describedby="join-room-code-hint"
            disabled={isDisabled}
            required
          />
          <span className="shell-field-hint" id="join-room-code-hint">
            Six letters or numbers, issued to the host.
          </span>
        </div>
      )}

      <div className="shell-field">
        <label className="shell-field-label" htmlFor={`${kind}-character`}>
          Character
        </label>
        <span className="shell-select-wrap">
          <select
            id={`${kind}-character`}
            className="shell-select"
            name="characterId"
            defaultValue=""
            disabled={isDisabled}
            required
          >
            <option value="" disabled>
              Choose character
            </option>
            {characterOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </span>
      </div>

      {extraFields}

      {state.kind === "error" ? (
        <p className="shell-msg shell-msg-error" id={errorId} role="alert">
          <span className="shell-led shell-led-critical shell-msg-led" aria-hidden="true" />
          <span className="shell-msg-body">
            <span className="shell-label shell-medium">
              {isCreate ? "Not created" : "Not joined"}
            </span>{" "}
            {state.message}
          </span>
        </p>
      ) : null}

      {state.kind === "disabled" && state.reason ? (
        <p className="shell-msg shell-msg-info">
          <span className="shell-led shell-led-info shell-msg-led" aria-hidden="true" />
          <span className="shell-msg-body">
            <span className="shell-label shell-medium">Queued</span> {state.reason}
          </span>
        </p>
      ) : null}

      <div>
        <button
          type="submit"
          className={
            isCreate
              ? "shell-btn shell-btn-primary shell-btn-lg shell-btn-block"
              : "shell-btn shell-btn-outline shell-btn-lg shell-btn-block"
          }
          data-action={isCreate ? "create-room" : "join-room"}
          disabled={isDisabled}
          aria-busy={isLoading}
        >
          {isLoading
            ? isCreate
              ? "Creating room"
              : "Joining room"
            : isCreate
              ? "Create room"
              : "Join room"}
        </button>
      </div>
    </form>
  );
}
