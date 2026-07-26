/**
 * The decision surface: an open decision addressed to you, on a clock.
 *
 * §12.2 tier 1 — "whose turn it is, the clock, your own resources and any open
 * decision addressed to you NEVER go behind a tab". These four controls are that
 * last clause. They are also the ones with a deadline, which is why the *timer*
 * is not drawn here: §12.3 puts time pressure in a depleting bar or ring owned by
 * the attention band, and a second clock beside it would be two sources of truth
 * for one deadline.
 *
 * Two properties these controls hold that the others do not:
 *
 * 1. **A window that closes does not silently drop the choice.** `reaction.pass`
 *    is rendered next to `reaction.play` at all times, because "did nothing" and
 *    "declined" are different states and only one of them is a move the player
 *    made.
 * 2. **They say nothing about who else is in the window.** A promotion-block
 *    offer is addressed to every seat but the promotee precisely so it does not
 *    identify the role-holder, and the summary has no field for a tally, so
 *    neither does the control.
 */
import { labelFor, readText, type ActionControlProps } from "./action-model";
import {
  ActionButton,
  ActionChoiceField,
  ActionOptionRow,
  ActionSheet,
  type ActionOption,
} from "./action-parts";

/**
 * Every option the server enumerated, as its own button.
 *
 * One press per option rather than select-then-confirm: the prompt IS the
 * decision, and an extra commit step on a decision with a deadline is a way to
 * time out while agreeing. Options are labelled through `labels.prompts` when the
 * host has copy for them and humanised otherwise, so an unauthored prompt kind
 * still renders something a player can act on.
 */
export function PromptControl({
  action,
  context,
  description,
  onSubmit,
  pending,
  scope,
}: ActionControlProps<"prompt.respond">) {
  const options: readonly ActionOption[] = action.options.map((optionId) => ({
    value: optionId,
    label: labelFor(context.labels?.prompts, optionId),
  }));

  return (
    <ActionOptionRow
      command="prompt.respond"
      description={description}
      onChoose={(optionId) =>
        onSubmit({
          type: "prompt.respond",
          expectedRevision: action.expectedRevision,
          decisionPointId: action.decisionPointId,
          optionId,
        })
      }
      options={options}
      pending={pending}
      scope={scope}
    />
  );
}

/**
 * A reaction is played *with* something — a card or an ability, exactly one.
 *
 * The parser refuses both-at-once and neither-at-all, so the picker is one radio
 * list over both kinds with the kind encoded in the value. That is deliberately a
 * single list rather than two: the player is choosing what to spend, and splitting
 * it into "card" and "ability" groups would let them fill in both.
 *
 * Card ids are opaque here by design — the summary carries instance ids and no
 * definition, name or owner, so a list of them cannot describe a hand. The
 * host resolves its own ids to names through `labels.cards`; a missing label
 * degrades to a readable stand-in rather than leaking a definition id.
 */
export function ReactionPlayControl({
  action,
  context,
  description,
  onSubmit,
  pending,
  scope,
}: ActionControlProps<"reaction.play">) {
  const options: readonly ActionOption[] = [
    ...action.cardIds.map((cardId) => ({
      value: `card:${cardId}`,
      label: labelFor(context.labels?.cards, cardId),
      note: "From your hand.",
    })),
    ...action.abilityIds.map((abilityId) => ({
      value: `ability:${abilityId}`,
      label: labelFor(context.labels?.abilities, abilityId),
      note: "Your character's own ability.",
    })),
  ];

  return (
    <ActionSheet
      command="reaction.play"
      description={description}
      note="The window closes on its own deadline. Playing nothing is not the same as passing."
      onSubmit={(values) => {
        const picked = readText(values, "reaction");
        const [kind, ...rest] = picked.split(":");
        const id = rest.join(":");
        if (id.length === 0) return;
        onSubmit({
          type: "reaction.play",
          expectedRevision: action.expectedRevision,
          decisionPointId: action.decisionPointId,
          cardId: kind === "card" ? id : null,
          abilityId: kind === "ability" ? id : null,
          targetPlayerIds: [],
          choice: null,
        });
      }}
      pending={pending}
      scope={scope}
      submitLabel="Play it"
    >
      <ActionChoiceField label="What to play" name="reaction" options={options} />
    </ActionSheet>
  );
}

export function ReactionPassControl({
  action,
  description,
  onSubmit,
  pending,
  scope,
}: ActionControlProps<"reaction.pass">) {
  return (
    <ActionButton
      command="reaction.pass"
      description={description}
      onClick={() =>
        onSubmit({
          type: "reaction.pass",
          expectedRevision: action.expectedRevision,
          decisionPointId: action.decisionPointId,
        })
      }
      pending={pending}
      scope={scope}
    />
  );
}

/**
 * Critical emphasis, because it takes something away from another player.
 *
 * Named in full ("Block the promotion") rather than "Confirm" — §6.1 requires a
 * destructive control to state what it destroys in its own label.
 */
export function BlockPromotionControl({
  action,
  description,
  onSubmit,
  pending,
  scope,
}: ActionControlProps<"management.block-promotion">) {
  return (
    <ActionButton
      command="management.block-promotion"
      description={description}
      emphasis="critical"
      onClick={() =>
        onSubmit({
          type: "management.block-promotion",
          expectedRevision: action.expectedRevision,
          decisionPointId: action.decisionPointId,
        })
      }
      pending={pending}
      scope={scope}
    />
  );
}
