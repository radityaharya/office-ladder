/**
 * The action layer's vocabulary: what a control is handed, what it emits, and
 * the pure lookups every control shares.
 *
 * ## Why this module exists
 *
 * The engine implements thirty commands, the transport advertises twenty-seven,
 * and before this directory the UI branched on **two** of them. A command the UI
 * cannot see does not exist, so the twenty-five that had no control were, from a
 * player's seat, unimplemented. Nothing in here is a new rule: every number a
 * control prints comes off a {@link LegalActionSummary} the server already sent,
 * or off the actor's own balances. This layer states prices; it never decides
 * legality, and it never invents an option the server did not enumerate.
 *
 * ## Two type-level guarantees
 *
 * 1. {@link ActionCommandDraft} is *derived* from `PlayerCommandRequestByType`,
 *    so a control cannot emit a body the server's parser would refuse. If
 *    `packages/contracts` changes a payload, the control that builds it stops
 *    compiling — which is the correct failure, and is how a twenty-eighth command
 *    gets noticed here instead of silently missing.
 * 2. Everything a control needs beyond the summary arrives in {@link ActionContext},
 *    and that type has room for the actor's OWN balances and for public seat
 *    identity only. There is deliberately nowhere to put another player's money,
 *    hand, statuses or objectives — the same redaction-by-construction discipline
 *    `legal-actions.ts` uses on the way out of the server.
 *
 * Pure functions only: no React, no browser API, no `Date`. These run inside
 * `renderToStaticMarkup` in a bare Node process.
 */
import type {
  LegalActionSummary,
  LegalActionSummaryType,
  PlayerCommandRequestByType,
  PlayerCommandType,
} from "@office-ladder/contracts";

import type { PanelId } from "../panels/panel-registry";
import { formatPanelMoney, formatPanelNumber, pluralise } from "../panels/panel-format";

/** The one summary member a control of `Type` is built for. */
export type ActionOf<Type extends LegalActionSummaryType> = Extract<
  LegalActionSummary,
  { readonly type: Type }
>;

/**
 * A command body ready for `POST /api/rooms/:roomId/commands`, minus its
 * `commandId`.
 *
 * The id is the *transport's* business, not a control's: §11.1 keys idempotency
 * on it, so a retry has to re-send the SAME id, and only the caller that owns the
 * retry can know that. A control that minted its own id would make every retry a
 * second apply.
 *
 * Mapped over `PlayerCommandType` rather than written out, so this union is the
 * server's parser registry with the envelope's id removed — nothing more.
 */
export type ActionCommandDraft = {
  readonly [Type in PlayerCommandType]: { readonly type: Type } & Omit<
    PlayerCommandRequestByType[Type],
    "commandId"
  >;
}[PlayerCommandType];

export type ActionSubmit = (draft: ActionCommandDraft) => void;

/**
 * Where a control lives (spec §12.2's three tiers).
 *
 * - `turn` — tier 1. The command bar under the board: the roll, and whatever else
 *   is legal *on your own turn right now*.
 * - `decision` — tier 1. An open decision addressed to you, on a clock. Never
 *   behind a tab.
 * - `rail` — tier 2. Beside the state it acts on, inside that panel.
 */
export type ActionSurface = "turn" | "decision" | "rail";

export type ActionEmphasis = "primary" | "secondary" | "critical";

/** A seat a picker may offer. Public information only — name, seat, id. */
export type ActionSeat = {
  readonly playerId: string;
  readonly name: string;
  /** Display seat 1..6, or null when the seat is unknown to the caller. */
  readonly seat: number | null;
};

/** What the actor can spend. Their own balances, never anybody else's. */
export type ActionSpendable = {
  readonly money: number;
  readonly energy: number;
  /** The `resource.work-counter` value — what sabotage and contribution spend. */
  readonly work: number;
};

/**
 * Human names for the opaque ids a summary carries.
 *
 * Every map is optional and every lookup falls back to {@link humaniseId}, so a
 * caller that has no label table still gets a readable control rather than a raw
 * slug — and a control never blocks on copy it was not given.
 */
export type ActionLabels = {
  readonly tiles?: Readonly<Record<string, string>>;
  readonly projects?: Readonly<Record<string, string>>;
  readonly projectBriefs?: Readonly<Record<string, string>>;
  readonly cards?: Readonly<Record<string, string>>;
  readonly decks?: Readonly<Record<string, string>>;
  readonly tokens?: Readonly<Record<string, string>>;
  readonly abilities?: Readonly<Record<string, string>>;
  readonly ranks?: Readonly<Record<string, string>>;
  readonly vectors?: Readonly<Record<string, string>>;
  readonly ballotSubjects?: Readonly<Record<string, string>>;
  readonly loans?: Readonly<Record<string, string>>;
  readonly prompts?: Readonly<Record<string, string>>;
};

export type ActionContext = {
  readonly spendable: ActionSpendable;
  /** Seats a target picker may offer. The actor's own seat may be omitted. */
  readonly seats: readonly ActionSeat[];
  readonly labels?: ActionLabels;
  /**
   * The tile the actor is standing on.
   *
   * `placement.place` needs a `tileId` the summary does not carry (it prices the
   * KINDS, not a square), and a placement is left where you are. Null means the
   * control says so rather than guessing a square.
   */
  readonly tileId?: string | null;
  /** Current round, so an offer's expiry defaults to something legal. */
  readonly round?: number;
};

/**
 * One control's whole copy, derived from the summary and the actor's balances.
 *
 * `blocked` is the load-bearing field and it is deliberately SHORT. The rule this
 * layer follows: an action the server enumerated but the actor cannot afford
 * renders **disabled with its reason beside it** ("Costs $400, you hold $250."),
 * because that teaches the economy; an action the server did not enumerate
 * renders **nothing at all**, because a disabled button for a rule that does not
 * exist invents one.
 */
export type ActionDescription = {
  /** Command voice, short. Rendered uppercase by CSS, sentence case in source. */
  readonly label: string;
  /** What it spends, as one mono token, or null when the summary prices nothing. */
  readonly price: string | null;
  /** One sentence: what it does, and what the numbers mean. */
  readonly detail: string;
  /** Non-null ⇒ disabled, with this clause rendered beside the control. */
  readonly blocked: string | null;
};

/**
 * What every control component is handed — the same six props for all
 * twenty-seven, which is what lets one registry dispatch them all.
 *
 * `description` is passed IN rather than derived inside the control: the host
 * already needs it to decide emphasis and ordering, and computing copy twice is
 * how two places end up disagreeing about a price.
 */
export type ActionControlProps<
  Type extends LegalActionSummaryType = LegalActionSummaryType,
> = {
  readonly action: ActionOf<Type>;
  readonly context: ActionContext;
  readonly description: ActionDescription;
  readonly onSubmit: ActionSubmit;
  /** True while a command of this type is in flight. Never gates legality. */
  readonly pending: boolean;
  /** Distinguishes two hosts mounting the same control; part of every DOM id. */
  readonly scope: string;
};

/* -------------------------------------------------------------------------- */
/* Ids and labels                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A readable name for an opaque id: `tile.desk-14` → "Desk 14".
 *
 * Only ever a *fallback*. Authored copy belongs in {@link ActionLabels}; this
 * exists so a missing entry degrades to something a player can act on instead of
 * printing a slug or, worse, hiding the control.
 */
export function humaniseId(id: string): string {
  const tail = id.split(".").at(-1) ?? id;
  const words = tail.replaceAll(/[-_]/g, " ").trim();
  if (words.length === 0) return id;

  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function labelFor(
  map: Readonly<Record<string, string>> | undefined,
  id: string,
): string {
  const found = map?.[id];

  return found === undefined || found.length === 0 ? humaniseId(id) : found;
}

export function seatFor(context: ActionContext, playerId: string): ActionSeat | null {
  return context.seats.find((seat) => seat.playerId === playerId) ?? null;
}

/**
 * A seat's name, or a neutral stand-in.
 *
 * Never `humaniseId` here: a player id is an opaque uuid, and "Seat 4f2a1c" is
 * worse than "Another seat" — it looks like data and is not.
 */
export function nameFor(context: ActionContext, playerId: string): string {
  return seatFor(context, playerId)?.name ?? "Another seat";
}

/** DOM id for a control's own parts. Deterministic, so markup tests can name it. */
export function actionDomId(
  part: string,
  type: LegalActionSummaryType,
  scope = "turn",
): string {
  return `action-${part}-${scope}-${type}`;
}

/* -------------------------------------------------------------------------- */
/* Prices and shortfalls                                                      */
/* -------------------------------------------------------------------------- */

export { formatPanelMoney as formatActionMoney };

/** `250 bp` → `2.5%`, with no trailing `.0`. Loans are priced in basis points. */
export function formatBasisPoints(basisPoints: number): string {
  if (!Number.isFinite(basisPoints)) return "0%";
  const percent = Math.round(basisPoints) / 100;

  return `${Number.isInteger(percent) ? formatPanelNumber(percent) : percent.toFixed(2).replace(/0$/, "")}%`;
}

/** `3 energy` / `1 energy`. */
export function formatEnergy(value: number): string {
  return pluralise(value, "energy", "energy");
}

/** `4 work` — the work counter is a count, not a currency. */
export function formatWork(value: number): string {
  return pluralise(value, "work", "work");
}

/**
 * The teaching clause. `costs 400, holds 250` → "Costs $400, you hold $250."
 *
 * One sentence, both numbers, no colour: the reason a control is inert has to be
 * readable as text (§8) and short enough to sit inside a 40px lane.
 */
export function moneyShortfall(cost: number, held: number): string {
  return `Costs ${formatPanelMoney(cost)}, you hold ${formatPanelMoney(held)}.`;
}

/**
 * True when the actor cannot pay. Written as a helper rather than inline so every
 * control answers affordability the same way, including at the boundary
 * (`cost === held` is affordable).
 */
export function cannotAfford(cost: number, held: number): boolean {
  return cost > held;
}

/* -------------------------------------------------------------------------- */
/* Reading a picker's form                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The pickers are uncontrolled `<form>`s read on submit, not React state.
 *
 * That is a deliberate choice with two payoffs: a control's resting render is a
 * pure function of its props (so `renderToStaticMarkup` sees the real thing), and
 * a sheet cannot get stuck holding a stale amount from a previous revision.
 */
export function readText(values: FormData, name: string): string {
  const raw = values.get(name);

  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * A whole number inside `[minimum, maximum]`, or `fallback` for anything else.
 *
 * Clamped here rather than trusted from the input's own `min`/`max`, which a
 * browser will happily let a player step past with a keyboard. Submitting a value
 * the server's parser refuses would show the player a refusal for a control that
 * told them the number was legal.
 */
export function readAmount(
  values: FormData,
  name: string,
  minimum: number,
  maximum: number,
  fallback = minimum,
): number {
  const parsed = Number.parseInt(readText(values, name), 10);
  if (!Number.isFinite(parsed)) return clampAmount(fallback, minimum, maximum);

  return clampAmount(parsed, minimum, maximum);
}

export function clampAmount(value: number, minimum: number, maximum: number): number {
  if (maximum < minimum) return minimum;

  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

export function readFlag(values: FormData, name: string): boolean {
  return values.get(name) !== null;
}

/** Every value of a repeated field — a checkbox group of recipients. */
export function readAll(values: FormData, name: string): readonly string[] {
  return values
    .getAll(name)
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

/* -------------------------------------------------------------------------- */
/* Closed vocabularies the contract itself documents                          */
/* -------------------------------------------------------------------------- */

/**
 * What a placement does to the next player who lands on it.
 *
 * Quoted from `packages/contracts/src/gameplay.ts`'s own comments on
 * `PLACEMENT_KINDS` — the contract is the authority, so this is a restatement
 * rather than a rule this layer made up. A kind with no entry prints its label
 * and claims nothing about its effect, which is the honest failure.
 */
export const PLACEMENT_EFFECTS: Readonly<Record<string, string>> = {
  "placement.meeting-invite": "The next lander loses their next turn.",
  "placement.sabotage": "The next lander pays you.",
  "placement.surveillance": "You learn what the next lander is holding.",
  "placement.rumour": "The next lander loses reputation.",
  "placement.favour": "The next lander gains — and you paid for it.",
};

/**
 * Reaction windows, in the words of what the player is deciding.
 *
 * `ReactionWindowKind` is a closed three-member union in contracts, so these are
 * exhaustive; an unknown kind falls back to the neutral sentence.
 */
export const REACTION_WINDOW_COPY: Readonly<
  Record<string, { readonly label: string; readonly detail: string }>
> = {
  prevention: {
    label: "Prevent it",
    detail: "An effect is about to land. Playing now stops it before it resolves.",
  },
  "end-turn": {
    label: "React before the turn closes",
    detail: "The turn is ending. This is the last moment anything can be played into it.",
  },
  "promotion-block": {
    label: "React to the promotion",
    detail: "A promotion is on the table and this window is the only chance to answer it.",
  },
};

export type { PanelId };
