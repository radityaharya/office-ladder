# Bots, Simulation, And Balance

Status: Proposed
Owner: Gameplay engineering and game design
Updated: 2026-07-18

## Outcome

Use the same deterministic engine and legal-action API for humans, timeout policies, scripted tests, balancing bots, disconnect replacement, and future AI opponents.

## Engine Hooks

```ts
getObservation(state, viewerId)
enumerateLegalActions(state, actorId)
applyAction(state, action, context)
cloneForSimulation(state)
isTerminal(state)
scoreTerminalState(state, perspective)
```

Bots receive only the observation available to their seat, never canonical hidden state.

## Legal Actions

Structured examples:

- `ROLL`
- `PAY_AUDIT_FINE`
- `SPEND_MOVE`
- `REROLL`
- `PLAY_CARD`
- `CHOOSE_TARGET`
- `CHOOSE_OPTION`
- `SHUFFLE_DECK`
- `BLOCK_PROMOTION`
- `PASS`

Requirements:

- Stable deterministic ordering.
- Explicit Pass when legal.
- Multi-stage decisions remain separate prompts.
- Every enumerated action applies.
- Non-enumerated actions reject.
- Revisions and decision-point IDs prevent stale action reuse.

## Policy Contract

```ts
interface Policy {
  id: string;
  version: string;
  chooseAction(input: {
    observation: PlayerObservation;
    legalActions: readonly LegalAction[];
    policyRandom: PolicyRandom;
    budgetMs: number;
  }): ActionId | Promise<ActionId>;
}
```

Game RNG and policy RNG are separate. Late/invalid policy decisions fall back to deterministic timeout behavior.

## Initial Policies

- `timeout-conservative`.
- `first-legal`.
- `random-legal`.
- `scenario-script`.
- `basic-worker`.
- `basic-management`.
- `heuristic-balanced`.

External AI is not required for initial bots.

## Scenario DSL

Support scripted scenarios that:

- Choose by action kind/ID/target predicate.
- Assert phases and legal options.
- Mix scripted and heuristic seats.
- Inject disconnect, reconnect, and timeout events.
- Fail with seed, state hash, recent events, and legal actions.

Use scenarios for every tile, card category, rank benefit, Management power, reaction, and win boundary.

## Simulation CLI

Examples:

```text
game:simulate --matches 10000 --mode quick --players 6 --seed balance-v1
game:simulate --scenario audit-escape --trace
game:replay artifacts/failure.json
```

Run matches in memory without DB/Realtime. Derive match seeds deterministically from run seed and index. Persist full traces only for failures and samples.

## Safety Limits

- Maximum turns/actions.
- Maximum automatic frames per action.
- Maximum card-chain depth.
- Per-match wall-clock budget.
- No-progress detector.
- Terminal classifications for normal result, safety limit, policy failure, invariant failure, and exception.

## Metrics

Segment by mode, player count, seat, identity, character, and policy version.

Collect:

- Worker/Management outcome rates.
- Individual Management Director rate.
- Seat-order advantage.
- Match duration/turn distributions.
- Rank progression.
- Resource/token trajectories.
- Burnout/Audit frequency.
- Clock depletion.
- Promotion attempts/blocks.
- Shuffle timing and target.
- Card draw/play/dead-card rates.
- Target concentration and catch-up triggers.
- Legal-action branching factor.
- Reaction frequency/pass rate.
- Stalemate/no-progress rate.

Report confidence intervals and sample counts. Random bots detect mechanical bias, not human strategic balance.

## Baseline Comparison

- Keep a stable seed corpus.
- Run mirrored seat assignments.
- Compare candidate content/rules against baseline.
- Flag practical effect-size changes, not only statistical significance.
- Preserve rules/content/policy versions in every report.

## Soak Testing

### Engine

- Millions of actions.
- Random legal policy.
- Invariants after every transition.
- Memory trend.
- Reproducible failure artifacts.

### Authoritative Service

- Concurrent rooms.
- Duplicate/stale commands.
- Timer/bot leases and worker restart.
- DB conflicts.
- Realtime loss/duplication.

### Browser

- Real multi-client join/play/background/reconnect/reclaim flows.

## Disconnect Replacement

Separate seat ownership from controller:

```ts
type SeatController =
  | { kind: "human"; userId: string }
  | { kind: "bot"; policyId: string; reason: "lobby" | "disconnect" }
  | { kind: "none" };
```

Flow:

1. Presence loss starts grace period.
2. Timeouts handle immediate decisions.
3. After grace, authoritative Bot Assumed Control event.
4. Bot receives that seat's private observation.
5. Returning human reclaims at a safe decision boundary.
6. Lease/revision invalidates late bot jobs.

Replacement is visible but never reveals the seat's hidden identity.

## Future AI

Evolution:

1. Deterministic timeout.
2. Random legal.
3. Heuristic scoring.
4. Shallow rollout with information-consistent determinization.
5. Search/learned value policy.
6. Optional remote model service.

Future policies cannot use unavailable hidden information. Omniscient policies are debug-only upper bounds.

Remote AI must exclude PII and fall back immediately to local deterministic behavior.

## Acceptance Criteria

- Any failure is reproducible from ruleset, seed, and accepted actions.
- UI and bots consume the same legal-action enumeration.
- Policies cannot access hidden information beyond their seat.
- Thousands of seeded games complete without invalid/stuck states.
- Simulation reports include versions and confidence context.
- Timer/bot automation continues without connected browsers.
- Human reclaim is race-safe and idempotent.
