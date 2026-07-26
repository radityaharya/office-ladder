export type TileId = `tile.board.${string}`;

export type DeckId =
  | "deck.work"
  | "deck.meeting"
  | "deck.event"
  | "deck.networking"
  | "deck.board-meeting"
  | "deck.annual-event";

/**
 * `mode.quick` and `mode.marathon` keep their ids: they are referenced by
 * `RankCostByMode` and by persisted games. `mode.standard` is the new default
 * and `mode.campaign` the longest preset — see `deadlineDashModes`.
 *
 * `mode.custom` is deliberately **not** a member: a custom ruleset is a
 * lobby-authored `ModeRules` object stored on the room, not authored content,
 * so it must never claim a content id (and must never demand a rank cost
 * column).
 */
export type ModeId =
  | "mode.quick"
  | "mode.standard"
  | "mode.marathon"
  | "mode.campaign";

export type GlobalEventId =
  | "globalEvent.audit-season"
  | "globalEvent.layoffs"
  | "globalEvent.budget-freeze"
  | "globalEvent.reorg"
  | "globalEvent.merger-rumour"
  | "globalEvent.bonus-season";

export type RankId =
  | "rank.intern"
  | "rank.staff"
  | "rank.senior-staff"
  | "rank.supervisor"
  | "rank.assistant-manager"
  | "rank.manager"
  | "rank.senior-manager"
  | "rank.general-manager"
  | "rank.director";

export type CharacterId =
  | "character.workaholic"
  | "character.social-butterfly"
  | "character.sales-star"
  | "character.tech-genius"
  | "character.office-politician"
  | "character.lucky-employee";

export type ResourceId = "money" | "reputation" | "energy";

export type TokenId = "move" | "momentum" | "reputation" | "money";

/**
 * A status id is only real when it lands in **three** places in the same change:
 * this union, `validStatusIds` in `src/validation/deadline-dash.ts`, and a real
 * engine consumer. An id that has the first two and not the third validates,
 * persists, and does nothing forever.
 *
 * The first six are the tile-authored statuses the engine already consumes. The
 * rest are the card vocabulary's, per the re-cut plan's §11.2.
 */
export type StatusId =
  | "status.audit"
  | "status.burnout-tile"
  | "status.ignore-next-work-energy"
  | "status.skip-next-tile-effect"
  | "status.next-roll-extra-movement"
  | "status.next-salary-multiplier"
  /** Multiplies the money award of the next work card. `×0` is an attack. */
  | "status.next-work-card-money-multiplier"
  /** As above, for reputation. */
  | "status.next-work-card-reputation-multiplier"
  /**
   * Reduces the reputation the next promotion costs. Reuses the discount path
   * `resolvePromotion` already has for Office Politician.
   */
  | "status.next-promotion-reputation-discount"
  /** Cancels the next negative money delta outright. */
  | "status.cancel-next-money-loss"
  /**
   * Drops the *positive* effects of the next networking card only. Dropping
   * everything would make the attack backfire roughly half the time.
   */
  | "status.skip-next-networking-reward"
  /** Mirror of `status.ignore-next-work-energy`: the next work card gives energy. */
  | "status.next-work-extra-energy"
  /** Scoped to the next meeting card's energy line. */
  | "status.ignore-next-meeting-energy";
