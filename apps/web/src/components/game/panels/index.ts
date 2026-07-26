/**
 * The rail's panel kit.
 *
 * One panel primitive, the tab chrome that hosts it, the shared row grammar, one
 * semantic vocabulary for v2's new state, one derivation from the projection, and
 * the twelve destinations `plans/24-gameplay-v2-spec.md` §8.5 asks for.
 *
 * **The two things a host needs from here.** `derivePanelData({ bootstrap })`
 * turns one `GameplayBootstrap` into every destination's props, and `PanelHost`
 * renders a tab strip over one of them. Nothing else in this barrel has to be
 * understood to wire the rail up — that is deliberate, because a host that
 * assembles eleven panels by hand is a host that will read
 * `bootstrap.gameplay.ballots[].castBy` one day.
 *
 * Import from this barrel (`@/components/game/panels`) rather than from a panel
 * module directly, so the kit's surface stays reviewable in one place.
 */

export {
  Panel,
  PanelAttentionBadge,
  type PanelAttention,
  type PanelChrome,
  type PanelSizing,
} from "./panel";
export { PanelHost } from "./panel-host";
export { PanelTabs, type PanelTab } from "./panel-tabs";
export {
  PANEL_DEFINITIONS,
  PANEL_DEFINITION_LIST,
  PANEL_IDS,
  isPanelId,
  panelDomId,
  panelHeadingDomId,
  panelTabDomId,
  type PanelDefinition,
  type PanelId,
} from "./panel-registry";
export {
  PanelDef,
  PanelDefs,
  PanelEmpty,
  PanelFacts,
  PanelLed,
  PanelList,
  PanelMeter,
  PanelNote,
  PanelRow,
  PanelSeatGlyph,
  PanelStamp,
  panelSeatClass,
  type PanelOrigin,
  type PanelRowState,
  type PanelTone,
} from "./panel-parts";
export {
  PANEL_SEMANTIC_COPY,
  PanelDeadline,
  panelDeadlineLabel,
  panelDeadlineUrgency,
  panelDebtFact,
  panelIncomeFact,
  panelPressureFact,
  panelRoundsLeft,
  panelUpkeepArrearsFact,
  panelUpkeepFact,
  panelUpkeepSentence,
  type PanelDeadlinePhrasing,
  type PanelUpkeepReadout,
  type PanelUrgency,
} from "./panel-semantics";
export {
  createPanelViewerContext,
  derivePanelAgreements,
  derivePanelBallots,
  derivePanelData,
  derivePanelEvents,
  derivePanelHand,
  derivePanelHeat,
  derivePanelMarketLots,
  derivePanelObjectives,
  derivePanelProjects,
  derivePanelQuarters,
  derivePanelSeats,
  type PanelData,
  type PanelDataInput,
  type PanelViewerContext,
} from "./panel-data";
export {
  formatPanelMoney,
  formatPanelMoneyProgress,
  formatPanelNumber,
  formatPanelProgress,
  formatPanelRound,
  formatPanelSigned,
  formatPanelSignedMoney,
  panelClock,
  panelDeltaSign,
  panelMeterPercent,
  panelMeterState,
  pluralise,
} from "./panel-format";

export {
  SeatsPanel,
  seatsAttention,
  type SeatEconomy,
  type SeatPanelRow,
} from "./seats-panel";
export { ActivityPanel, type ActivityPanelEntry } from "./activity-panel";
export { EventsPanel, type EventFeedItem } from "./events-panel";
export {
  HandPanel,
  type HandCardView,
  type OpponentHandCount,
} from "./hand-panel";
export {
  ProjectsPanel,
  type ProjectPanelItem,
  type ProjectPanelStatus,
  type RevealedSabotage,
} from "./projects-panel";
export {
  MarketPanel,
  type MarketBid,
  type MarketLot,
  type MarketLotKind,
} from "./market-panel";
export {
  AgreementsPanel,
  agreementsAttention,
  type AgreementPanelItem,
  type AgreementPanelStatus,
  type AgreementTerm,
} from "./agreements-panel";
export {
  BallotsPanel,
  ballotsAttention,
  type BallotCast,
  type BallotKind,
  type BallotPanelItem,
} from "./ballots-panel";
export {
  ObjectivesPanel,
  type ConcealedObjective,
  type ObjectivePanelItem,
  type VisibleObjective,
} from "./objectives-panel";
export {
  HeatPanel,
  heatAttention,
  type HeatSeatReadout,
  type HeatSelfReadout,
} from "./heat-panel";
export {
  ChatPanel,
  DEFAULT_QUICK_PHRASES,
  type ChatMessageView,
  type ChatMode,
  type QuickPhrase,
} from "./chat-panel";
export {
  QuarterPanel,
  quarterSummary,
  type QuarterAnnouncement,
  type QuarterState,
  type QuarterStep,
} from "./quarter-panel";
