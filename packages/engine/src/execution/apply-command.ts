import type {
  ExpireWindowCommand,
  GameCommand,
  GameCommandType,
  RollTurnCommand,
  TakeTurnActionCommand,
  TurnTimeoutCommand,
} from "../commands";
import type { DecisionPointId, GameState, PlayerId } from "../model";
import {
  activateCharacter,
  adjustRoll,
  commitEndingTurn,
  createEventCollector,
  payAuditFine,
  pushMarker,
  shuffleManagementDeck,
} from "./agency";
import { offerAgreement, respondToAgreement } from "./agreements";
import { findAttackWindow, resolveAttackWindow, targetAttack } from "./attack";
import { castBallot, expireBallot, isBallotDecisionPoint, isSeatedActor } from "./ballots";
import { rejectCommand } from "./errors";
import { takeTurnAction } from "./free-action";
import { repayLoan, takeLoan } from "./loans";
import { placePlacement } from "./placements";
import { playCard, spendToken } from "./play-card";
import {
  attemptPromotion,
  blockPromotion,
  declinePromotion,
  resolvePendingPromotion,
} from "./promotion-choice";
import { contributeToProject, sabotageProject, startProject } from "./projects";
import { advanceQuarter } from "./quarters";
import { expireWindow, passReaction, playReaction } from "./reaction-window";
import { respondToPrompt } from "./respond-to-prompt";
import { revealRole } from "./roles";
import { rollTurn } from "./roll-turn";
import { startGame } from "./start-game";
import { claimTile, upgradeTile } from "./tile-ownership";
import type { TransitionContext, TransitionResult } from "./types";

/**
 * The command router.
 *
 * Two jobs, and deliberately only two. It owns the checks that are **identical
 * for every command** — the envelope (game id, idempotency, revision), the
 * lifecycle (is this game accepting commands at all), and the two structural
 * authorisation rules the transitions cannot see from inside themselves:
 * a server-injected command must not come from a seat, and a player command
 * must come from one. Everything else — affordability, mode gating, per-mechanic
 * entitlement — belongs to the transition, which re-checks its own preconditions
 * precisely so it stays safe when something other than this file calls it.
 *
 * What it must NOT do is duplicate a mechanic's gate. `state.rules` is read here
 * only where the rule is about the *command envelope* (`turn.timeout`'s
 * behaviour), never to decide whether a mechanic is switched on: that answer
 * lives in exactly one place per mechanic and two copies of it will drift.
 */

function assertNever(value: never): never {
  throw new TypeError(`Unexpected command: ${String(value)}`);
}

/**
 * The `turn.action` verb that reveals the actor's own role.
 *
 * There is no `role.reveal` command in the union, and `execution/roles.ts` — the
 * module that owns the transition — declares no id for it either, so the router
 * owns the string. Exported because `legal-actions.ts` has to advertise exactly
 * the same value; two spellings of it would make the action unreachable from the
 * UI while still being accepted by the engine.
 */
export const ROLE_REVEAL_ACTION = "role.reveal";

/**
 * Every command type the union declares. Checked before the actor lookup so an
 * unknown type is reported as a malformed command rather than as an unknown
 * player — a client that sends garbage should not be told anything about the
 * table.
 */
const COMMAND_TYPES: Readonly<Record<GameCommandType, true>> = {
  "game.start": true,
  "turn.roll": true,
  "turn.play-card": true,
  "turn.activate-character": true,
  "turn.spend-token": true,
  "prompt.respond": true,
  "reaction.play": true,
  "reaction.pass": true,
  "audit.pay-fine": true,
  "promotion.attempt": true,
  "management.shuffle-deck": true,
  "management.block-promotion": true,
  "turn.timeout": true,
  "turn.adjust-roll": true,
  "turn.action": true,
  "promotion.decline": true,
  "tile.claim": true,
  "tile.upgrade": true,
  "placement.place": true,
  "project.start": true,
  "project.contribute": true,
  "project.sabotage": true,
  "agreement.offer": true,
  "agreement.respond": true,
  "attack.target": true,
  "ballot.cast": true,
  "loan.take": true,
  "loan.repay": true,
  "window.expire": true,
  "quarter.advance": true,
};

function isKnownCommandType(type: string): type is GameCommandType {
  return Object.hasOwn(COMMAND_TYPES, type);
}

/**
 * The commands the server injects and a player may never send (spec §7.1, §6.3).
 *
 * The engine's only signal that a command came from the scheduler rather than a
 * browser is that its `actorId` is not a seat at this table, so the rule is
 * inverted for these three: an actor that *is* a player is the rejection. Each
 * transition re-checks the same predicate; this is the belt to their braces, and
 * it is also what exempts them from the `ACTOR_NOT_FOUND` guard that would
 * otherwise reject every legitimate expiry before it ran.
 */
const SERVER_INJECTED: Readonly<Record<string, true>> = {
  "window.expire": true,
  "quarter.advance": true,
  "turn.timeout": true,
};

function isServerInjected(type: GameCommandType): boolean {
  return Object.hasOwn(SERVER_INJECTED, type);
}

/**
 * Commands that are answers to pending engine work, or that are out-of-turn by
 * design, and therefore must not be blocked by it.
 *
 * The old guard blocked everything except `prompt.respond` whenever *any*
 * reaction window was open. That is a deadlock: an open window is answered by
 * `reaction.play`/`reaction.pass`/`window.expire`, so blocking those made the
 * window unanswerable and wedged the match permanently. The exemptions fall into
 * three groups:
 *
 * - **Answers to the block itself**: `prompt.respond`, `audit.pay-fine` (which
 *   *is* the audit prompt's `pay-fine` branch as a first-class verb),
 *   `reaction.play`/`reaction.pass`, `management.block-promotion`,
 *   `window.expire`, `quarter.advance`.
 * - **Multi-party verbs that exist to remove dead time** (spec §7.3): a ballot
 *   is supposed to run *while* something else resolves, and a trade offer that
 *   could only be made when the board was completely quiet would almost never be
 *   makeable.
 * - **Loans**, because borrowing to afford the fine the prompt is asking for is
 *   the single most compelling case for acting while blocked.
 */
const PENDING_WORK_EXEMPT: Readonly<Record<string, true>> = {
  "prompt.respond": true,
  "audit.pay-fine": true,
  "reaction.play": true,
  "reaction.pass": true,
  "management.block-promotion": true,
  "window.expire": true,
  "quarter.advance": true,
  "ballot.cast": true,
  "agreement.offer": true,
  "agreement.respond": true,
  "loan.take": true,
  "loan.repay": true,
};

function isPendingWorkExempt(command: GameCommand): boolean {
  // Revealing your own role is a social move whose whole value is taking it in
  // the middle of somebody else's decision, and `revealRole` deliberately does
  // not require the turn. It rides on `turn.action`, so the exemption has to
  // read the payload rather than the type.
  if (command.type === "turn.action") {
    return command.payload.action === ROLE_REVEAL_ACTION;
  }

  return Object.hasOwn(PENDING_WORK_EXEMPT, command.type);
}

function hasPendingWork(state: GameState, actorId: PlayerId): boolean {
  return (
    state.resolutionStack.length > 0 ||
    state.pendingEffects.length > 0 ||
    state.reactionWindows.length > 0 ||
    state.prompts.some((prompt) => prompt.audience.includes(actorId))
  );
}

/* ------------------------------------------------------------------ *
 * Window closing
 * ------------------------------------------------------------------ */

/**
 * Runs a reaction transition and, when it closed a window that the reaction
 * layer cannot settle on its own, finishes the job.
 *
 * `reaction-window.ts` owns the *lifecycle* — who is eligible, who has answered,
 * when the window closes — and settles the effect it was guarding through
 * `applyPendingEffect`, which speaks only the v1 effect vocabulary. Two window
 * kinds park something richer than that:
 *
 * - an **attack** (`attack.ts` writes `{ type: "attack.target", … }`), which
 *   needs the vector priced and the damage moved;
 * - a **promotion block** (`promotion-choice.ts`), where nobody blocking means
 *   the promotion must actually go through, re-checking affordability.
 *
 * In both cases the reaction layer's close is correct except that it applies
 * nothing, so this re-presents the window to its real owner on the
 * already-responded state. It only does so when the window genuinely closed and
 * nobody prevented it — a countered attack and a blocked promotion are already
 * complete once `EffectPrevented` is on the wire.
 *
 * The revision is rewound to the pre-command value before handing over, because
 * the owning transition bumps it itself; composing two bumps would report two
 * commands for one.
 */
function closingThrough(
  state: GameState,
  command: GameCommand,
  context: TransitionContext,
  decisionPointId: DecisionPointId,
  run: () => TransitionResult,
): TransitionResult {
  const window = state.reactionWindows.find((candidate) => candidate.id === decisionPointId);
  const attack = findAttackWindow(state, decisionPointId);
  const pending =
    window?.pendingEffectId == null
      ? undefined
      : state.pendingEffects.find((candidate) => candidate.id === window.pendingEffectId);

  const result = run();
  if (!result.ok || window === undefined || pending === undefined) return result;

  const next = result.value.state;
  const stillOpen = next.reactionWindows.some((candidate) => candidate.id === window.id);
  if (stillOpen) return result;

  const prevented = result.value.events.some(
    (event) => event.type === "EffectPrevented" && event.payload.effectId === pending.id,
  );
  if (prevented) return result;

  const reopened: GameState = {
    ...next,
    revision: state.revision,
    reactionWindows: [...next.reactionWindows, window],
    pendingEffects: [...next.pendingEffects, pending],
  };

  const settled =
    attack !== null
      ? resolveAttackWindow(
          reopened,
          command,
          { decisionPointId, prevented: false, preventedByPlayerId: null },
          context,
        )
      : window.kind === "promotion-block"
        ? resolvePendingPromotion(reopened, command, decisionPointId, context)
        : null;

  // A window guarding an ordinary v1 effect is already fully settled by the
  // reaction layer; so is one whose owner refuses it (a lapsed promotion the
  // player can no longer afford resolves inside `resolvePendingPromotion`, and
  // anything else is not ours to force).
  if (settled === null || !settled.ok) return result;

  return {
    ok: true,
    value: {
      state: settled.value.state,
      events: [...result.value.events, ...settled.value.events],
    },
  };
}

/**
 * `window.expire` — one command id, four resolvables behind it.
 *
 * Ballots, promotion blocks, attack defences and plain prevention windows all
 * hang off a `decisionPointId`, so the dispatcher is the only place that can
 * tell them apart. Order matters: a ballot is not in `state.reactionWindows` at
 * all, and a promotion block is settled by its own owner rather than by the
 * generic close, so both are checked before the reaction layer sees it.
 */
function expireDecisionPoint(
  state: GameState,
  command: ExpireWindowCommand,
  context: TransitionContext,
): TransitionResult {
  const decisionPointId = command.payload.decisionPointId;

  if (isBallotDecisionPoint(state, decisionPointId)) {
    return expireBallot(state, command, context);
  }

  const window = state.reactionWindows.find((candidate) => candidate.id === decisionPointId);
  if (window?.kind === "promotion-block") {
    return resolvePendingPromotion(state, command, decisionPointId, context);
  }

  return closingThrough(state, command, context, decisionPointId, () =>
    expireWindow(state, command, context),
  );
}

/* ------------------------------------------------------------------ *
 * turn.timeout
 * ------------------------------------------------------------------ */

/**
 * The turn clock running out (spec §7.1), driven entirely by
 * `rules.timers.onTimeout`.
 *
 * The engine holds no timer: the server fires at `TurnState.deadlineAt` and
 * submits this like any other command. The behaviour is a mode setting, not a
 * constant — `auto-roll` takes the turn's forced move, `auto-pass` hands the
 * turn on without one.
 *
 * `best-move` currently resolves as `auto-roll`. That is honest rather than
 * ideal: choosing between twenty-eight verbs on a player's behalf needs a policy
 * (the server already has one for bots), and inventing a worse one here would
 * make a timeout play *differently* from a bot in the same seat.
 *
 * The active player's own id is put on the delegated command, because every
 * transition reads `command.actorId` as "whose turn is this" — the server acts
 * on their behalf, it does not act as itself.
 */
function timeoutTurn(
  state: GameState,
  command: TurnTimeoutCommand,
  context: TransitionContext,
): TransitionResult {
  const activePlayerId = state.turn.activePlayerId;
  if (activePlayerId === null) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "No turn is running, so none can time out",
    });
  }
  const player = state.players[activePlayerId];
  if (player === undefined) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "The active player is missing from canonical player state",
    });
  }
  // A prompt the active player owes an answer to is not something a timeout may
  // guess at: `PromptState.defaultResponse` exists for exactly this and belongs
  // to the prompt layer, which does not implement it yet.
  if (state.prompts.some((prompt) => prompt.audience.includes(activePlayerId))) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "A prompt addressed to the active player must be answered before the turn ends",
    });
  }

  const onBehalf = { ...command, actorId: activePlayerId };

  if (state.rules.timers.onTimeout === "auto-pass") {
    const collector = createEventCollector(state, onBehalf, context);
    pushMarker(
      state,
      collector,
      { kind: "turn.timeout", playerId: activePlayerId, behaviour: "auto-pass" },
      [activePlayerId],
    );

    return commitEndingTurn(state, onBehalf, context, collector, player);
  }

  if (state.turn.phase !== "pre-roll") {
    return rejectCommand(state, command, {
      code: "INVALID_PHASE",
      message: "A timeout can only force the roll during pre-roll",
    });
  }

  const forcedRoll: RollTurnCommand = {
    commandId: command.commandId,
    gameId: command.gameId,
    actorId: activePlayerId,
    expectedRevision: command.expectedRevision,
    type: "turn.roll",
    payload: {},
  };

  return rollTurn(state, forcedRoll, context);
}

/* ------------------------------------------------------------------ *
 * turn.action
 * ------------------------------------------------------------------ */

/**
 * `turn.action` carries two different mechanics behind one payload string: the
 * free-action economy (work / network / scheme / rest) and the role reveal,
 * which has no command of its own in the union. `free-action.ts` rejects
 * anything that is not one of its four verbs, so the reveal has to be routed
 * before it.
 *
 * The route layer must pin identity here too (spec §11.1): `revealRole` is told
 * the target is the actor and rejects any mismatch, so a client cannot reveal
 * somebody else's role even if a payload later grows a target field.
 */
function takeAction(
  state: GameState,
  command: TakeTurnActionCommand,
  context: TransitionContext,
): TransitionResult {
  if (command.payload.action === ROLE_REVEAL_ACTION) {
    return revealRole(state, command, context, { targetPlayerId: command.actorId });
  }

  return takeTurnAction(state, command, context);
}

/* ------------------------------------------------------------------ *
 * applyCommand
 * ------------------------------------------------------------------ */

export function applyCommand(
  state: GameState,
  command: GameCommand,
  context: TransitionContext,
): TransitionResult {
  if (command.gameId !== state.gameId) {
    return rejectCommand(state, command, {
      code: "INVALID_COMMAND",
      message: "Command targets a different game",
    });
  }
  if (command.commandId === state.lastCommandId) {
    return rejectCommand(state, command, {
      code: "INVALID_COMMAND",
      message: "Command was already applied",
    });
  }
  if (command.expectedRevision !== state.revision) {
    return rejectCommand(state, command, {
      code: "STALE_REVISION",
      message: "Command revision does not match the current state",
      details: {
        expectedRevision: command.expectedRevision,
        currentRevision: state.revision,
      },
    });
  }
  if (!isKnownCommandType(command.type)) {
    return rejectCommand(state, command, {
      code: "INVALID_COMMAND",
      message: "Command type is not supported by this execution slice",
    });
  }

  const serverInjected = isServerInjected(command.type);
  if (serverInjected) {
    // Inverted on purpose (spec §6.3): a seat sending one of these is the
    // attack — a player who could expire a window could close it the instant it
    // opened and deny the table its say.
    if (isSeatedActor(state, command.actorId)) {
      return rejectCommand(state, command, {
        code: "ACTOR_NOT_AUTHORIZED",
        message: "This command is server-injected and is never accepted from a player",
      });
    }
  } else if (state.players[command.actorId] === undefined) {
    return rejectCommand(state, command, {
      code: "ACTOR_NOT_FOUND",
      message: "Command actor is not a player in this game",
    });
  }

  if (command.type === "game.start" && state.startAuthorizedPlayerId !== command.actorId) {
    return rejectCommand(state, command, {
      code: "ACTOR_NOT_AUTHORIZED",
      message: "Only the authorized starter can start the game",
    });
  }
  if (
    (command.type === "turn.roll" || command.type === "prompt.respond") &&
    state.turn.activePlayerId !== command.actorId
  ) {
    return rejectCommand(state, command, {
      code: "NOT_ACTOR_TURN",
      message: "Only the active player can act",
    });
  }

  // A window still open when the match ends must still be drainable, or it sits
  // in every projection forever with nothing able to close it.
  const drainable = command.type === "window.expire";
  if (state.status === "ended" && !drainable) {
    return rejectCommand(state, command, {
      code: "GAME_ALREADY_ENDED",
      message: "The game has already ended",
    });
  }
  if (state.status !== "setup" && state.status !== "active" && !drainable) {
    return rejectCommand(state, command, {
      code: "GAME_NOT_ACTIVE",
      message: "The game cannot currently accept commands",
    });
  }
  if (command.type === "game.start" && state.status !== "setup") {
    return rejectCommand(state, command, {
      code: "GAME_NOT_ACTIVE",
      message: "Only a setup game can be started",
    });
  }
  if (command.type === "game.start" && state.turn.phase !== "not-started") {
    return rejectCommand(state, command, {
      code: "INVALID_PHASE",
      message: "The game has already left the not-started phase",
    });
  }
  // Every verb except starting the game needs a running match. This used to be
  // checked for `turn.roll` alone, which left twenty-seven newer commands able
  // to run against a game still in setup.
  if (command.type !== "game.start" && !drainable && state.status !== "active") {
    return rejectCommand(state, command, {
      code: "GAME_NOT_ACTIVE",
      message: "The game cannot currently accept commands",
    });
  }
  if (command.type === "turn.roll" && state.turn.phase !== "pre-roll") {
    return rejectCommand(state, command, {
      code: "INVALID_PHASE",
      message: "Dice can only be rolled during pre-roll",
    });
  }
  if (!isPendingWorkExempt(command) && hasPendingWork(state, command.actorId)) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "Pending engine work blocks this command",
    });
  }

  switch (command.type) {
    case "game.start":
      return startGame(state, command, context);
    case "turn.roll":
      return rollTurn(state, command, context);
    case "turn.timeout":
      return timeoutTurn(state, command, context);
    case "turn.adjust-roll":
      return adjustRoll(state, command, context);
    case "turn.action":
      return takeAction(state, command, context);
    case "turn.play-card":
      return playCard(state, command, context);
    case "turn.spend-token":
      return spendToken(state, command, context);
    case "turn.activate-character":
      return activateCharacter(state, command, context);
    case "prompt.respond":
      return respondToPrompt(state, command, context);
    case "audit.pay-fine":
      return payAuditFine(state, command, context);
    case "promotion.attempt":
      return attemptPromotion(state, command, context);
    case "promotion.decline":
      return declinePromotion(state, command, context);
    case "management.shuffle-deck":
      return shuffleManagementDeck(state, command, context);
    case "management.block-promotion":
      return blockPromotion(state, command, context);
    case "reaction.play":
      return closingThrough(state, command, context, command.decisionPointId, () =>
        playReaction(state, command, context),
      );
    case "reaction.pass":
      return closingThrough(state, command, context, command.decisionPointId, () =>
        passReaction(state, command, context),
      );
    case "tile.claim":
      return claimTile(state, command, context);
    case "tile.upgrade":
      return upgradeTile(state, command, context);
    case "placement.place":
      return placePlacement(state, command, context);
    case "project.start":
      return startProject(state, command, context);
    case "project.contribute":
      return contributeToProject(state, command, context);
    case "project.sabotage":
      return sabotageProject(state, command, context);
    case "agreement.offer":
      return offerAgreement(state, command, context);
    case "agreement.respond":
      return respondToAgreement(state, command, context);
    case "attack.target":
      return targetAttack(state, command, context);
    case "ballot.cast":
      return castBallot(state, command, context);
    case "loan.take":
      return takeLoan(state, command, context);
    case "loan.repay":
      return repayLoan(state, command, context);
    case "window.expire":
      return expireDecisionPoint(state, command, context);
    case "quarter.advance":
      return advanceQuarter(state, command, context);
    default:
      return assertNever(command);
  }
}
