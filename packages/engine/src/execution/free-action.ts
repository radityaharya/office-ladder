import type { TakeTurnActionCommand } from "../commands";
import type { GameState, ModeRules, PlayerId, PlayerState } from "../model";
import {
  commit,
  consumeTurnActions,
  createEventCollector,
  findResourceEntry,
  pushMarker,
  pushResourceChanged,
  raiseHeat,
  requireTurnActor,
  turnActionBudget,
  writeResource,
} from "./agency";
import { rejectCommand } from "./errors";
import type { TransitionContent, TransitionContext, TransitionResult } from "./types";

/**
 * The four turn verbs.
 *
 * They are deliberately four *different shapes*, not four flavours of "gain a
 * resource" — a menu of gains is not a decision, it is arithmetic:
 *
 * | verb | you spend | you get | only this verb |
 * | --- | --- | --- | --- |
 * | `work` | energy | money, scaled by your rank | advances the work counter |
 * | `network` | money, at the ladder's own price of reputation | reputation | buys the resource money otherwise cannot |
 * | `scheme` | energy **and heat** | reputation taken off an opponent | reaches another player, and is the only verb with a downside |
 * | `rest` | the rest of the turn's actions | energy back to full | pays in tempo rather than in a resource |
 *
 * So the interesting turn is the one where they conflict: work is the safe
 * grind, network converts a lead in money into the thing promotion actually
 * gates on, scheme is the only way to take instead of earn and it is priced in
 * suspicion, and rest is the answer to burnout that costs you the turn's other
 * options.
 */
export type FreeActionKind = "work" | "network" | "scheme" | "rest";

export const FREE_ACTION_KINDS: readonly FreeActionKind[] = [
  "work",
  "network",
  "scheme",
  "rest",
];

export function isFreeActionKind(value: string): value is FreeActionKind {
  return (FREE_ACTION_KINDS as readonly string[]).includes(value);
}

/**
 * The two shape constants the action economy needs that `ModeRules` has no
 * field for.
 *
 * Everything else about a free action is derived from state or content: its
 * energy price is `rules.agency.energyPerPip` (the mode's own price of one pip
 * of agency), `work`'s payout scales with the authored salary of the actor's
 * rank, `network`'s price is the *ladder's* price of a reputation point in this
 * mode, and `scheme`'s heat is `rules.conflict.heatPerAttack`. These two are the
 * residue, and they are the natural candidates for `agency` tunables in a
 * follow-up — see the return notes.
 */
export const FREE_ACTION_TUNING = {
  /**
   * `work` pays a quarter of a rank's salary. A lap of the board pays a whole
   * salary, so one action is worth roughly one turn's share of a lap — enough to
   * matter, far short of replacing movement.
   */
  workSalaryDivisor: 4,
  /** Reputation moves one point at a time; it is the scarce, gating resource. */
  reputationStep: 1,
} as const;

export type FreeActionPrices = {
  readonly energyCost: number;
  readonly workPayout: number;
  readonly reputationPrice: number;
  readonly reputationStep: number;
};

function rankSalary(player: PlayerState, content: TransitionContent): number {
  const rank = content.ranks.find((candidate) => candidate.id === player.rank.kind);

  return rank?.salary ?? 0;
}

/**
 * What a point of reputation costs in money, taken from the promotion the actor
 * is actually working towards.
 *
 * This is why `network` gets more expensive as you climb: the ladder's own
 * `moneyCost` per `reputationRequired` is the market rate, it is authored per
 * mode, and it means a networking economy never needs its own price table. At
 * the top of the ladder there is no next rung, so the last promotable rung's
 * rate stands in.
 */
function reputationPrice(
  player: PlayerState,
  content: TransitionContent,
  modeId: string,
): number {
  const current = content.ranks.find((candidate) => candidate.id === player.rank.kind);
  const promotable = content.ranks.filter(
    (candidate) => candidate.promotionFromPrevious !== null,
  );
  const next =
    current === undefined
      ? undefined
      : promotable.find((candidate) => candidate.tier === current.tier + 1);
  const rung = next ?? promotable[promotable.length - 1];
  if (rung === undefined || rung.promotionFromPrevious === null) return 0;

  const requirement = rung.promotionFromPrevious;
  const cost =
    requirement.moneyCost[modeId as keyof typeof requirement.moneyCost] ??
    requirement.moneyCost["mode.quick"];
  const required = Math.max(1, requirement.reputationRequired);

  return Math.max(1, Math.ceil(cost / required));
}

/**
 * Every price a free action can charge, resolved from the mode's rules and the
 * content pack for one player at one moment. Exported so a bot policy, a legal
 * action or a UI panel can show the same numbers the transition will charge.
 */
export function resolveFreeActionPrices(
  state: GameState,
  player: PlayerState,
  content: TransitionContent,
): FreeActionPrices {
  return {
    // Never free, however the mode prices a pip: an action that costs nothing is
    // an action nobody has to think about.
    energyCost: Math.max(1, Math.floor(state.rules.agency.energyPerPip)),
    workPayout: Math.max(
      1,
      Math.floor(rankSalary(player, content) / FREE_ACTION_TUNING.workSalaryDivisor),
    ),
    reputationPrice: reputationPrice(player, content, state.modeId),
    reputationStep: FREE_ACTION_TUNING.reputationStep,
  };
}

/** How many free actions the player has left this turn. */
export function freeActionsRemaining(state: GameState, player: PlayerState): number {
  return turnActionBudget(state, player).remaining;
}

/** Which of the four verbs this mode allows at all. */
export function enabledFreeActions(rules: ModeRules): readonly FreeActionKind[] {
  if (rules.agency.freeActionsPerTurn <= 0) return [];

  return FREE_ACTION_KINDS.filter(
    (kind) => kind !== "scheme" || rules.conflict.targetedAttacks,
  );
}

/**
 * `turn.action` — the direct answer to "the only verb is roll".
 *
 * The whole mechanic is switched off by `rules.agency.freeActionsPerTurn: 0`,
 * and `scheme` additionally by `rules.conflict.targetedAttacks: false`.
 */
export function takeTurnAction(
  state: GameState,
  command: TakeTurnActionCommand,
  context: TransitionContext,
): TransitionResult {
  const guard = requireTurnActor(state, command);
  if (!guard.ok) return guard.rejection;

  const action = command.payload.action;
  if (!isFreeActionKind(action)) {
    return rejectCommand(state, command, {
      code: "INVALID_COMMAND",
      message: "Unknown turn action",
      details: { action, legal: [...FREE_ACTION_KINDS] },
    });
  }

  const player = guard.player;
  const budget = turnActionBudget(state, player);
  if (budget.perTurn <= 0) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This mode grants no turn actions",
    });
  }
  if (budget.remaining <= 0) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "No turn actions remain this turn",
    });
  }

  const prices = resolveFreeActionPrices(state, player, context.content);
  const collector = createEventCollector(state, command, context);
  const others: Record<string, PlayerState> = {};
  const affected: PlayerId[] = [player.id];
  let actor = player;
  let spend = 1;

  switch (action) {
    case "work": {
      const energy = findResourceEntry(actor, "resource.energy");
      const money = findResourceEntry(actor, "resource.money");
      const counter = findResourceEntry(actor, "resource.work-counter");
      if (energy === null || money === null) {
        return rejectCommand(state, command, {
          code: "INVARIANT_VIOLATION",
          message: "Working needs canonical energy and money state",
        });
      }
      if (energy[1].value < prices.energyCost) {
        return rejectCommand(state, command, {
          code: "INSUFFICIENT_RESOURCE",
          message: "Not enough energy to work",
          details: { cost: prices.energyCost, available: energy[1].value },
        });
      }
      const spent = writeResource(
        actor,
        energy[0],
        energy[1],
        energy[1].value - prices.energyCost,
      );
      actor = spent.player;
      pushResourceChanged(
        collector,
        actor.id,
        spent.resource,
        spent.previousValue,
        spent.newValue,
        "turn-action-work",
      );
      const paid = writeResource(
        actor,
        money[0],
        money[1],
        money[1].value + prices.workPayout,
      );
      actor = paid.player;
      pushResourceChanged(
        collector,
        actor.id,
        paid.resource,
        paid.previousValue,
        paid.newValue,
        "turn-action-work",
      );
      if (counter !== null) {
        const advanced = writeResource(
          actor,
          counter[0],
          counter[1],
          counter[1].value + 1,
        );
        actor = advanced.player;
        pushResourceChanged(
          collector,
          actor.id,
          advanced.resource,
          advanced.previousValue,
          advanced.newValue,
          "turn-action-work",
        );
      }
      break;
    }
    case "network": {
      const money = findResourceEntry(actor, "resource.money");
      const reputation = findResourceEntry(actor, "resource.reputation");
      if (money === null || reputation === null) {
        return rejectCommand(state, command, {
          code: "INVARIANT_VIOLATION",
          message: "Networking needs canonical money and reputation state",
        });
      }
      if (money[1].value < prices.reputationPrice) {
        return rejectCommand(state, command, {
          code: "INSUFFICIENT_RESOURCE",
          message: "Not enough money to network",
          details: { cost: prices.reputationPrice, available: money[1].value },
        });
      }
      const paid = writeResource(
        actor,
        money[0],
        money[1],
        money[1].value - prices.reputationPrice,
      );
      actor = paid.player;
      pushResourceChanged(
        collector,
        actor.id,
        paid.resource,
        paid.previousValue,
        paid.newValue,
        "turn-action-network",
      );
      const gained = writeResource(
        actor,
        reputation[0],
        reputation[1],
        reputation[1].value + prices.reputationStep,
      );
      actor = gained.player;
      pushResourceChanged(
        collector,
        actor.id,
        gained.resource,
        gained.previousValue,
        gained.newValue,
        "turn-action-network",
      );
      break;
    }
    case "scheme": {
      if (!state.rules.conflict.targetedAttacks) {
        return rejectCommand(state, command, {
          code: "ILLEGAL_ACTION",
          message: "This mode does not allow targeting another player",
        });
      }
      const targetIds = command.payload.targetPlayerIds;
      if (targetIds.length !== 1) {
        return rejectCommand(state, command, {
          code: "INVALID_COMMAND",
          message: "Scheming needs exactly one target",
        });
      }
      const targetId = targetIds[0];
      if (targetId === command.actorId) {
        return rejectCommand(state, command, {
          code: "INVALID_COMMAND",
          message: "Scheming cannot target its own actor",
        });
      }
      const target = state.players[targetId];
      if (target === undefined || state.eliminatedPlayerIds.includes(targetId)) {
        return rejectCommand(state, command, {
          code: "INVALID_COMMAND",
          message: "Target is not a player in this game",
        });
      }
      const energy = findResourceEntry(actor, "resource.energy");
      const actorReputation = findResourceEntry(actor, "resource.reputation");
      const targetReputation = findResourceEntry(target, "resource.reputation");
      if (energy === null || actorReputation === null || targetReputation === null) {
        return rejectCommand(state, command, {
          code: "INVARIANT_VIOLATION",
          message: "Scheming needs canonical energy and reputation state",
        });
      }
      if (energy[1].value < prices.energyCost) {
        return rejectCommand(state, command, {
          code: "INSUFFICIENT_RESOURCE",
          message: "Not enough energy to scheme",
          details: { cost: prices.energyCost, available: energy[1].value },
        });
      }
      const amount = Math.min(prices.reputationStep, targetReputation[1].value);
      if (amount <= 0) {
        return rejectCommand(state, command, {
          code: "ILLEGAL_ACTION",
          message: "The target has no reputation to take",
        });
      }
      const spentEnergy = writeResource(
        actor,
        energy[0],
        energy[1],
        energy[1].value - prices.energyCost,
      );
      actor = spentEnergy.player;
      pushResourceChanged(
        collector,
        actor.id,
        spentEnergy.resource,
        spentEnergy.previousValue,
        spentEnergy.newValue,
        "turn-action-scheme",
      );
      const taken = writeResource(
        target,
        targetReputation[0],
        targetReputation[1],
        targetReputation[1].value - amount,
      );
      others[target.id] = taken.player;
      affected.push(target.id);
      pushResourceChanged(
        collector,
        target.id,
        taken.resource,
        taken.previousValue,
        taken.newValue,
        "turn-action-schemed-against",
      );
      const gained = writeResource(
        actor,
        actorReputation[0],
        actorReputation[1],
        actorReputation[1].value + amount,
      );
      actor = gained.player;
      pushResourceChanged(
        collector,
        actor.id,
        gained.resource,
        gained.previousValue,
        gained.newValue,
        "turn-action-scheme",
      );
      // Spec §10.4: an aggressive effect that costs the aggressor nothing
      // collapses the game into alpha-striking whoever is ahead.
      actor = raiseHeat(actor, state.rules, state.turn.round);
      break;
    }
    case "rest": {
      const energy = findResourceEntry(actor, "resource.energy");
      if (energy === null || energy[1].maximum === null) {
        return rejectCommand(state, command, {
          code: "INVARIANT_VIOLATION",
          message: "Resting needs an energy resource with a maximum",
        });
      }
      if (energy[1].value >= energy[1].maximum) {
        return rejectCommand(state, command, {
          code: "ILLEGAL_ACTION",
          message: "The actor is already at full energy",
        });
      }
      const restored = writeResource(actor, energy[0], energy[1], energy[1].maximum);
      actor = restored.player;
      pushResourceChanged(
        collector,
        actor.id,
        restored.resource,
        restored.previousValue,
        restored.newValue,
        "turn-action-rest",
      );
      // Rest is the only verb paid for in tempo: it takes the whole turn's
      // remaining actions, which is what stops "rest, then do everything else".
      spend = budget.remaining;
      break;
    }
    default:
      return rejectCommand(state, command, {
        code: "INVALID_COMMAND",
        message: "Unknown turn action",
      });
  }

  actor = consumeTurnActions(state, actor, spend);

  pushMarker(
    state,
    collector,
    {
      kind: "turn.action",
      action,
      actionsSpent: spend,
      actionsRemaining: Math.max(0, budget.remaining - spend),
    },
    affected,
  );

  return commit(state, command, collector, { ...others, [actor.id]: actor });
}
