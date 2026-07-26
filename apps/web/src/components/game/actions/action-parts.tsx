/**
 * The control grammar all twenty-seven controls are assembled from.
 *
 * Twenty-seven commands is not twenty-seven layouts. There are exactly two
 * shapes here and every control is one of them:
 *
 * - {@link ActionButton} — a command that needs no input. One press, one draft.
 * - {@link ActionSheet} — a command that needs a target or an amount. The brief's
 *   rule is that "`attack.target` choosing its own victim is not a game", so
 *   anything with a choice gets a real picker rather than a button that guesses.
 *
 * ## Why the picker is a native popover and not a modal
 *
 * §12.3 bans modals for *anything the game raises at you*. A picker is the
 * opposite — the player opened it — but it still must not move the board, and the
 * rail and the command lane both clip their overflow. A top-layer `popover`
 * solves both at once: it is out of flow (so nothing reflows), it is not clipped
 * by an `overflow: hidden` ancestor, it light-dismisses, and it needs no JS, no
 * positioning library and no focus trap. It also means a control's RESTING state
 * is its whole first render, which is the only state `renderToStaticMarkup` can
 * see.
 *
 * ## The disabled-with-a-reason rule, implemented once
 *
 * `ActionDescription.blocked` non-null ⇒ the control renders **disabled with the
 * reason beside it** and `aria-describedby` wired to that sentence. A control is
 * never *absent* because it is unaffordable — "Claim desk 14 · $400 · Costs $400,
 * you hold $250." teaches the economy, and a missing button teaches nothing. The
 * complementary half of that rule lives in `ActionControls`: an action that is
 * not in the legal list at all is not rendered at all, because a disabled button
 * for a rule that does not exist invents one.
 */
import { useState, type FormEvent, type ReactNode } from "react";

import type { LegalActionSummaryType } from "@office-ladder/contracts";

import { cn } from "@/lib/utils";

import {
  actionDomId,
  type ActionDescription,
  type ActionEmphasis,
} from "./action-model";

/* -------------------------------------------------------------------------- */
/* Buttons                                                                    */
/* -------------------------------------------------------------------------- */

type ActionButtonProps = {
  readonly command: LegalActionSummaryType;
  readonly description: ActionDescription;
  readonly onClick: () => void;
  readonly emphasis?: ActionEmphasis;
  readonly pending?: boolean;
  readonly scope?: string;
  /** Overrides `description.label` — a per-option button inside a group. */
  readonly label?: string;
  /** Overrides `description.price`. Pass `null` to print no price. */
  readonly price?: string | null;
  /** Distinguishes several buttons for one command in the markup. */
  readonly slotSuffix?: string;
};

export function ActionButton({
  command,
  description,
  onClick,
  emphasis = "secondary",
  pending = false,
  scope = "turn",
  label,
  price,
  slotSuffix = "",
}: ActionButtonProps) {
  const blocked = description.blocked;
  const reasonId = actionDomId(`reason${slotSuffix}`, command, scope);
  const shownPrice = price === undefined ? description.price : price;

  return (
    <span
      className="actions-control"
      data-blocked={blocked === null ? "false" : "true"}
      data-slot={`action-${command}${slotSuffix}`}
    >
      <button
        aria-busy={pending || undefined}
        aria-describedby={blocked === null ? undefined : reasonId}
        className="actions-btn"
        data-slot={`action-btn-${command}${slotSuffix}`}
        data-variant={emphasis}
        disabled={blocked !== null || pending}
        onClick={onClick}
        title={description.detail}
        type="button"
      >
        <span className="actions-btn-label">{label ?? description.label}</span>
        {shownPrice === null ? null : (
          <span className="actions-price">{shownPrice}</span>
        )}
      </button>
      {blocked === null ? null : (
        <span className="actions-reason" data-slot={`action-reason-${command}${slotSuffix}`} id={reasonId}>
          {blocked}
        </span>
      )}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Sheets — the picker                                                        */
/* -------------------------------------------------------------------------- */

type ActionSheetProps = {
  readonly command: LegalActionSummaryType;
  readonly description: ActionDescription;
  readonly children: ReactNode;
  readonly onSubmit: (values: FormData) => void;
  readonly emphasis?: ActionEmphasis;
  readonly pending?: boolean;
  readonly scope?: string;
  /** Command voice for the commit button, e.g. "Commit", "Cast", "Send offer". */
  readonly submitLabel: string;
  /** A rule the player should read before committing. Always rendered. */
  readonly note?: ReactNode;
  /**
   * Cross-field rules a single input cannot express — "money and work together
   * must reach 1", "an offer needs something on one side".
   *
   * Returning a message REFUSES the submit and keeps the sheet open with the
   * message shown. The alternative designs are both worse: silently topping the
   * amount up changes what the player asked for, and submitting anyway trades a
   * local refusal the player can fix for a server rejection they cannot.
   */
  readonly validate?: (values: FormData) => string | null;
};

/**
 * A trigger, and the fields behind it.
 *
 * The form is uncontrolled and read once on submit (see
 * `action-model.ts`'s `read*` helpers), so nothing here holds state that could
 * survive a revision it no longer matches. Submitting closes the sheet.
 */
export function ActionSheet({
  command,
  description,
  children,
  onSubmit,
  emphasis = "secondary",
  pending = false,
  scope = "turn",
  submitLabel,
  note,
  validate,
}: ActionSheetProps) {
  const [refusal, setRefusal] = useState<string | null>(null);
  const blocked = description.blocked;
  const sheetId = actionDomId("sheet", command, scope);
  const headingId = actionDomId("sheet-heading", command, scope);
  const reasonId = actionDomId("reason", command, scope);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const message = validate?.(values) ?? null;
    setRefusal(message);
    if (message !== null) return;
    onSubmit(values);
    // Closing here rather than with `popovertargetaction="hide"` on the submit
    // button: a button that both submits and toggles a popover has two activation
    // behaviours, and only one of them is guaranteed to run first.
    const sheet = form.closest<HTMLElement>("[popover]");
    if (sheet !== null && typeof sheet.hidePopover === "function") sheet.hidePopover();
  }

  return (
    <span
      className="actions-control"
      data-blocked={blocked === null ? "false" : "true"}
      data-slot={`action-${command}`}
    >
      <button
        aria-busy={pending || undefined}
        aria-describedby={blocked === null ? undefined : reasonId}
        className="actions-btn"
        data-slot={`action-btn-${command}`}
        data-variant={emphasis}
        disabled={blocked !== null || pending}
        popoverTarget={sheetId}
        title={description.detail}
        type="button"
      >
        <span className="actions-btn-label">{description.label}</span>
        {description.price === null ? null : (
          <span className="actions-price">{description.price}</span>
        )}
        <span aria-hidden="true" className="actions-btn-more">
          …
        </span>
      </button>
      {blocked === null ? null : (
        <span className="actions-reason" data-slot={`action-reason-${command}`} id={reasonId}>
          {blocked}
        </span>
      )}
      <div
        aria-labelledby={headingId}
        className="actions-sheet"
        data-slot={`action-sheet-${command}`}
        id={sheetId}
        popover="auto"
      >
        <header className="actions-sheet-head">
          <h3 className="actions-sheet-title" id={headingId}>
            {description.label}
          </h3>
          {description.price === null ? null : (
            <span className="actions-price">{description.price}</span>
          )}
        </header>
        <p className="actions-sheet-detail">{description.detail}</p>
        <form className="actions-sheet-form" onSubmit={handleSubmit}>
          {children}
          {/* A permanently reserved lane. A refusal appearing must not resize the
              sheet — the same anti-reflow rule the shell applies to the attention
              band, one layer in. */}
          <p
            className="actions-sheet-refusal"
            data-occupied={refusal === null ? "false" : "true"}
            data-slot={`action-refusal-${command}`}
            role={refusal === null ? undefined : "alert"}
          >
            {refusal ?? ""}
          </p>
          <div className="actions-sheet-foot">
            <button
              className="actions-btn"
              data-slot={`action-commit-${command}`}
              data-variant="primary"
              disabled={pending}
              type="submit"
            >
              <span className="actions-btn-label">{submitLabel}</span>
            </button>
            <button
              className="actions-btn"
              data-slot={`action-cancel-${command}`}
              data-variant="ghost"
              popoverTarget={sheetId}
              popoverTargetAction="hide"
              type="button"
            >
              <span className="actions-btn-label">Cancel</span>
            </button>
          </div>
        </form>
        {note === undefined ? null : (
          <p className="actions-sheet-note" data-slot={`action-note-${command}`}>
            <span aria-hidden="true" className="actions-led" data-tone="idle" />
            <span>{note}</span>
          </p>
        )}
      </div>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Fields                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A number a player types, with its ceiling stated in words next to it.
 *
 * `max` is on the input AND re-clamped on read: a keyboard can step a number
 * input past its own `max`, and submitting a value the server's parser refuses
 * would show a refusal for something the control said was legal.
 */
export function ActionAmountField({
  defaultValue,
  hint,
  label,
  max,
  min = 0,
  name,
  disabled = false,
}: {
  readonly name: string;
  readonly label: string;
  readonly max: number;
  readonly min?: number;
  readonly defaultValue?: number;
  readonly hint?: string;
  readonly disabled?: boolean;
}) {
  return (
    <label className="actions-field" data-slot={`action-field-${name}`}>
      <span className="actions-label">{label}</span>
      <input
        className="actions-input"
        defaultValue={defaultValue ?? min}
        disabled={disabled}
        inputMode="numeric"
        max={max}
        min={min}
        name={name}
        step={1}
        type="number"
      />
      {hint === undefined ? null : <span className="actions-hint">{hint}</span>}
    </label>
  );
}

export function ActionTextField({
  label,
  maxLength,
  name,
  hint,
}: {
  readonly name: string;
  readonly label: string;
  readonly maxLength: number;
  readonly hint?: string;
}) {
  return (
    <label className="actions-field" data-slot={`action-field-${name}`}>
      <span className="actions-label">{label}</span>
      <input
        className="actions-input"
        maxLength={maxLength}
        name={name}
        type="text"
      />
      {hint === undefined ? null : <span className="actions-hint">{hint}</span>}
    </label>
  );
}

export type ActionOption = {
  readonly value: string;
  readonly label: string;
  /** A price, a level, an amount outstanding. Mono, right-aligned. */
  readonly price?: string | null;
  /** One line under the label — what this option does. */
  readonly note?: string;
  /** Seat 1..6 when the option is a player, so identity is colour + number (§8). */
  readonly seat?: number | null;
  readonly disabled?: boolean;
};

/**
 * A radio (or checkbox) list, never a bare `<select>`.
 *
 * A select cannot show a per-option price, and every picker in this layer has
 * one: which project, which tile, which loan, which victim — each carries a
 * number the player is choosing between. A list of rows can state it; a dropdown
 * of strings cannot.
 */
export function ActionChoiceField({
  label,
  multiple = false,
  name,
  options,
  defaultValue,
  hint,
}: {
  readonly name: string;
  readonly label: string;
  readonly options: readonly ActionOption[];
  readonly multiple?: boolean;
  readonly defaultValue?: string;
  readonly hint?: string;
}) {
  const selected = defaultValue ?? options.find((option) => option.disabled !== true)?.value;

  return (
    <fieldset className="actions-field" data-slot={`action-field-${name}`}>
      <legend className="actions-label">{label}</legend>
      <div className="actions-choice">
        {options.map((option) => (
          <label
            className={cn("actions-choice-row", option.seat == null ? null : `actions-seat-${option.seat}`)}
            data-slot={`action-option-${name}`}
            key={option.value}
          >
            <input
              defaultChecked={multiple ? false : option.value === selected}
              disabled={option.disabled}
              name={name}
              type={multiple ? "checkbox" : "radio"}
              value={option.value}
            />
            {option.seat == null ? null : (
              <>
                <span aria-hidden="true" className="actions-seat">
                  {option.seat}
                </span>
                <span className="sr-only">Seat {option.seat}.</span>
              </>
            )}
            <span className="actions-choice-label">{option.label}</span>
            {option.price === undefined || option.price === null ? null : (
              <span className="actions-price">{option.price}</span>
            )}
            {option.note === undefined ? null : (
              <span className="actions-choice-note">{option.note}</span>
            )}
          </label>
        ))}
      </div>
      {hint === undefined ? null : <span className="actions-hint">{hint}</span>}
    </fieldset>
  );
}

export function ActionCheckField({
  defaultChecked = false,
  hint,
  label,
  name,
}: {
  readonly name: string;
  readonly label: string;
  readonly defaultChecked?: boolean;
  readonly hint?: string;
}) {
  return (
    <label className="actions-check" data-slot={`action-field-${name}`}>
      <input defaultChecked={defaultChecked} name={name} type="checkbox" />
      <span className="actions-choice-label">{label}</span>
      {hint === undefined ? null : <span className="actions-hint">{hint}</span>}
    </label>
  );
}

/**
 * A run of one-press options for a single command — prompt options, vote options,
 * pip steps, free actions.
 *
 * Each option is its own button because each is its own complete command: a radio
 * plus a commit button would be two interactions for a decision the player has
 * already made, and these are the cases where the whole choice fits on screen.
 */
export function ActionOptionRow({
  command,
  description,
  onChoose,
  options,
  pending = false,
  scope = "turn",
}: {
  readonly command: LegalActionSummaryType;
  readonly description: ActionDescription;
  readonly options: readonly ActionOption[];
  readonly onChoose: (value: string) => void;
  readonly pending?: boolean;
  readonly scope?: string;
}) {
  const blocked = description.blocked;
  const reasonId = actionDomId("reason", command, scope);

  return (
    <span
      className="actions-control"
      data-blocked={blocked === null ? "false" : "true"}
      data-slot={`action-${command}`}
    >
      <span className="actions-control-label" data-slot={`action-label-${command}`}>
        {description.label}
      </span>
      {options.map((option) => (
        <button
          aria-busy={pending || undefined}
          aria-describedby={blocked === null ? undefined : reasonId}
          className="actions-btn"
          data-slot={`action-option-btn-${command}`}
          data-variant="secondary"
          disabled={blocked !== null || pending || option.disabled === true}
          key={option.value}
          onClick={() => onChoose(option.value)}
          title={option.note ?? description.detail}
          type="button"
        >
          <span className="actions-btn-label">{option.label}</span>
          {option.price === undefined || option.price === null ? null : (
            <span className="actions-price">{option.price}</span>
          )}
        </button>
      ))}
      {blocked === null ? null : (
        <span className="actions-reason" data-slot={`action-reason-${command}`} id={reasonId}>
          {blocked}
        </span>
      )}
    </span>
  );
}
