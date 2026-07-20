export type TileId = `tile.board.${string}`;

export type DeckId =
  | "deck.work"
  | "deck.meeting"
  | "deck.event"
  | "deck.networking"
  | "deck.board-meeting"
  | "deck.annual-event";

export type ModeId = "mode.quick" | "mode.marathon";

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
