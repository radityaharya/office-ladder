import { useReducedMotion } from "motion/react";
import * as m from "motion/react-m";

import type { LegalActionSummary } from "@office-ladder/contracts";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GAMEPLAY_SPRING, REDUCED_MOTION_TRANSITION } from "@/lib/motion";
import { cn } from "@/lib/utils";

import {
  formatMoney,
  promptCaseRef,
  resolvePrimaryOptionId,
  resolvePromptCopy,
  type PromptTone,
} from "./prompt-copy";

export type PromptAction = Extract<
  LegalActionSummary,
  { readonly type: "prompt.respond" }
>;

type PromptDialogProps = {
  readonly action: PromptAction | null;
  readonly error: string | null;
  readonly isResponding: boolean;
  /** The local player's committed money, or null when the projection omits it. */
  readonly money: number | null;
  readonly seat: number | null;
  readonly onRespond: (optionId: string) => void;
};

/**
 * The game's interrupting decision notice — and, after the card overlay was
 * retired, the **only** thing in this app allowed to cover the board. That is
 * the whole rule: a modal is justified exactly when the game cannot proceed
 * without this player's input, which is true here and nowhere else. It is
 * deliberately non-dismissable: escape and outside presses are both refused
 * while a response is pending, because the engine keeps the prompt open until it
 * accepts one.
 *
 * Motion: the notice body rises into place over `reveal` with
 * `GAMEPLAY_SPRING.surface` (DESIGN.md §7.2 lists a prompt entering alongside a
 * card). The frame's own opacity crossfade stays where it was, in
 * `.overlay-dialog`; that sheet drops the frame's translate for this popup so
 * exactly one mechanism moves the notice. Exit is Base UI's — the popup is
 * unmounted by the primitive, so `AnimatePresence` cannot own it here.
 */
export function PromptDialog({
  action,
  error,
  isResponding,
  money,
  seat,
  onRespond,
}: PromptDialogProps) {
  const reduceMotion = useReducedMotion() === true;
  const copy =
    action === null
      ? null
      : resolvePromptCopy({ kind: action.kind, optionIds: action.options, money });
  /*
   * A modal that refuses escape, refuses an outside press, hides its close
   * button AND offers no response contains no focusable control at all: a
   * keyboard user would be trapped in it with nothing to act on (§8). The
   * engine only ever opens a prompt with responses, so a zero-option prompt
   * means a stale or unrecognised projection — the honest presentation is the
   * board (which keeps polling, and whose floor plate already reads "Decision
   * required"), not an unanswerable dialog.
   */
  const open = action !== null && copy !== null && copy.options.length > 0;
  const primaryOptionId = copy === null ? null : resolvePrimaryOptionId(copy);
  // Primary action renders last so it lands rightmost on wide viewports and
  // bottom-most when the actions stack.
  const orderedActions =
    copy === null
      ? []
      : [...copy.options].sort(
          (left, right) =>
            Number(left.optionId === primaryOptionId) -
            Number(right.optionId === primaryOptionId),
        );

  return (
    <Dialog
      disablePointerDismissal
      onOpenChange={(nextOpen, eventDetails) => {
        if (!nextOpen && open) eventDetails.cancel();
      }}
      open={open}
    >
      {open && action !== null && copy !== null ? (
        <DialogContent
          aria-busy={isResponding}
          className="sm:max-w-lg"
          data-decision-point-id={action.decisionPointId}
          data-prompt-kind={action.kind}
          showCloseButton={false}
        >
          <m.div
            animate={{ y: 0 }}
            className="overlay-notice-reveal"
            initial={{ y: 6 }}
            transition={reduceMotion ? REDUCED_MOTION_TRANSITION : GAMEPLAY_SPRING.surface}
          >
            <DialogHeader className="overlay-notice-head">
              <p className="overlay-notice-kicker">
                <span aria-hidden="true" className={toneLedClass(copy.tone)} />
                {copy.kicker}
              </p>
              <DialogTitle className="text-2xl leading-[1.2] tracking-[-0.01em]">
                {copy.title}
              </DialogTitle>
              <DialogDescription>{copy.summary}</DialogDescription>
            </DialogHeader>

            <dl className="overlay-notice-meta">
              <div className="overlay-notice-meta-cell">
                <dt className="overlay-notice-meta-label">Case</dt>
                <dd className="overlay-notice-meta-value">
                  {promptCaseRef(action.decisionPointId)}
                </dd>
              </div>
              {seat === null ? null : (
                <div className="overlay-notice-meta-cell">
                  <dt className="overlay-notice-meta-label">Seat</dt>
                  <dd className="overlay-notice-meta-value">{seat}</dd>
                </div>
              )}
              <div className="overlay-notice-meta-cell">
                <dt className="overlay-notice-meta-label">On hand</dt>
                <dd className="overlay-notice-meta-value" data-slot="prompt-money">
                  {money === null ? "Unavailable" : formatMoney(money)}
                </dd>
              </div>
            </dl>

            {/* `open` already guarantees at least one response, so there is no
                empty-table branch to render here. */}
            <table className="overlay-notice-table">
              <caption className="sr-only">
                Legal responses, what each one costs, and what happens if it fails
              </caption>
              <thead>
                <tr>
                  <th scope="col">Response</th>
                  <th scope="col">Cost</th>
                </tr>
              </thead>
              <tbody>
                {copy.options.map((option) => (
                  <tr data-option-id={option.optionId} key={option.optionId}>
                    <th scope="row">
                      <span className="overlay-notice-option-label">{option.label}</span>
                      <span className="overlay-notice-option-outcome">{option.outcome}</span>
                      {option.note === null ? null : (
                        <span className="overlay-notice-option-note">{option.note}</span>
                      )}
                      {option.disabledReason === null ? null : (
                        <span className="overlay-notice-option-note">
                          Unavailable — {option.disabledReason}
                        </span>
                      )}
                    </th>
                    <td className="overlay-notice-cost">{option.cost}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {error === null ? null : (
              <p className="status-message status-message-error" role="alert">
                {error}
              </p>
            )}

            <p className="overlay-notice-status" role="status">
              {/* Idle reads as an unlit LED; in-flight reuses the notice's own
                  status token so the view never carries two status colours. */}
              <span
                aria-hidden="true"
                className={isResponding ? toneLedClass(copy.tone) : "overlay-led"}
              />
              {isResponding
                ? "Filing response with the server."
                : "Turn paused. This notice stays open until the server accepts a response."}
            </p>

            <div className="overlay-notice-actions">
              {orderedActions.map((option) => (
                <button
                  className={cn(
                    "overlay-action",
                    option.optionId === primaryOptionId && "overlay-action-primary",
                  )}
                  data-option-id={option.optionId}
                  disabled={isResponding || option.disabledReason !== null}
                  key={option.optionId}
                  onClick={() => onRespond(option.optionId)}
                  type="button"
                >
                  <span>{option.label}</span>
                  <span className="overlay-action-cost">{option.cost}</span>
                </button>
              ))}
            </div>
          </m.div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

/** §6.4 status light: a 6px square in a status token, always beside a label. */
function toneLedClass(tone: PromptTone): string {
  return tone === "caution"
    ? "overlay-led overlay-led-caution"
    : "overlay-led overlay-led-info";
}
