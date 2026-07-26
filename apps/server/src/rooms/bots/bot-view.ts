import { deadlineDashBoard, deadlineDashCharacters } from "@office-ladder/content";
import type {
  GameState,
  LegalAction,
  PlayerId,
  PlayerState,
  ResourceKind,
  ResourceState,
} from "@office-ladder/engine";
// Type-only, and it has to stay that way: bot-policy.ts imports the pricing
// below as values, so a value import back the other way would be a real module
// cycle. `import type` is erased before either module is evaluated.
import type { BotCommandBody } from "./bot-policy";

/**
 * The slice of canonical state a bot policy is allowed to reason about.
 *
 * Why a view and not `GameState` itself: `decideBotAction` is the one piece of
 * this feature that has to be exhaustively testable, and a policy that took the
 * whole game would need a real match built for every rule under test. It would
 * also quietly acquire the ability to read another player's hand, their secret
 * objective and every sealed ballot in flight — a bot that plays better than a
 * human *can* is not a difficulty setting, it is a cheat, and the cheapest way
 * to make that impossible is to never hand the policy the information.
 *
 * So this is deliberately shaped like what a seated player knows: its own
 * resources, the public standing of everyone else, and the public facts about
 * whatever is currently being asked of it. Everything here is derivable from
 * {@link readBotTable}; nothing here is derived from another player's private
 * state.
 */

/** What the bot knows about itself. All of it is its own state. */
export type BotSelfView = {
  readonly playerId: PlayerId;
  readonly money: number;
  readonly energy: number;
  /** `energy.maximum`, or the current value when the resource is unbounded. */
  readonly energyMaximum: number;
  /**
   * The work counter, which `project.contribute` and `project.sabotage` spend.
   *
   * Present for the same reason `energy` is: the policy cannot decide what it
   * can afford from a resource it cannot see. Its absence is what let the
   * contribute branch offer one unit of work whenever a project still wanted
   * some, without ever checking the bot held any — the engine rejected it with
   * INSUFFICIENT_RESOURCE, the driver classified that as unexpected, and the
   * whole drain stopped, which stalls the match for every seat.
   *
   * Adding this field fixed *that* instance. What stops the next one is that no
   * branch reads it directly any more: every price now goes through
   * {@link priceBotCommand}, so a resource the policy forgets about is a
   * compile error in one switch rather than a rejection in production.
   */
  readonly workCounter: number;
  readonly reputation: number;
  readonly rankIndex: number;
  readonly heat: number;
  readonly heatThreshold: number;
  readonly upkeepPerRound: number;
  /** Total still owed across every loan. */
  readonly outstandingDebt: number;
  readonly inAudit: boolean;
  readonly handSize: number;
  /**
   * Pips of roll adjustment already bought and not yet spent. Non-zero means
   * this turn's roll has already been steered, which is what stops the policy
   * from buying the same adjustment over and over inside one drain.
   */
  readonly pendingRollPips: number;
};

/** What the bot knows about somebody else — public standing only. */
export type BotRivalView = {
  readonly playerId: PlayerId;
  readonly rankIndex: number;
  readonly money: number;
  readonly reputation: number;
};

/**
 * A ballot the bot is entitled to answer, reduced to the two things a policy
 * can act on: what kind of resolvable it is, and what it is about.
 *
 * `castBy` is **not** here and must never be: spec §7.2 requires sealed ballots
 * not to leak in-flight votes to anyone, and a bot that read them would be the
 * leak.
 */
export type BotBallotView = {
  readonly ballotId: string;
  readonly kind: "vote" | "auction";
  readonly subjectId: string;
  /** Player ids the subject names, when it names any. Empty otherwise. */
  readonly candidateIds: readonly PlayerId[];
};

/** An offer awaiting this bot's answer, priced from its own side of the table. */
export type BotAgreementView = {
  readonly agreementId: string;
  readonly proposerId: PlayerId;
  /** Money the bot would hand over. Non-money items are counted separately. */
  readonly givesMoney: number;
  readonly receivesMoney: number;
  /** Items the bot would give up that are not money — cards, tokens, tiles. */
  readonly givesOtherCount: number;
  /** Anything promised to the bot that the engine cannot enforce. */
  readonly receivesPromiseCount: number;
};

/**
 * An open reaction window the bot is eligible for, reduced to the one fact a
 * self-defence rule needs: whether the effect it guards lands on the bot.
 */
export type BotReactionWindowView = {
  readonly decisionPointId: string;
  readonly kind: "prevention" | "end-turn" | "promotion-block";
  /** True when the pending effect names this bot among those it would affect. */
  readonly aimedAtSelf: boolean;
};

/** A project the bot could contribute to or sabotage. */
export type BotProjectView = {
  readonly projectId: string;
  readonly leadPlayerId: PlayerId;
  /** True when the bot leads it or has already put something into it. */
  readonly isOwn: boolean;
  readonly outstandingMoney: number;
  readonly outstandingWork: number;
};

export type BotTableView = {
  readonly self: BotSelfView;
  /** Every other seated, not-eliminated player. */
  readonly rivals: readonly BotRivalView[];
  readonly round: number;
  /**
   * The rival furthest up the ladder, ties broken by money then by id so the
   * answer is stable across the repository's JSON round trip. `null` when the
   * bot is alone or already ahead of everyone.
   */
  readonly leaderId: PlayerId | null;
  readonly reactionWindows: readonly BotReactionWindowView[];
  readonly ballots: readonly BotBallotView[];
  readonly agreements: readonly BotAgreementView[];
  readonly projects: readonly BotProjectView[];
  /** `rules.bots.canNegotiate` — whether this mode lets a bot trade at all. */
  readonly canNegotiate: boolean;
  /** `rules.conflict.heatEnabled`; with heat off, aggression is unpriced. */
  readonly heatEnabled: boolean;
  /**
   * Tiles this bot already has a live placement on.
   *
   * The placement analogue of {@link BotSelfView.pendingRollPips}, and it exists
   * for the identical reason. `execution/placements.ts` refuses a second
   * placement by the same owner on the same tile, but the enumerator checks only
   * the per-player *count* — so a bot that placed on the tile it is standing on
   * was re-offered `placement.place` on the very next drain iteration, chose the
   * same tile again, and had the command rejected as ILLEGAL_ACTION. That is not
   * a wasted decision: it stops the drain and stalls the match for every seat,
   * exactly like the INSUFFICIENT_RESOURCE stall this round set out to kill.
   *
   * Optional only so a hand-built table in a test need not enumerate it.
   * {@link readBotTable} always supplies it, and an absent list is read as
   * "unknown", which suppresses the branch rather than guessing — the same
   * direction of caution every other unknown in this module takes.
   */
  readonly ownPlacementTileIds?: readonly string[];
  /**
   * Energy one `turn.action` costs, so the policy can tell an affordable free
   * action from one the transition will refuse.
   *
   * The enumerator advertises `turn.action` on budget alone — it does not price
   * it — so a bot that picked `work` with no energy had its command rejected,
   * and a rejection ends the whole drain. This is the same expression
   * `execution/free-action.ts` uses for `FreeActionPrices.energyCost`, and it is
   * derived from `ModeRules` rather than from content, so it cannot drift with
   * the content pack. The prices that *are* content-derived — what a point of
   * reputation costs, what a shift pays — are deliberately not reproduced here;
   * see bot-policy.ts's note on `network`.
   */
  readonly freeActionEnergyCost: number;
};

/**
 * A resource selected by kind and disambiguated by the **lowest key**.
 *
 * Deliberately the same rule `execution/ballots.ts` uses, and for the same
 * reason: record key order does not survive the repository's
 * `JSON.parse(JSON.stringify(…))` boundary, so "whichever entry came first"
 * would let a bot value its own money differently before and after a reload.
 */
function resourceOfKind(player: PlayerState, kind: ResourceKind): ResourceState | null {
  let found: readonly [string, ResourceState] | null = null;
  for (const [key, resource] of Object.entries(player.resources)) {
    if (resource.kind !== kind) continue;
    if (found === null || key < found[0]) found = [key, resource];
  }

  return found === null ? null : found[1];
}

function valueOfKind(player: PlayerState, kind: ResourceKind): number {
  const resource = resourceOfKind(player, kind);
  if (resource === null) return 0;
  // A resource can sit below its own floor after a charge it could not cover;
  // treating that as spendable would have the policy offer money it does not
  // have and be rejected by every transition it tried.
  return Math.max(resource.minimum ?? 0, resource.value);
}

/**
 * Pips already bought for this turn's roll.
 *
 * Read from the status the engine writes rather than re-derived: the id lives in
 * `execution/agency.ts` as `AGENCY_STATUS_IDS.rollAdjustment`, which the engine
 * does not re-export, so it is matched by suffix here. A miss answers 0, which
 * costs at most one wasted `turn.adjust-roll` — the transition bounds the total
 * itself, so a stale read cannot exceed `agency.maxPipAdjust`.
 */
const ROLL_ADJUSTMENT_STATUS_SUFFIX = "roll-adjustment";

function pendingRollPips(player: PlayerState): number {
  for (const status of player.statuses) {
    if (!String(status.id).endsWith(ROLL_ADJUSTMENT_STATUS_SUFFIX)) continue;
    const pips: unknown = status.data["pips"];
    if (typeof pips === "number" && Number.isFinite(pips)) return Math.trunc(pips);
  }

  return 0;
}

function rivalOf(player: PlayerState): BotRivalView {
  return {
    playerId: player.id,
    rankIndex: player.rank.index,
    money: valueOfKind(player, "resource.money"),
    reputation: valueOfKind(player, "resource.reputation"),
  };
}

/**
 * Who is winning, by the only ordering every shipped mode agrees on: rank
 * first, then money, then reputation, then player id.
 *
 * Player id is the last tiebreak on purpose — without it two players level on
 * every visible axis would make "the leader" depend on `playerOrder`, and a bot
 * whose aggression target flips between two identical rivals from one read to
 * the next reads as a malfunction rather than a decision.
 */
function leaderAmong(rivals: readonly BotRivalView[]): BotRivalView | null {
  let leader: BotRivalView | null = null;
  for (const rival of rivals) {
    if (leader === null) {
      leader = rival;
      continue;
    }
    if (rival.rankIndex !== leader.rankIndex) {
      if (rival.rankIndex > leader.rankIndex) leader = rival;
      continue;
    }
    if (rival.money !== leader.money) {
      if (rival.money > leader.money) leader = rival;
      continue;
    }
    if (rival.reputation !== leader.reputation) {
      if (rival.reputation > leader.reputation) leader = rival;
      continue;
    }
    if (String(rival.playerId) < String(leader.playerId)) leader = rival;
  }

  return leader;
}

/** Player ids named anywhere in a ballot subject, deduplicated and ordered. */
function candidateIdsOf(
  subject: Readonly<Record<string, unknown>>,
  seated: readonly PlayerId[],
): readonly PlayerId[] {
  const named = new Set<string>();
  for (const value of Object.values(subject)) {
    if (typeof value === "string") named.add(value);
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (typeof entry === "string") named.add(entry);
    }
  }

  // Intersected with the real table rather than trusted: the subject is written
  // by whatever opened the ballot, and a candidate list that named a player who
  // is not seated would have the bot cast a vote the engine must reject.
  return seated.filter((playerId) => named.has(String(playerId)));
}

function moneyIn(items: readonly { readonly kind: string }[]): number {
  let total = 0;
  for (const item of items) {
    if (item.kind !== "money") continue;
    const amount: unknown = (item as { readonly amount?: unknown }).amount;
    if (typeof amount === "number" && Number.isFinite(amount)) total += amount;
  }

  return total;
}

function countIn(
  items: readonly { readonly kind: string }[],
  kinds: readonly string[],
): number {
  return items.filter((item) => kinds.includes(item.kind)).length;
}

/**
 * Everything {@link decideBotAction} is allowed to see, derived from canonical
 * state for one bot seat.
 *
 * Pure: no clock, no I/O, no randomness. The driver calls it once per command
 * against the state it just read, so the view and the legal-action list it is
 * paired with always describe the same revision.
 */
export function readBotTable(game: GameState, botPlayerId: PlayerId): BotTableView | null {
  const player = game.players[botPlayerId];
  if (player === undefined) return null;

  const energy = resourceOfKind(player, "resource.energy");
  const energyValue = energy === null ? 0 : Math.max(0, energy.value);
  const rivals = game.playerOrder
    .filter(
      (playerId) => playerId !== botPlayerId && !game.eliminatedPlayerIds.includes(playerId),
    )
    .map((playerId) => game.players[playerId])
    .filter((candidate): candidate is PlayerState => candidate !== undefined)
    .map(rivalOf);

  const self: BotSelfView = {
    playerId: botPlayerId,
    money: valueOfKind(player, "resource.money"),
    energy: energyValue,
    energyMaximum: energy?.maximum ?? energyValue,
    workCounter: Math.max(0, valueOfKind(player, "resource.work-counter")),
    reputation: valueOfKind(player, "resource.reputation"),
    rankIndex: player.rank.index,
    heat: player.heat.value,
    heatThreshold: player.heat.threshold,
    upkeepPerRound: player.upkeep.perRound,
    outstandingDebt: player.loans.reduce((total, loan) => total + loan.outstanding, 0),
    inAudit: player.inAudit,
    handSize: player.hand.length,
    pendingRollPips: pendingRollPips(player),
  };

  const ahead = leaderAmong(rivals.filter((rival) => rival.rankIndex >= self.rankIndex));

  return {
    self,
    rivals,
    round: game.turn.round,
    leaderId: ahead === null ? null : ahead.playerId,
    reactionWindows: game.reactionWindows
      .filter((window) => window.eligiblePlayerIds.includes(botPlayerId))
      .map((window) => {
        const pending =
          window.pendingEffectId === null
            ? undefined
            : game.pendingEffects.find(
                (effect) => effect.id === window.pendingEffectId,
              );

        return {
          decisionPointId: String(window.id),
          kind: window.kind,
          // A window with no pending effect the bot can see is treated as not
          // aimed at it. Guessing the other way would have a bot spend a card on
          // an effect it cannot even read.
          aimedAtSelf: pending?.affectedPlayerIds.includes(botPlayerId) ?? false,
        };
      }),
    ballots: game.ballots
      .filter((ballot) => ballot.resolution === null && ballot.audience.includes(botPlayerId))
      .map((ballot) => ({
        ballotId: String(ballot.id),
        kind: ballot.kind,
        subjectId: ballot.subjectId,
        candidateIds: candidateIdsOf(ballot.subject, game.playerOrder),
      })),
    agreements: game.agreements
      .filter(
        (agreement) =>
          agreement.status === "offered" && agreement.recipientIds.includes(botPlayerId),
      )
      .map((agreement) => ({
        agreementId: String(agreement.id),
        proposerId: agreement.proposerId,
        // `give`/`receive` are written from the *proposer's* side, so they are
        // swapped here. Reading them the other way round would have a bot accept
        // every offer that emptied its own pockets.
        givesMoney: moneyIn(agreement.receive),
        receivesMoney: moneyIn(agreement.give),
        givesOtherCount: countIn(agreement.receive, ["card", "token", "tile"]),
        receivesPromiseCount: countIn(agreement.give, ["promise"]),
      })),
    projects: game.projects
      // "open" and "funded" are the two live states; a completed or failed
      // project can be neither contributed to nor sabotaged, so offering one to
      // the policy would only produce commands the engine then refuses.
      .filter((project) => project.status === "open" || project.status === "funded")
      .map((project) => {
        const contributedMoney = project.contributions.reduce(
          (total, contribution) => total + contribution.money,
          0,
        );
        const contributedWork = project.contributions.reduce(
          (total, contribution) => total + contribution.work,
          0,
        );

        return {
          projectId: String(project.id),
          leadPlayerId: project.leadPlayerId,
          isOwn:
            project.leadPlayerId === botPlayerId ||
            project.contributions.some(
              (contribution) => contribution.playerId === botPlayerId,
            ),
          outstandingMoney: Math.max(0, project.requiredMoney - contributedMoney),
          outstandingWork: Math.max(0, project.requiredWork - contributedWork),
        };
      }),
    canNegotiate: game.rules.bots.canNegotiate,
    heatEnabled: game.rules.conflict.heatEnabled,
    // `charges > 0` is the same liveness test `activePlacementCount` and the
    // transition's duplicate guard both use — a spent placement no longer
    // blocks a new one on that tile.
    ownPlacementTileIds: game.placements
      .filter((placement) => placement.ownerId === botPlayerId && placement.charges > 0)
      .map((placement) => String(placement.tileId)),
    freeActionEnergyCost: Math.max(1, Math.floor(game.rules.agency.energyPerPip)),
  };
}

/* ------------------------------------------------------------------ *
 * Affordability — the one place a bot prices what it is about to do
 * ------------------------------------------------------------------ */

/**
 * **Why this section exists, and why it is not six more `if` statements.**
 *
 * The engine has nineteen `INSUFFICIENT_RESOURCE` guards a player command can
 * trip. Every one of them ends a bot drain, because the driver classifies that
 * code as a defect rather than a lost race — and a stopped drain stalls the
 * match for every seat at the table, humans included.
 *
 * Before this, the policy re-derived affordability by hand, once per branch,
 * from whatever the view happened to expose. That is not a bug, it is a bug
 * *factory*, and it has now produced the same failure twice: a bot picked
 * `work` with no energy (fixed by adding `energy` to the view), and a bot
 * offered a unit of work it did not hold (fixed by adding `workCounter`). Both
 * fixes added a field. Neither made the third one impossible.
 *
 * So the rule is now structural rather than diligent: **a `BotDecision` cannot
 * be constructed without being priced.** bot-policy.ts's `decide` — the single
 * constructor of every non-`none` decision — calls {@link botCanAffordCommand}
 * and answers `null` when the answer is no, and a `null` falls through to the
 * next candidate. A branch that wants to overspend has to first add a case to
 * the switch in {@link priceBotCommand} saying it is free, which is exactly the
 * "going out of your way" the design is meant to require.
 *
 * The switch is exhaustive over `BotCommandBody["type"]`, so a twenty-fifth
 * command does not compile until somebody has said what it costs.
 *
 * ### Why not consume contracts' `LegalActionSummary` instead
 *
 * `toLegalActionSummary` in packages/contracts/src/legal-actions.ts already
 * computes `maxMoney`, `maxWork`, `affordablePips` and per-kind placement costs
 * for the UI, under an explicit tighten-only rule, and routing bots through it
 * would genuinely delete four of the six holes. It was rejected for three
 * reasons, in descending order of weight:
 *
 * 1. **It does not carry the two prices that are actually missing.** The
 *    summary has no `project.start` stake and no `attack.target` vector cost —
 *    the same two gaps named below. Adopting it would have left both, while
 *    adding a dependency, so it could not have been the whole answer either way.
 * 2. **It is a redaction boundary, and a bot is not a browser.** Every field it
 *    drops (`actorId`, `gameId`, ballot kind at the top level, loan capacity) is
 *    dropped so a *viewer* cannot learn it. The driver needs `actorId` to submit
 *    at all, and the policy reads the raw `kind`. Bending a boundary whose whole
 *    value is that it never widens, to serve a consumer on the privileged side
 *    of it, makes the redaction harder to reason about for the consumer it was
 *    built for.
 * 3. **Cost side.** It needs a `LegalActionContext` — `ModeRules`, ballot terms,
 *    agreement terms, the other seats — assembled per decision, which is a
 *    second derivation layer beside `readBotTable` rather than instead of it.
 *
 * What is worth stealing from that file is its *shape*, and this section does:
 * one exhaustive switch, prices clamped to whole non-negative numbers, and a
 * price that is only ever tightened, never widened.
 */

/** The three balances a bot-submittable command can be short of. */
export type BotResourceKind = "money" | "energy" | "work";

/** What one command takes out of the bot's own pocket. */
export type BotSpend = Readonly<Record<BotResourceKind, number>>;

/**
 * What a command costs, as far as the bot can honestly tell.
 *
 * The last two arms are the point. A price the bot cannot read is not the same
 * thing as a price of zero, and collapsing them is precisely how a branch ends
 * up offering more than it holds. Naming them separately means every such gap
 * is visible in one switch and reviewable, instead of being an absence.
 */
export type BotPrice =
  /** No self-resource cost at all. Refusing this can never be right. */
  | { readonly kind: "free" }
  | { readonly kind: "priced"; readonly spend: BotSpend }
  /**
   * The enumerator refused to advertise this action unless the actor could
   * already pay for it, at the same revision the policy is deciding on — but
   * the price itself is not on the `LegalAction`, so it cannot be re-checked
   * here. `floor` is the cheapest the cost could possibly be, which is the only
   * independent check left worth making.
   */
  | {
      readonly kind: "enumerator-priced";
      readonly resource: BotResourceKind;
      readonly floor: number;
    }
  /**
   * A price only the engine or the content pack knows and nothing the bot may
   * import carries. Treated as unaffordable, always: a bot that declines a verb
   * it cannot price plays slightly worse, and a bot that guesses stalls the
   * table. This is the same reasoning bot-policy.ts's `network` note gives, now
   * enforced by the type rather than by a comment.
   */
  | { readonly kind: "unreadable"; readonly resource: BotResourceKind };

const FREE: BotPrice = { kind: "free" };

/**
 * Never negative, never fractional, never `NaN` — and rounded *up*, so a
 * fractional cost is never quietly under-reserved.
 *
 * A garbage cost normalises to zero rather than to "unaffordable", which looks
 * like the wrong direction for a price and is the right one here: a `NaN` or
 * negative cost compares false against every engine guard too (`available < NaN`
 * is false), so treating it as free matches what the transition will actually do.
 * Refusing instead would have the policy decline actions the engine would have
 * accepted, and a `tile.claim` advertised at `-1000` is a state bug to survive,
 * not a reason for a bot to stop playing. `Infinity` is the case that matters and
 * it is handled the same way for the same reason — an unreadable price is spelled
 * `{ kind: "unreadable" }`, deliberately, rather than smuggled in as a number.
 */
function amount(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;

  return Math.max(0, Math.ceil(value));
}

function priced(partial: Partial<Record<BotResourceKind, number>>): BotPrice {
  return {
    kind: "priced",
    spend: {
      money: amount(partial.money),
      energy: amount(partial.energy),
      work: amount(partial.work),
    },
  };
}

/* -------- content reads: prices the bot is allowed to know -------- */

/** Fallback only, so a content pack that drops the audit tile cannot throw. */
const FALLBACK_AUDIT_FINE = 500;

/** The audit tile's authored `auditConfinement.release.alternativeFine`. */
function auditReleaseFine(): number {
  for (const tile of deadlineDashBoard.spaces) {
    for (const effect of tile.effects) {
      if (effect.type === "auditConfinement") return effect.release.alternativeFine;
    }
  }

  return FALLBACK_AUDIT_FINE;
}

export const AUDIT_RELEASE_FINE = auditReleaseFine();

/** The prompt option id that pays the audit fine rather than gambling on it. */
export const AUDIT_PAY_FINE_OPTION_ID = "pay-fine";

/**
 * The most money any character's *active* ability charges in this content pack.
 *
 * `turn.activate-character` is advertised on cooldown and targeting alone — the
 * enumerator never prices it — and one authored active (Workaholic's
 * `payToRestoreEnergy`) costs money, which `execution/agency.ts` then refuses if
 * the actor is short. The bot cannot see its own `characterId`, so it prices the
 * worst case the pack authors instead of the exact one. Conservative in the safe
 * direction: a poor bot skips its ability rather than stalling the match, and
 * the number comes from content rather than being copied into a constant, so it
 * cannot drift.
 */
function worstCaseActiveAbilityMoney(): number {
  let worst = 0;
  for (const character of Object.values(deadlineDashCharacters)) {
    const effect: { readonly type: string; readonly moneyCost?: unknown } =
      character.active.effect;
    if (typeof effect.moneyCost === "number" && Number.isFinite(effect.moneyCost)) {
      worst = Math.max(worst, effect.moneyCost);
    }
  }

  return worst;
}

const WORST_CASE_ACTIVE_ABILITY_MONEY = worstCaseActiveAbilityMoney();

/* -------- the purse -------- */

/** Everything the bot can actually spend, floored at zero. */
export function botHoldings(table: BotTableView): BotSpend {
  return {
    money: Math.max(0, Math.floor(table.self.money)),
    energy: Math.max(0, Math.floor(table.self.energy)),
    work: Math.max(0, Math.floor(table.self.workCounter)),
  };
}

/**
 * The most of one resource a branch may commit, after keeping `reserve` back.
 *
 * The one function a policy branch should use to *size* an offer, as
 * {@link botCanAffordCommand} is the one that vetoes it. Sizing through this
 * rather than through `table.self.money` directly is what keeps "how much do I
 * have" from being spelled five different ways.
 */
export function botAffordable(
  table: BotTableView,
  kind: BotResourceKind,
  reserve = 0,
): number {
  return Math.max(0, botHoldings(table)[kind] - amount(reserve));
}

/* -------- pricing -------- */

/** The matching legal action, or `null` when the pair does not agree. */
function actionOf<Type extends LegalAction["type"]>(
  action: LegalAction,
  type: Type,
): Extract<LegalAction, { readonly type: Type }> | null {
  return action.type === type
    ? (action as Extract<LegalAction, { readonly type: Type }>)
    : null;
}

/**
 * What this command will cost the bot, derived from the command's own payload
 * and the legal action that authorised it.
 *
 * Deriving from the *payload* is deliberate: for the four commands where the
 * bot chooses the size of the spend (`project.contribute`, `project.sabotage`,
 * `loan.repay`, `turn.adjust-roll`) the number the engine will charge is the
 * number in the payload, so the price and the command cannot disagree. For the
 * rest it comes from the legal action, which is the engine's own quote.
 *
 * Cross-checked against the rejection sites, not guessed:
 * - `project.start` → `execution/projects.ts` `definition.leadStakeMoney`
 * - `project.contribute` → `projects.ts`, money and work checked *separately*
 * - `project.sabotage` → `projects.ts`, work one-for-one plus concealment money
 * - `attack.target` → `execution/attack.ts` `vector.cost`
 * - `placement.place` → `execution/placements.ts` `placementCost(rules, kind)`
 * - `loan.repay` → `execution/loans.ts` `spendableMoney < amount`
 * - `turn.adjust-roll` → `execution/agency.ts` `|pips| * energyPerPip`
 * - `tile.claim` / `tile.upgrade` → `execution/tile-ownership.ts`
 * - `turn.action` → `execution/free-action.ts` `prices.energyCost`
 * - `ballot.cast` (auction) → `execution/ballots.ts` `value > spendableMoney`
 * - `agreement.respond` → `execution/agreements.ts` payer coverage
 * - `audit.pay-fine` / `prompt.respond` → the authored `alternativeFine`
 */
export function priceBotCommand(
  action: LegalAction,
  command: BotCommandBody,
  table: BotTableView,
): BotPrice {
  switch (command.type) {
    // Costs nothing the bot holds. Card and ability availability, token counts,
    // reaction eligibility and decision-point membership are all checked by the
    // engine against state, not against a balance — and `loan.take` *adds*
    // money, its only ceiling being the `capacity` the branch clamps to, which
    // the engine refuses as ILLEGAL_ACTION rather than as a shortfall.
    case "turn.roll":
    case "reaction.play":
    case "reaction.pass":
    case "management.block-promotion":
    case "promotion.decline":
    case "turn.play-card":
    case "turn.spend-token":
    case "loan.take":
      return FREE;

    case "prompt.respond":
      // Only the audit prompt's `pay-fine` moves money, and only that prompt
      // kind is wired end to end. A tile-decision prompt's accept branch also
      // has a cost, but neither the prompt nor the legal action carries it —
      // see the note in bot-policy.ts's answerPrompt.
      return command.payload.optionId === AUDIT_PAY_FINE_OPTION_ID
        ? priced({ money: AUDIT_RELEASE_FINE })
        : FREE;

    case "audit.pay-fine":
      return priced({ money: AUDIT_RELEASE_FINE });

    case "ballot.cast": {
      const value = command.payload.value;
      // A vote spends nothing; a bid is checked against spendable money the
      // moment it is cast, not when the auction resolves.
      return typeof value === "number" ? priced({ money: value }) : FREE;
    }

    case "agreement.respond": {
      if (!command.payload.accept) return FREE;
      const offer = table.agreements.find(
        (candidate) => candidate.agreementId === command.payload.agreementId,
      );
      // An offer the view has no record of is refused rather than assumed free:
      // accepting blind is how a bot empties its own pockets.
      return offer === undefined
        ? { kind: "unreadable", resource: "money" }
        : priced({ money: offer.givesMoney });
    }

    case "promotion.attempt": {
      const offer = actionOf(action, "promotion.attempt");
      return offer === null
        ? { kind: "unreadable", resource: "money" }
        : priced({ money: offer.cost });
    }

    case "loan.repay":
      return priced({ money: command.payload.amount });

    case "turn.action":
      switch (command.payload.action) {
        case "rest":
          return FREE;
        case "work":
        case "scheme":
          return priced({ energy: table.freeActionEnergyCost });
        default:
          // `network` prices a point of reputation from content, per rank and
          // per mode, and nothing the bot may import carries that formula. The
          // policy has always documented that it never networks; this is that
          // rule made unrepresentable rather than merely written down.
          return { kind: "unreadable", resource: "money" };
      }

    case "turn.adjust-roll": {
      const offer = actionOf(action, "turn.adjust-roll");
      if (offer === null) return { kind: "unreadable", resource: "energy" };

      return priced({
        energy: Math.abs(command.payload.pips) * Math.max(0, offer.energyPerPip),
      });
    }

    case "turn.activate-character":
      return priced({ money: WORST_CASE_ACTIVE_ABILITY_MONEY });

    case "tile.claim": {
      const offer = actionOf(action, "tile.claim");
      return offer === null
        ? { kind: "unreadable", resource: "money" }
        : priced({ money: offer.cost });
    }

    case "tile.upgrade": {
      const offer = actionOf(action, "tile.upgrade");
      return offer === null
        ? { kind: "unreadable", resource: "money" }
        : priced({ money: offer.cost });
    }

    case "placement.place": {
      const offer = actionOf(action, "placement.place");
      const kind = offer?.kinds.find((entry) => entry.kind === command.payload.kind);
      // A kind the enumerator did not offer has no price here and no legality
      // there, so refusing it is the same answer twice rather than a guess.
      return kind === undefined
        ? { kind: "unreadable", resource: "money" }
        : priced({ money: kind.cost });
    }

    case "project.start":
      // `definition.leadStakeMoney` lives in the engine's own project table and
      // is not exported, and the legal action carries only definition ids. The
      // enumerator does filter by it (`affordableProjectDefinitions`) at the
      // revision the policy is deciding on, so every advertised definition is
      // one the bot can currently pay for. See `gaps`: the durable fix is for
      // the enumerator to quote the stake the way `tile.claim` quotes its cost.
      return { kind: "enumerator-priced", resource: "money", floor: 1 };

    case "project.contribute":
      return priced({
        money: command.payload.money,
        work: command.payload.work,
      });

    case "project.sabotage":
      // Work one for one. Concealment additionally charges money per unit at a
      // rate only the engine's definition table knows — so a hidden sabotage is
      // unpriceable here, and the policy never conceals anyway.
      return command.payload.hidden
        ? { kind: "unreadable", resource: "money" }
        : priced({ work: command.payload.amount });

    case "attack.target":
      // Every vector in `ATTACK_VECTORS` costs energy, the enumerator drops the
      // ones the actor cannot pay for, and neither the descriptor table nor the
      // legal action is exported with its amount. One energy is the cheapest
      // vector the engine authors, so it is the strongest floor available.
      return { kind: "enumerator-priced", resource: "energy", floor: 1 };

    default:
      // Unreachable while the switch stays exhaustive — which is the guarantee
      // this whole section is for. A new `BotCommandBody` member stops
      // compiling here until somebody has priced it.
      command satisfies never;
      return { kind: "unreadable", resource: "money" };
  }
}

/** True when the bot holds everything `price` names. */
export function botCanAfford(table: BotTableView, price: BotPrice): boolean {
  const holdings = botHoldings(table);

  switch (price.kind) {
    case "free":
      return true;
    case "priced":
      return (
        holdings.money >= price.spend.money &&
        holdings.energy >= price.spend.energy &&
        holdings.work >= price.spend.work
      );
    case "enumerator-priced":
      return holdings[price.resource] >= Math.max(1, amount(price.floor));
    case "unreadable":
      return false;
    default:
      price satisfies never;
      return false;
  }
}

/**
 * The veto every decision passes through. See bot-policy.ts's `decide`, which
 * is the only caller and the only constructor of a `BotDecision`.
 */
export function botCanAffordCommand(
  table: BotTableView,
  action: LegalAction,
  command: BotCommandBody,
): boolean {
  return botCanAfford(table, priceBotCommand(action, command, table));
}
