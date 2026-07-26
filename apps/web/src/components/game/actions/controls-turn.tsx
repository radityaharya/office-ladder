/**
 * The turn surface: what is legal on your own turn, right now.
 *
 * These live in the command lane under the board — tier 1 of §12.2, never behind
 * a tab, because a player who must act has to see that they can without
 * navigating. The lane is a track of DEFINITE height (see `ActionControls` and
 * `styles/actions.css`), so a rare control appearing here costs the board nothing:
 * "nothing that appears or disappears may move the board" has been reported twice
 * and the fix is always the same — reserve the track, scroll inside it.
 *
 * Every draft below is built from the summary's own `expectedRevision`, so a
 * command carries the revision the *advertisement* was made against. That is what
 * makes a lost race a clean 409 instead of a command applied to a board that has
 * already moved on.
 */
import {
  clampAmount,
  formatActionMoney,
  humaniseId,
  labelFor,
  PLACEMENT_EFFECTS,
  readAmount,
  readText,
  type ActionControlProps,
} from "./action-model";
import {
  ActionAmountField,
  ActionButton,
  ActionChoiceField,
  ActionOptionRow,
  ActionSheet,
  type ActionOption,
} from "./action-parts";
import { formatPanelNumber } from "../panels/panel-format";

/* -------------------------------------------------------------------------- */
/* The spine                                                                  */
/* -------------------------------------------------------------------------- */

export function StartGameControl({
  action,
  description,
  onSubmit,
  pending,
  scope,
}: ActionControlProps<"game.start">) {
  return (
    <ActionButton
      command="game.start"
      description={description}
      emphasis="primary"
      onClick={() => onSubmit({ type: "game.start", expectedRevision: action.expectedRevision })}
      pending={pending}
      scope={scope}
    />
  );
}

/**
 * The one control that was always here. It stays the lane's single `primary`
 * emphasis (§1.5 spends `accent` once per view), and it is live the instant the
 * server says the action is legal, whatever is still animating (§7.2).
 */
export function RollControl({
  action,
  description,
  onSubmit,
  pending,
  scope,
}: ActionControlProps<"turn.roll">) {
  return (
    <ActionButton
      command="turn.roll"
      description={description}
      emphasis="primary"
      onClick={() => onSubmit({ type: "turn.roll", expectedRevision: action.expectedRevision })}
      pending={pending}
      scope={scope}
    />
  );
}

/**
 * Pips as one-press options rather than a stepper.
 *
 * The summary carries `minPips`/`maxPips` and — separately —`affordablePips`, and
 * those are different numbers: the mode allows ±3, your energy might buy 1. Every
 * pip the player cannot pay for is rendered and DISABLED with its own price, so
 * the ceiling is visible rather than silently absent. Zero is never offered: the
 * parser refuses it, because a zero adjust spends no energy, changes no roll and
 * still costs a revision.
 */
export function AdjustRollControl({
  action,
  context,
  description,
  onSubmit,
  pending,
  scope,
}: ActionControlProps<"turn.adjust-roll">) {
  const steps: number[] = [];
  for (let pips = action.minPips; pips <= action.maxPips; pips += 1) {
    if (pips !== 0) steps.push(pips);
  }

  const options: readonly ActionOption[] = steps.map((pips) => {
    const magnitude = Math.abs(pips);
    const affordable = magnitude <= action.affordablePips;

    return {
      value: String(pips),
      label: pips > 0 ? `+${formatPanelNumber(pips)}` : formatPanelNumber(pips),
      price: action.energyPerPip === 0 ? null : `${formatPanelNumber(magnitude * action.energyPerPip)}e`,
      note: affordable
        ? `Shifts the roll by ${formatPanelNumber(pips)}.`
        : `Needs ${formatPanelNumber(magnitude * action.energyPerPip)} energy; you hold ${formatPanelNumber(
            context.spendable.energy,
          )}.`,
      disabled: !affordable,
    };
  });

  return (
    <ActionOptionRow
      command="turn.adjust-roll"
      description={description}
      onChoose={(value) =>
        onSubmit({
          type: "turn.adjust-roll",
          expectedRevision: action.expectedRevision,
          pips: clampAmount(Number.parseInt(value, 10), action.minPips, action.maxPips),
        })
      }
      options={options}
      pending={pending}
      scope={scope}
    />
  );
}

/** The free action. Four at most, all named, so none of them hides in a menu. */
export function TurnActionControl({
  action,
  description,
  onSubmit,
  pending,
  scope,
}: ActionControlProps<"turn.action">) {
  const options: readonly ActionOption[] = action.actions.map((entry) => ({
    value: entry,
    label: humaniseId(entry),
  }));

  return (
    <ActionOptionRow
      command="turn.action"
      description={description}
      onChoose={(value) =>
        onSubmit({
          type: "turn.action",
          expectedRevision: action.expectedRevision,
          // Cast at the boundary: `actions` crosses the transport as strings, and
          // the server re-validates against `TURN_ACTIONS` — so the only values
          // reachable here are ones it enumerated.
          action: value as "work" | "network" | "scheme" | "rest",
          targetPlayerIds: [],
          choice: null,
        })
      }
      options={options}
      pending={pending}
      scope={scope}
    />
  );
}

/**
 * A token, and how many of it.
 *
 * `maxQuantity` is per-token, so the field's ceiling is re-read from the picked
 * token on submit rather than from the first one in the list.
 */
export function SpendTokenControl({
  action,
  context,
  description,
  onSubmit,
  pending,
  scope,
}: ActionControlProps<"turn.spend-token">) {
  const options: readonly ActionOption[] = action.tokens.map((token) => ({
    value: token.tokenId,
    label: labelFor(context.labels?.tokens, token.tokenId),
    price: `≤ ${formatPanelNumber(token.maxQuantity)}`,
    note: `Spends it on ${humaniseId(token.use).toLowerCase()}.`,
  }));

  return (
    <ActionSheet
      command="turn.spend-token"
      description={description}
      note="A token spent is gone. Nothing refunds one."
      onSubmit={(values) => {
        const tokenId = readText(values, "tokenId");
        const token = action.tokens.find((entry) => entry.tokenId === tokenId) ?? action.tokens[0];
        if (token === undefined) return;
        onSubmit({
          type: "turn.spend-token",
          expectedRevision: action.expectedRevision,
          tokenId: token.tokenId,
          quantity: readAmount(values, "quantity", 1, Math.max(1, token.maxQuantity), 1),
          use: token.use,
        });
      }}
      pending={pending}
      scope={scope}
      submitLabel="Spend"
    >
      <ActionChoiceField label="Token" name="tokenId" options={options} />
      <ActionAmountField
        defaultValue={1}
        hint="Capped at what the picked token allows."
        label="Quantity"
        max={Math.max(1, ...action.tokens.map((token) => token.maxQuantity))}
        min={1}
        name="quantity"
      />
    </ActionSheet>
  );
}

export function ActivateCharacterControl({
  action,
  description,
  onSubmit,
  pending,
  scope,
}: ActionControlProps<"turn.activate-character">) {
  return (
    <ActionButton
      command="turn.activate-character"
      description={description}
      onClick={() =>
        onSubmit({
          type: "turn.activate-character",
          expectedRevision: action.expectedRevision,
          abilityId: action.abilityId,
          // No target picker: the summary advertises one ability and carries no
          // eligible seats, so offering a victim list here would be this layer
          // inventing a targeting rule. A targeted ability needs the summary to
          // name its candidates first.
          targetPlayerIds: [],
          choice: null,
        })
      }
      pending={pending}
      scope={scope}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* The ladder and the auditor                                                 */
/* -------------------------------------------------------------------------- */

export function PromotionAttemptControl({
  action,
  description,
  onSubmit,
  pending,
  scope,
}: ActionControlProps<"promotion.attempt">) {
  return (
    <ActionButton
      command="promotion.attempt"
      description={description}
      onClick={() =>
        onSubmit({ type: "promotion.attempt", expectedRevision: action.expectedRevision })
      }
      pending={pending}
      scope={scope}
    />
  );
}

export function PromotionDeclineControl({
  action,
  description,
  onSubmit,
  pending,
  scope,
}: ActionControlProps<"promotion.decline">) {
  return (
    <ActionButton
      command="promotion.decline"
      description={description}
      onClick={() =>
        onSubmit({ type: "promotion.decline", expectedRevision: action.expectedRevision })
      }
      pending={pending}
      scope={scope}
    />
  );
}

export function PayFineControl({
  action,
  description,
  onSubmit,
  pending,
  scope,
}: ActionControlProps<"audit.pay-fine">) {
  return (
    <ActionButton
      command="audit.pay-fine"
      description={description}
      onClick={() =>
        onSubmit({ type: "audit.pay-fine", expectedRevision: action.expectedRevision })
      }
      pending={pending}
      scope={scope}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* The board — claim, upgrade, place                                          */
/* -------------------------------------------------------------------------- */

/**
 * The brief's own example: "Claim this desk — 400, you have 250". The tile and
 * the cost are both on the summary, the balance is the actor's own, and the
 * control renders disabled with all three stated rather than disappearing.
 */
export function ClaimTileControl({
  action,
  description,
  onSubmit,
  pending,
  scope,
}: ActionControlProps<"tile.claim">) {
  return (
    <ActionButton
      command="tile.claim"
      description={description}
      onClick={() =>
        onSubmit({
          type: "tile.claim",
          expectedRevision: action.expectedRevision,
          tileId: action.tileId,
        })
      }
      pending={pending}
      scope={scope}
    />
  );
}

export function UpgradeTileControl({
  action,
  description,
  onSubmit,
  pending,
  scope,
}: ActionControlProps<"tile.upgrade">) {
  return (
    <ActionButton
      command="tile.upgrade"
      description={description}
      onClick={() =>
        onSubmit({
          type: "tile.upgrade",
          expectedRevision: action.expectedRevision,
          tileId: action.tileId,
        })
      }
      pending={pending}
      scope={scope}
    />
  );
}

/**
 * Kinds are priced individually and the tile comes from context.
 *
 * `PlacePlacementRequest` needs a `tileId` the summary does not carry — it prices
 * the KINDS, not a square — so the tile is the one the actor is standing on. When
 * the host has not supplied it the control is disabled and says so, which is the
 * honest failure: guessing a square would place an object somewhere the player
 * did not choose.
 */
export function PlacementControl({
  action,
  context,
  description,
  onSubmit,
  pending,
  scope,
}: ActionControlProps<"placement.place">) {
  const tileId = context.tileId ?? null;
  const options: readonly ActionOption[] = action.kinds.map((entry) => ({
    value: entry.kind,
    label: humaniseId(entry.kind),
    price: formatActionMoney(entry.cost),
    note: PLACEMENT_EFFECTS[entry.kind],
    disabled: entry.cost > context.spendable.money,
  }));

  return (
    <ActionSheet
      command="placement.place"
      description={description}
      note="Some placements are visible to the table and some only to you. Either way it stays on the tile until somebody lands there."
      onSubmit={(values) => {
        if (tileId === null) return;
        const kind = readText(values, "kind");
        const picked = action.kinds.find((entry) => entry.kind === kind);
        if (picked === undefined) return;
        onSubmit({
          type: "placement.place",
          expectedRevision: action.expectedRevision,
          kind: picked.kind,
          tileId,
        });
      }}
      pending={pending}
      scope={scope}
      submitLabel="Place it"
    >
      <ActionChoiceField
        hint={
          tileId === null
            ? "No tile is known, so nothing can be placed."
            : `Goes on ${labelFor(context.labels?.tiles, tileId)}.`
        }
        label="What to leave"
        name="kind"
        options={options}
      />
    </ActionSheet>
  );
}
