"use client";

import { RiAddLine, RiLoginBoxLine } from "@remixicon/react";

import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Field, FieldDescription, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "../ui/native-select";

import type {
  ActionState,
  CharacterOption,
  CreateJoinPanelProps,
  RoomFormSubmitEvent,
} from "./types";

export function CreateJoinPanel({
  characterOptions,
  createState = { kind: "idle" },
  joinState = { kind: "idle" },
  onCreate,
  onJoin,
}: CreateJoinPanelProps) {
  return (
    <section className="border border-border bg-card" aria-labelledby="room-entry-title">
      <div className="space-y-1 border-b border-border px-4 py-5 sm:px-6">
        <h2 id="room-entry-title" className="font-heading text-lg font-semibold tracking-wider uppercase">
          Enter the floor
        </h2>
        <p className="text-sm text-muted-foreground">
          Create a private room or join one with a six-character code.
        </p>
      </div>

      <div className="grid md:grid-cols-2 md:divide-x md:divide-border">
        <RoomEntryForm
          kind="create"
          state={createState}
          characterOptions={characterOptions}
          onSubmit={(event) => {
            const formData = new FormData(event.currentTarget);
            onCreate({
              playerName: String(formData.get("playerName") ?? ""),
              characterId: String(formData.get("characterId") ?? ""),
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
  onSubmit,
}: {
  readonly kind: "create" | "join";
  readonly state: ActionState;
  readonly characterOptions: readonly CharacterOption[];
  readonly onSubmit: (event: RoomFormSubmitEvent) => void;
}) {
  const isCreate = kind === "create";
  const isLoading = state.kind === "loading";
  const isDisabled = isLoading || state.kind === "disabled";

  function submit(event: RoomFormSubmitEvent): void {
    event.preventDefault();
    onSubmit(event);
  }

  return (
    <form className="space-y-5 px-4 py-6 sm:px-6" onSubmit={submit} aria-busy={isLoading}>
      <div className="space-y-1">
        <h3 className="font-heading text-base font-semibold text-foreground">
          {isCreate ? "Open a room" : "Join a room"}
        </h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {isCreate
            ? "You become host and control when the match starts."
            : "Use the code shared by the room host."}
        </p>
      </div>

      <Field>
        <FieldLabel htmlFor={`${kind}-player-name`}>Display name</FieldLabel>
        <Input
          id={`${kind}-player-name`}
          name="playerName"
          minLength={2}
          maxLength={24}
          autoComplete="nickname"
          placeholder="Quartermaster"
          disabled={isDisabled}
          required
        />
      </Field>

      {isCreate ? null : (
        <Field>
          <FieldLabel htmlFor="join-room-code">Room code</FieldLabel>
          <Input
            id="join-room-code"
            name="roomCode"
            minLength={6}
            maxLength={6}
            autoComplete="off"
            spellCheck={false}
            placeholder="Q4W8ZT"
            className="uppercase"
            disabled={isDisabled}
            required
          />
          <FieldDescription>Six letters or numbers, provided by the host.</FieldDescription>
        </Field>
      )}

      <Field>
        <FieldLabel htmlFor={`${kind}-character`}>Character</FieldLabel>
        <NativeSelect
          id={`${kind}-character`}
          name="characterId"
          className="w-full"
          disabled={isDisabled}
          required
          defaultValue=""
        >
          <NativeSelectOption value="" disabled>
            Choose character
          </NativeSelectOption>
          {characterOptions.map((option) => (
            <NativeSelectOption key={option.id} value={option.id}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>

      {state.kind === "error" ? (
        <Alert variant="destructive" className="border-destructive/30 bg-background">
          <AlertTitle>{isCreate ? "Room not created" : "Room not joined"}</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      {state.kind === "disabled" && state.reason ? (
        <p className="text-xs text-muted-foreground">{state.reason}</p>
      ) : null}

      <Button className="w-full" type="submit" disabled={isDisabled}>
        {isCreate ? <RiAddLine aria-hidden="true" /> : <RiLoginBoxLine aria-hidden="true" />}
        {isLoading
          ? isCreate
            ? "Creating room"
            : "Joining room"
          : isCreate
            ? "Create room"
            : "Join room"}
      </Button>
    </form>
  );
}
