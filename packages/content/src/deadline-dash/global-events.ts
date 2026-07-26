import type { GlobalEventConfig, GlobalEventId } from "../schema";

/**
 * The six authored quarter-scale shocks, per spec §5.7.
 *
 * Every one of them is announced a quarter ahead. That is the whole point: a
 * shock the table can see coming is a decision — bank cash before the audit,
 * finish the project before the reorg, take the loan before the freeze — while
 * an unannounced one is just variance applied to whoever happened to be
 * exposed. The `announcedQuarterAhead` flag records the rule in data rather
 * than leaving the engine to assume it.
 *
 * Split of responsibility inside each entry:
 * - `effects` resolve **once**, per player in `scope`, when the quarter turns
 *   over. They reuse the existing `EffectDescriptor` vocabulary, so no engine
 *   work beyond scope resolution is needed to apply them.
 * - `modifiers` hold for the **whole quarter** and are table-wide. They are a
 *   separate vocabulary because "no promotions this quarter" is not something
 *   that happens to a player, and must not be authorable on a deck card.
 */
export const deadlineDashGlobalEvents = {
  "globalEvent.audit-season": {
    id: "globalEvent.audit-season",
    displayNameKey: "deadlineDash.globalEvent.auditSeason.name",
    descriptionKey: "deadlineDash.globalEvent.auditSeason.description",
    scope: "players-with-heat",
    effects: [
      {
        type: "payResource",
        resource: "money",
        amount: 500,
        insufficientFunds: "pay-up-to-available",
      },
    ],
    modifiers: [{ type: "adjustHeatThreshold", delta: -1 }],
    announcedQuarterAhead: true,
    sourceNotes: [
      "Scoped to players carrying heat so that the announcement gives an aggressor a real choice: stop attacking and let heat decay, or keep going and pay the fine.",
      "`payResource` with `pay-up-to-available` rather than `modifyResource`, so a player who cannot cover the fine is not driven negative by an event they cannot decline.",
    ],
  },
  "globalEvent.layoffs": {
    id: "globalEvent.layoffs",
    displayNameKey: "deadlineDash.globalEvent.layoffs.name",
    descriptionKey: "deadlineDash.globalEvent.layoffs.description",
    scope: "trailing-players",
    effects: [{ type: "modifyResource", resource: "reputation", amount: -2, clampAtZero: true }],
    modifiers: [{ type: "demoteLowest", resource: "reputation" }],
    announcedQuarterAhead: true,
    sourceNotes: [
      "`demoteLowest` and not an elimination: a mode with `conflict.elimination: false` must still be able to schedule layoffs, so the authored consequence is the demotion and the mode decides separately whether anyone can leave the table.",
      "Announced a quarter ahead specifically so a trailing player can spend the quarter buying reputation out of the danger band.",
    ],
  },
  "globalEvent.budget-freeze": {
    id: "globalEvent.budget-freeze",
    displayNameKey: "deadlineDash.globalEvent.budgetFreeze.name",
    descriptionKey: "deadlineDash.globalEvent.budgetFreeze.description",
    scope: "all-players",
    effects: [
      {
        type: "payResource",
        resource: "money",
        amount: 250,
        insufficientFunds: "pay-up-to-available",
      },
    ],
    modifiers: [
      { type: "blockPromotions" },
      { type: "blockLoans" },
      { type: "multiplySalary", multiplier: 0.5 },
    ],
    announcedQuarterAhead: true,
    sourceNotes: [
      "The one event whose weight is almost entirely in its modifiers: the point is the quarter you cannot promote or borrow in, not the one-off sweep of unspent budget.",
      "Blocking loans and halving salary in the same quarter is deliberately harsh, which is exactly why it has to be announced — the correct response is to take the loan and buy the promotion in the quarter *before* it lands.",
    ],
  },
  "globalEvent.reorg": {
    id: "globalEvent.reorg",
    displayNameKey: "deadlineDash.globalEvent.reorg.name",
    descriptionKey: "deadlineDash.globalEvent.reorg.description",
    scope: "all-players",
    effects: [
      {
        type: "rollCheck",
        dice: { count: 1, sides: 6 },
        rerollEligible: false,
        outcomes: [
          {
            when: { total: [1, 2] },
            effects: [
              { type: "modifyResource", resource: "reputation", amount: -2, clampAtZero: true },
            ],
          },
          {
            when: { total: [3, 4] },
            effects: [
              { type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true },
            ],
          },
          {
            when: { total: [5, 6] },
            effects: [{ type: "modifyResource", resource: "reputation", amount: 2 }],
          },
        ],
      },
    ],
    modifiers: [{ type: "multiplyProjectPayout", multiplier: 0.75 }],
    announcedQuarterAhead: true,
    sourceNotes: [
      "The only event that is genuinely a lottery per player, and the one place that is the correct design: a reorg redistributes standing without regard to merit. Every other event resolves deterministically from state.",
      "The middle band still costs energy rather than doing nothing, so that a reorg is never free.",
      "In-flight projects pay out less, which is the announced-ahead decision: finish before the reorg or accept the haircut.",
    ],
  },
  "globalEvent.merger-rumour": {
    id: "globalEvent.merger-rumour",
    displayNameKey: "deadlineDash.globalEvent.mergerRumour.name",
    descriptionKey: "deadlineDash.globalEvent.mergerRumour.description",
    scope: "all-players",
    effects: [
      {
        type: "rollCheck",
        dice: { count: 2, sides: 6 },
        rerollEligible: false,
        outcomes: [
          {
            when: { total: [2, 6] },
            effects: [
              { type: "modifyResource", resource: "money", amount: -300, clampAtZero: true },
            ],
          },
          {
            when: { total: [7, 9] },
            effects: [{ type: "modifyResource", resource: "reputation", amount: 1 }],
          },
          {
            when: { total: [10, 12] },
            effects: [{ type: "modifyResource", resource: "money", amount: 500 }],
          },
        ],
      },
    ],
    modifiers: [{ type: "blockTileClaims" }],
    announcedQuarterAhead: true,
    sourceNotes: [
      "Announced even though it is a *rumour*, which reads backwards until you look at what the alternative buys: an unannounced swing on everyone's money is variance nobody can play around, and the whole reason §5.7 announces events is to convert a shock into a decision. What the table learns a quarter early is that the rumour is coming, not how it lands.",
      "Territory is frozen for the quarter (`blockTileClaims`) because nothing gets signed off while an acquisition is in play — which is what makes the *preceding* quarter the one worth claiming in.",
    ],
  },
  "globalEvent.bonus-season": {
    id: "globalEvent.bonus-season",
    displayNameKey: "deadlineDash.globalEvent.bonusSeason.name",
    descriptionKey: "deadlineDash.globalEvent.bonusSeason.description",
    scope: "all-players",
    effects: [
      { type: "gainSalary", trigger: "land" },
      { type: "modifyResource", resource: "reputation", amount: 1 },
    ],
    modifiers: [{ type: "multiplySalary", multiplier: 1.5 }, { type: "suspendUpkeep" }],
    announcedQuarterAhead: true,
    sourceNotes: [
      "The only unambiguously positive event, and it needs to exist: a quarter track made only of shocks turns the whole economy into a tax, and there has to be a quarter worth being high-rank in.",
      "`gainSalary` with `trigger: 'land'` reuses the existing salary effect rather than authoring a flat cash amount, so the payout scales with rank and honours the Sales Star salary multiplier automatically.",
      "Upkeep is suspended for the quarter, which is what makes promoting *into* bonus season the right play and gives `promotionRaisesUpkeep` a counterweight.",
    ],
  },
} as const satisfies Record<GlobalEventId, GlobalEventConfig>;

/**
 * The default quarter rotation: a deterministic, authored order the engine can
 * schedule from without inventing one, and without needing randomness for a
 * quarter track at all.
 *
 * Ordered so the first quarter's announcement is a *positive* event (bonus
 * season) — a table's first experience of the quarter track should be something
 * to aim at, not a punishment — and so the two hardest events (budget freeze and
 * layoffs) are never adjacent.
 *
 * A mode with more quarters than this list has entries wraps around it; that is
 * why `mode.campaign`'s eight quarters reuse the six.
 */
export const deadlineDashGlobalEventOrder = [
  "globalEvent.bonus-season",
  "globalEvent.budget-freeze",
  "globalEvent.reorg",
  "globalEvent.layoffs",
  "globalEvent.merger-rumour",
  "globalEvent.audit-season",
] as const satisfies readonly GlobalEventId[];
