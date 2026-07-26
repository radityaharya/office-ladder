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

export type StatusId =
  | "status.audit"
  | "status.burnout-tile"
  | "status.ignore-next-work-energy"
  | "status.skip-next-tile-effect"
  | "status.next-roll-extra-movement"
  | "status.next-salary-multiplier";
