/**
 * The rail surface: a control beside the state it acts on.
 *
 * §12.2 tier 2. These are the actions whose *object* lives in a panel — you
 * contribute to a project you are reading, you cast in a ballot you are reading,
 * you answer an offer whose clauses are on screen. Hoisting them into the command
 * lane would put the button a whole panel away from the number it spends, which is
 * how a twelve-destination interface stops being followable.
 *
 * Each control is mounted by `ActionControls surface="rail" panelId="…"`, and
 * `action-registry.ts` owns which panel each one belongs to. Nothing here decides
 * its own placement — that is a registry entry, so moving a control between panels
 * is a one-line change rather than a component rewrite.
 */
import {
  MAX_IMMUNITY_ROUNDS,
  MAX_MONEY_AMOUNT,
  MAX_ROUND_NUMBER,
  type TradeItem,
  type TradeItemKind,
} from "@office-ladder/contracts";

import {
  clampAmount,
  formatActionMoney,
  humaniseId,
  labelFor,
  nameFor,
  readAll,
  readAmount,
  readFlag,
  readText,
  seatFor,
  type ActionControlProps,
} from "./action-model";
import {
  ActionAmountField,
  ActionButton,
  ActionCheckField,
  ActionChoiceField,
  ActionOptionRow,
  ActionSheet,
  ActionTextField,
  type ActionOption,
} from "./action-parts";
import { formatPanelNumber, pluralise } from "../panels/panel-format";

/* -------------------------------------------------------------------------- */
/* Hand                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Card ids stay opaque.
 *
 * The summary carries instance ids and nothing else — no definition id, no name
 * key, no owner — so a list of them cannot describe a hand even if it leaked. The
 * host resolves its OWN ids to names through `labels.cards`, which it can do
 * because `CallerSelfProjection.hand` is already actor-only.
 */
export function PlayCardControl({
  action,
  context,
  description,
  onSubmit,
  pending,
  scope,
}: ActionControlProps<"turn.play-card">) {
  const options: readonly ActionOption[] = action.cardIds.map((cardId) => ({
    value: cardId,
    label: labelFor(context.labels?.cards, cardId),
  }));
  const targets: readonly ActionOption[] = context.seats.map((seat) => ({
    value: seat.playerId,
    label: seat.name,
    seat: seat.seat,
  }));

  return (
    <ActionSheet
      command="turn.play-card"
      description={description}
      note="A card that needs a target will refuse without one. A card that does not will ignore anyone you pick."
      onSubmit={(values) =>
        onSubmit({
          type: "turn.play-card",
          expectedRevision: action.expectedRevision,
          cardId: readText(values, "cardId"),
          targetPlayerIds: readAll(values, "targetPlayerIds"),
          choice: null,
        })
      }
      pending={pending}
      scope={scope}
      submitLabel="Play"
      validate={(values) =>
        readText(values, "cardId").length === 0 ? "Pick a card to play." : null
      }
    >
      <ActionChoiceField label="Card" name="cardId" options={options} />
      {targets.length === 0 ? null : (
        <ActionChoiceField
          hint="Only if the card asks for one."
          label="Aimed at"
          multiple
          name="targetPlayerIds"
          options={targets}
        />
      )}
    </ActionSheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Projects                                                                   */
/* -------------------------------------------------------------------------- */

export function StartProjectControl({
  action,
  context,
  description,
  onSubmit,
  pending,
  scope,
}: ActionControlProps<"project.start">) {
  const options: readonly ActionOption[] = action.definitionIds.map((definitionId) => ({
    value: definitionId,
    label: labelFor(context.labels?.projectBriefs, definitionId),
  }));

  return (
    <ActionSheet
      command="project.start"
      description={description}
      note="An open project lets anyone fund it for a share of the payout. A closed one keeps the payout yours and the cost yours too."
      onSubmit={(values) =>
        onSubmit({
          type: "project.start",
          expectedRevision: action.expectedRevision,
          definitionId: readText(values, "definitionId"),
          // The summary carries no tile for a project, so none is claimed. A
          // tile-bound project needs the enumeration to name the square first.
          tileId: null,
          openToJoin: readFlag(values, "openToJoin"),
        })
      }
      pending={pending}
      scope={scope}
      submitLabel="Start it"
      validate={(values) =>
        readText(values, "definitionId").length === 0 ? "Pick a brief to open." : null
      }
    >
      <ActionChoiceField label="Brief" name="definitionId" options={options} />
      <ActionCheckField
        defaultChecked
        hint="Contributors share the payout pro rata; you keep the lead's bonus."
        label="Open for anyone to fund"
        name="openToJoin"
      />
    </ActionSheet>
  );
}

/**
 * Money and work are separate fields because they are separate resources with
 * separate ceilings — `maxMoney` is cash, `maxWork` is the work counter — and the
 * parser's rule is that either may be zero but not both. That cross-field rule
 * cannot live on an input, so it is the sheet's `validate`.
 */
export function ContributeControl({
  action,
  context,
  description,
  onSubmit,
  pending,
  scope,
}: ActionControlProps<"project.contribute">) {
  const options: readonly ActionOption[] = action.projectIds.map((projectId) => ({
    value: projectId,
    label: labelFor(context.labels?.projects, projectId),
  }));

  return (
    <ActionSheet
      command="project.contribute"
      description={description}
      note="Contributors share a completed project's payout pro rata. A failed project pays nobody."
      onSubmit={(values) =>
        onSubmit({
          type: "project.contribute",
          expectedRevision: action.expectedRevision,
          projectId: readText(values, "projectId"),
          money: readAmount(values, "money", 0, action.maxMoney),
          work: readAmount(values, "work", 0, action.maxWork),
        })
      }
      pending={pending}
      scope={scope}
      submitLabel="Commit"
      validate={(values) => {
        if (readText(values, "projectId").length === 0) return "Pick a project.";
        const total =
          readAmount(values, "money", 0, action.maxMoney) +
          readAmount(values, "work", 0, action.maxWork);

        return total < action.minTotal
          ? `Money and work together must reach ${formatPanelNumber(action.minTotal)}.`
          : null;
      }}
    >
      <ActionChoiceField label="Project" name="projectId" options={options} />
      <ActionAmountField
        hint={`You hold ${formatActionMoney(context.spendable.money)}.`}
        label="Money"
        max={action.maxMoney}
        name="money"
      />
      <ActionAmountField
        hint={`You hold ${pluralise(action.maxWork, "work", "work")}.`}
        label="Work"
        max={action.maxWork}
        name="work"
      />
    </ActionSheet>
  );
}

/**
 * The hidden checkbox is the mechanic, so it is a field and not a default.
 *
 * Spec §5.2 keeps hidden sabotage secret until the project resolves, which means
 * the choice between hidden and open is the player's real decision here — pricing
 * the heat and then choosing for them would remove it.
 */
export function SabotageControl({
  action,
  context,
  description,
  onSubmit,
  pending,
  scope,
}: ActionControlProps<"project.sabotage">) {
  const options: readonly ActionOption[] = action.projectIds.map((projectId) => ({
    value: projectId,
    label: labelFor(context.labels?.projects, projectId),
  }));

  return (
    <ActionSheet
      command="project.sabotage"
      description={description}
      note={
        action.heatCost === 0
          ? "This mode does not track heat, so nothing here raises suspicion."
          : `Every sabotage adds ${formatPanelNumber(action.heatCost)} heat to you whether or not it is hidden.`
      }
      onSubmit={(values) =>
        onSubmit({
          type: "project.sabotage",
          expectedRevision: action.expectedRevision,
          projectId: readText(values, "projectId"),
          amount: readAmount(values, "amount", 1, Math.max(1, action.maxAmount), 1),
          hidden: readFlag(values, "hidden"),
        })
      }
      pending={pending}
      scope={scope}
      submitLabel="Sabotage"
      validate={(values) =>
        readText(values, "projectId").length === 0 ? "Pick a project." : null
      }
    >
      <ActionChoiceField label="Project" name="projectId" options={options} />
      <ActionAmountField
        defaultValue={Math.min(1, action.maxAmount)}
        hint={`You hold ${pluralise(context.spendable.work, "work", "work")}.`}
        label="Work spent"
        max={action.maxAmount}
        min={1}
        name="amount"
      />
      <ActionCheckField
        defaultChecked
        hint="Hidden sabotage is revealed only when the project resolves."
        label="Keep it hidden"
        name="hidden"
      />
    </ActionSheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Conflict                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A victim picker, because "`attack.target` choosing its own victim is not a
 * game".
 *
 * The summary names eligible SEATS (public already) and the vectors, and prices
 * the heat it costs the *actor* — never anything about the target's balances. So
 * the control offers a choice of person and a choice of method, states what it
 * costs you, and knows nothing about what it will cost them.
 */
export function AttackControl({
  action,
  context,
  description,
  onSubmit,
  pending,
  scope,
}: ActionControlProps<"attack.target">) {
  const targets: readonly ActionOption[] = action.targetPlayerIds.map((playerId) => ({
    value: playerId,
    label: nameFor(context, playerId),
    seat: seatFor(context, playerId)?.seat ?? null,
  }));
  const vectors: readonly ActionOption[] = action.vectors.map((vector) => ({
    value: vector,
    label: labelFor(context.labels?.vectors, vector),
  }));

  return (
    <ActionSheet
      command="attack.target"
      description={description}
      emphasis="critical"
      note={
        action.heatCost === 0
          ? "This mode does not track heat."
          : `Heat is yours, not theirs: this adds ${formatPanelNumber(action.heatCost)} to your own suspicion.`
      }
      onSubmit={(values) =>
        onSubmit({
          type: "attack.target",
          expectedRevision: action.expectedRevision,
          targetPlayerId: readText(values, "targetPlayerId"),
          vector: readText(values, "vector"),
          // No card is spent from here. A card-driven attack is `turn.play-card`
          // with a target, and conflating the two would let this control spend a
          // card the summary never advertised.
          cardId: null,
        })
      }
      pending={pending}
      scope={scope}
      submitLabel="Do it"
      validate={(values) => {
        if (readText(values, "targetPlayerId").length === 0) return "Pick who.";

        return readText(values, "vector").length === 0 ? "Pick how." : null;
      }}
    >
      <ActionChoiceField label="Who" name="targetPlayerId" options={targets} />
      <ActionChoiceField label="How" name="vector" options={vectors} />
    </ActionSheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Agreements                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A trade composer over the item kinds that need no inventory picker.
 *
 * `itemKinds` says what this mode allows; this control implements `money`,
 * `promise` and `immunity`, which are the three whose value a player can state
 * from nothing. `card`, `token` and `tile` items need ids the summary does not
 * carry — offering a "pick a card" list built from a guess would be inventing an
 * inventory, so those clauses are deliberately not offerable yet.
 */
export function OfferAgreementControl({
  action,
  context,
  description,
  onSubmit,
  pending,
  scope,
}: ActionControlProps<"agreement.offer">) {
  const recipients: readonly ActionOption[] = action.recipientIds.map((playerId) => ({
    value: playerId,
    label: nameFor(context, playerId),
    seat: seatFor(context, playerId)?.seat ?? null,
  }));
  const allows = (kind: TradeItemKind): boolean => action.itemKinds.includes(kind);
  const round = context.round ?? 1;
  const defaultExpiry = clampAmount(round + 2, 1, MAX_ROUND_NUMBER);

  function sideItems(values: FormData, side: "give" | "receive"): readonly TradeItem[] {
    const items: TradeItem[] = [];
    const money = readAmount(values, `${side}Money`, 0, MAX_MONEY_AMOUNT);
    if (money > 0) items.push({ kind: "money", amount: money });
    if (allows("immunity")) {
      const rounds = readAmount(values, `${side}Immunity`, 0, MAX_IMMUNITY_ROUNDS);
      if (rounds > 0) items.push({ kind: "immunity", rounds });
    }
    if (side === "give" && allows("promise")) {
      const text = readText(values, "promise");
      if (text.length > 0) items.push({ kind: "promise", text });
    }

    return items;
  }

  return (
    <ActionSheet
      command="agreement.offer"
      description={description}
      note="Cards, tokens and tiles cannot be offered from here yet — those clauses need an inventory picker this terminal does not have."
      onSubmit={(values) =>
        onSubmit({
          type: "agreement.offer",
          expectedRevision: action.expectedRevision,
          recipientIds: readAll(values, "recipientIds").slice(0, action.maxRecipients),
          give: sideItems(values, "give"),
          receive: sideItems(values, "receive"),
          expiresAtRound: readAmount(values, "expiresAtRound", 1, MAX_ROUND_NUMBER, defaultExpiry),
          visibility: readFlag(values, "partiesOnly") ? "parties-only" : "public",
        })
      }
      pending={pending}
      scope={scope}
      submitLabel="Send offer"
      validate={(values) => {
        if (readAll(values, "recipientIds").length === 0) return "Pick at least one seat.";
        const empty =
          sideItems(values, "give").length === 0 && sideItems(values, "receive").length === 0;

        return empty ? "An offer needs something on at least one side." : null;
      }}
    >
      <ActionChoiceField
        hint={`Up to ${pluralise(action.maxRecipients, "seat")}.`}
        label="Offer to"
        multiple
        name="recipientIds"
        options={recipients}
      />
      <ActionAmountField
        hint={`You hold ${formatActionMoney(context.spendable.money)}.`}
        label="You give: money"
        max={MAX_MONEY_AMOUNT}
        name="giveMoney"
      />
      {allows("immunity") ? (
        <ActionAmountField
          hint="Rounds you will not attack them for."
          label="You give: immunity"
          max={MAX_IMMUNITY_ROUNDS}
          name="giveImmunity"
        />
      ) : null}
      {allows("promise") ? (
        <ActionTextField
          hint="Recorded, never enforced. The table gets to see who broke it."
          label="You give: a promise"
          maxLength={action.promiseTextMaxLength}
          name="promise"
        />
      ) : null}
      <ActionAmountField label="You want: money" max={MAX_MONEY_AMOUNT} name="receiveMoney" />
      {allows("immunity") ? (
        <ActionAmountField
          hint="Rounds they will not attack you for."
          label="You want: immunity"
          max={MAX_IMMUNITY_ROUNDS}
          name="receiveImmunity"
        />
      ) : null}
      <ActionAmountField
        defaultValue={defaultExpiry}
        hint={`It is round ${formatPanelNumber(round)} now.`}
        label="Expires at round"
        max={MAX_ROUND_NUMBER}
        min={1}
        name="expiresAtRound"
      />
      <ActionCheckField
        hint="Off means the whole table can read the clauses."
        label="Only the parties can see it"
        name="partiesOnly"
      />
    </ActionSheet>
  );
}

/**
 * Accept and decline are two buttons, not a switch.
 *
 * The terms are already on the summary — the actor is a party, so `give` and
 * `receive` are theirs to see — and they are printed in the description, which is
 * why the answer needs no picker: the player has read the deal by the time they
 * reach the buttons.
 */
export function RespondAgreementControl({
  action,
  description,
  onSubmit,
  pending,
  scope,
}: ActionControlProps<"agreement.respond">) {
  return (
    <ActionOptionRow
      command="agreement.respond"
      description={description}
      onChoose={(value) =>
        onSubmit({
          type: "agreement.respond",
          expectedRevision: action.expectedRevision,
          agreementId: action.agreementId,
          accept: value === "accept",
        })
      }
      options={[
        { value: "accept", label: "Accept" },
        { value: "decline", label: "Decline" },
      ]}
      pending={pending}
      scope={scope}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Ballots                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Three shapes behind one command, chosen by the nested union the summary
 * carries: authored vote options (one press each), a free-form vote (a text
 * field), or an auction (a bid, where zero means pass).
 *
 * Nothing here promises a tally. The summary has no `castBy`, no count and no
 * result — a sealed ballot's whole point is that "nobody knows yet" — so the
 * control renders the paper and the deadline, never a running total.
 */
export function BallotControl({
  action,
  description,
  onSubmit,
  pending,
  scope,
}: ActionControlProps<"ballot.cast">) {
  const ballot = action.ballot;

  if (ballot.kind === "vote" && ballot.options !== null) {
    return (
      <ActionOptionRow
        command="ballot.cast"
        description={description}
        onChoose={(value) =>
          onSubmit({
            type: "ballot.cast",
            expectedRevision: action.expectedRevision,
            ballotId: action.ballotId,
            value,
          })
        }
        options={ballot.options.map((option) => ({
          value: option,
          label: humaniseId(option),
        }))}
        pending={pending}
        scope={scope}
      />
    );
  }

  if (ballot.kind === "vote") {
    return (
      <ActionSheet
        command="ballot.cast"
        description={description}
        note={
          action.sealed
            ? "Sealed: nothing is shown to anyone until the ballot closes."
            : "Open: the table can see this as soon as it lands."
        }
        onSubmit={(values) =>
          onSubmit({
            type: "ballot.cast",
            expectedRevision: action.expectedRevision,
            ballotId: action.ballotId,
            value: readText(values, "vote"),
          })
        }
        pending={pending}
        scope={scope}
        submitLabel="Cast"
        validate={(values) =>
          readText(values, "vote").length === 0 ? "Write an answer to cast." : null
        }
      >
        <ActionTextField
          hint="This subject takes any answer."
          label="Your vote"
          maxLength={120}
          name="vote"
        />
      </ActionSheet>
    );
  }

  return (
    <ActionSheet
      command="ballot.cast"
      description={description}
      note={`A bid of ${formatActionMoney(0)} passes. The floor is ${formatActionMoney(ballot.minBid)}; anything between is refused.`}
      onSubmit={(values) =>
        onSubmit({
          type: "ballot.cast",
          expectedRevision: action.expectedRevision,
          ballotId: action.ballotId,
          value: readAmount(values, "bid", 0, ballot.maxBid),
        })
      }
      pending={pending}
      scope={scope}
      submitLabel="Bid"
      validate={(values) => {
        const bid = readAmount(values, "bid", 0, ballot.maxBid);

        return bid === 0 || bid >= ballot.minBid
          ? null
          : `Bid ${formatActionMoney(ballot.minBid)} or more, or ${formatActionMoney(0)} to pass.`;
      }}
    >
      <ActionAmountField
        hint={
          ballot.maxBid < ballot.minBid
            ? `The floor is ${formatActionMoney(ballot.minBid)} and you hold ${formatActionMoney(
                ballot.maxBid,
              )} — you can still pass.`
            : `Up to ${formatActionMoney(ballot.maxBid)}. Zero passes.`
        }
        label="Your bid"
        max={ballot.maxBid}
        name="bid"
      />
    </ActionSheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Debt                                                                       */
/* -------------------------------------------------------------------------- */

export function TakeLoanControl({
  action,
  description,
  onSubmit,
  pending,
  scope,
}: ActionControlProps<"loan.take">) {
  return (
    <ActionSheet
      command="loan.take"
      description={description}
      note="Debt is tracked separately from your balance. Owing money is not the same as being short of it."
      onSubmit={(values) =>
        onSubmit({
          type: "loan.take",
          expectedRevision: action.expectedRevision,
          principal: readAmount(values, "principal", 1, action.maxPrincipal, 1),
        })
      }
      pending={pending}
      scope={scope}
      submitLabel="Borrow"
      validate={(values) =>
        readAmount(values, "principal", 0, action.maxPrincipal) < 1
          ? "Enter how much to borrow."
          : null
      }
    >
      <ActionAmountField
        defaultValue={Math.min(action.maxPrincipal, 500)}
        hint={`Up to ${formatActionMoney(action.maxPrincipal)}.`}
        label="Principal"
        max={action.maxPrincipal}
        min={1}
        name="principal"
      />
    </ActionSheet>
  );
}

export function RepayLoanControl({
  action,
  context,
  description,
  onSubmit,
  pending,
  scope,
}: ActionControlProps<"loan.repay">) {
  const options: readonly ActionOption[] = action.loans.map((loan) => ({
    value: loan.loanId,
    label: labelFor(context.labels?.loans, loan.loanId),
    price: formatActionMoney(loan.outstanding),
    note: "Outstanding.",
  }));
  const ceiling = Math.max(1, action.maxAmount);

  return (
    <ActionSheet
      command="loan.repay"
      description={description}
      note="Repaying less than the outstanding amount is allowed; the rest keeps accruing."
      onSubmit={(values) => {
        const loanId = readText(values, "loanId");
        const loan = action.loans.find((entry) => entry.loanId === loanId);
        if (loan === undefined) return;
        onSubmit({
          type: "loan.repay",
          expectedRevision: action.expectedRevision,
          loanId: loan.loanId,
          // Two ceilings, tightest wins: what is still owed, and what you hold.
          amount: readAmount(values, "amount", 1, Math.min(loan.outstanding, ceiling), 1),
        });
      }}
      pending={pending}
      scope={scope}
      submitLabel="Repay"
      validate={(values) => {
        if (readText(values, "loanId").length === 0) return "Pick a loan.";

        return readAmount(values, "amount", 0, ceiling) < 1 ? "Enter an amount." : null;
      }}
    >
      <ActionChoiceField label="Loan" name="loanId" options={options} />
      <ActionAmountField
        defaultValue={Math.min(ceiling, action.loans[0]?.outstanding ?? 1)}
        hint={`You hold ${formatActionMoney(action.maxAmount)}.`}
        label="Amount"
        max={ceiling}
        min={1}
        name="amount"
      />
    </ActionSheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Decks                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Management's deck control, beside the deck it governs.
 *
 * In the events panel rather than the command lane: it acts on a deck, not on
 * your position, and it is legal for one seat in the room — putting it in the
 * lane would give every other player a permanently empty slot to wonder about.
 */
export function ShuffleDeckControl({
  action,
  context,
  description,
  onSubmit,
  pending,
  scope,
}: ActionControlProps<"management.shuffle-deck">) {
  const first = action.deckIds[0];

  if (action.deckIds.length === 1 && first !== undefined) {
    return (
      <ActionButton
        command="management.shuffle-deck"
        description={description}
        onClick={() =>
          onSubmit({
            type: "management.shuffle-deck",
            expectedRevision: action.expectedRevision,
            deckId: first,
          })
        }
        pending={pending}
        scope={scope}
      />
    );
  }

  return (
    <ActionOptionRow
      command="management.shuffle-deck"
      description={description}
      onChoose={(deckId) =>
        onSubmit({
          type: "management.shuffle-deck",
          expectedRevision: action.expectedRevision,
          deckId,
        })
      }
      options={action.deckIds.map((deckId) => ({
        value: deckId,
        label: labelFor(context.labels?.decks, deckId),
      }))}
      pending={pending}
      scope={scope}
    />
  );
}
