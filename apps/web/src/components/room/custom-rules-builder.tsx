import type { ReactNode } from "react";

import {
  BANKRUPTCY_RULES,
  CHAT_MODES,
  LEADER_PROTECTIONS,
  MODE_RULES_BOUNDS,
  WIN_SHAPES,
  type ModeRules,
} from "@office-ladder/contracts";

import { MODE_PRESET_IDS, matchingPresetId, presetName } from "./mode-presets";
import {
  BANKRUPTCY_HINTS,
  BANKRUPTCY_LABELS,
  CHAT_HINTS,
  CHAT_LABELS,
  draftFromPreset,
  editSection,
  editWinShape,
  gateModeRules,
  issueFor,
  LEADER_PROTECTION_HINTS,
  LEADER_PROTECTION_LABELS,
  modeRulesFieldIssues,
  WIN_SHAPE_HINTS,
  WIN_SHAPE_LABELS,
  type ModeRulesDraft,
  type ModeRulesIssue,
} from "./mode-rules-draft";

/**
 * The custom-ruleset builder (spec §8.4).
 *
 * `ModeRules` has roughly a hundred fields. A form with a hundred switches is
 * not a form, it is a config file with a mouse interface, and nobody who wants
 * to play a board game in the next hour is going to read it. So the design
 * problem here is subtraction, and the subtraction is stated rather than
 * implied:
 *
 * **Four groups, in the order a table actually argues about them** — how long is
 * this going to take, how mean are we allowed to be, how much economy is there,
 * how much do we get to hide. Every group starts from a shipped preset, so the
 * question at every control is "do I want to change this from Standard", not
 * "what is a reasonable value for `interestBasisPoints`".
 *
 * **What is deliberately not here**, and why:
 *
 * - `bots.*` — pacing and think time are how a bot *feels*, not what the game
 *   is. Nobody choosing a mode has a basis for 400ms over 1600ms.
 * - `social.directMessages` — the contract refuses `true` outright (§8.1: an off
 *   switch, not a v1 feature), so a control for it could only ever be wrong.
 * - `economy.upkeepByRankIndex` — nine numbers. An upkeep *curve* editor is a
 *   spreadsheet; the on/off switch plus the preset's own ladder is the decision
 *   a player can actually make.
 * - `economy.interestBasisPoints`, `board.claimCostMultiplier`,
 *   `board.tollMultiplier` — tuning multipliers with no intuitive unit. Getting
 *   these wrong quietly breaks the economy several turns later, which is the
 *   worst kind of setting.
 * - `agency.*` (dice adjust, energy per pip, pip ceiling, free actions, hand,
 *   promotion-as-choice) — every shipped preset switches these on. They are the
 *   floor of what makes a turn a decision at all, and switching them off returns
 *   the game to the roll-and-move slice this whole spec exists to escape.
 * - `interaction.reactionWindowSeconds`, `timers.chessClockSeconds`,
 *   `timers.onTimeout` — timer minutiae. `timers.turnSeconds` is the one a table
 *   genuinely argues about, so that one is here and the rest are inherited.
 * - Sub-tunables of a subsystem whose on/off switch *is* exposed —
 *   `projects.maxConcurrentPerPlayer`, `projects.deadlineRounds`,
 *   `projects.joinable`, `board.upgradesEnabled`,
 *   `board.maxPlacementsPerPlayer`, `conflict.heatPerAttack`,
 *   `interaction.votesEnabled`, `interaction.promisesRecorded`,
 *   `economy.incomeStreamsEnabled`, `social.emoteReactions`.
 *
 * Everything on that list is inherited verbatim from the base preset and the
 * panel says so in words, so nothing is hidden in the sense of being concealed —
 * it is hidden in the sense of not being asked.
 */

type CustomRulesBuilderProps = {
  readonly draft: ModeRulesDraft;
  readonly onDraftChange: (draft: ModeRulesDraft) => void;
  readonly disabled?: boolean;
  readonly idPrefix?: string;
};

export function CustomRulesBuilder({
  draft,
  onDraftChange,
  disabled = false,
  idPrefix = "create",
}: CustomRulesBuilderProps) {
  const { rules } = draft;
  const issues = modeRulesFieldIssues(rules);
  const gate = gateModeRules(rules);
  const baseName = presetName(draft.baseModeId);
  const identical = matchingPresetId(rules) === draft.baseModeId;
  const id = (suffix: string): string => `${idPrefix}-rules-${suffix}`;

  const update = (next: ModeRules): void => {
    onDraftChange({ ...draft, rules: next });
  };

  return (
    <section
      className="mode-builder"
      data-slot="custom-rules-builder"
      aria-labelledby={id("title")}
    >
      <div className="mode-builder-head">
        <div className="shell-stack">
          <h4 id={id("title")} className="shell-label shell-high">
            Custom rules
          </h4>
          <p className="shell-body shell-medium shell-prose">
            Everything not asked about below is inherited from {baseName} exactly as it
            ships — including bot pacing, the upkeep ladder, dice adjustment and every
            timer except the turn clock.
          </p>
        </div>

        <div className="shell-field">
          <label className="shell-field-label" htmlFor={id("base")}>
            Start from
          </label>
          <span className="shell-select-wrap">
            <select
              id={id("base")}
              className="shell-select"
              value={draft.baseModeId}
              disabled={disabled}
              onChange={(event) => {
                const value = event.currentTarget.value;
                const match = MODE_PRESET_IDS.find((preset) => preset === value);
                if (match !== undefined) onDraftChange(draftFromPreset(match));
              }}
            >
              {MODE_PRESET_IDS.map((preset) => (
                <option key={preset} value={preset}>
                  {presetName(preset)}
                </option>
              ))}
            </select>
          </span>
          <span className="shell-field-hint">Changing this discards your edits.</span>
        </div>
      </div>

      <div className="mode-builder-groups">
        <RuleGroup
          title="How long a match runs"
          blurb="A quarter is a block of rounds. Turn off quarters and the match runs until somebody wins outright."
        >
          <RuleSwitch
            id={id("quarters-enabled")}
            label="Play in quarters"
            hint="Off means the match runs until somebody wins outright."
            checked={rules.quarters.enabled}
            disabled={disabled}
            onChange={(enabled) => {
              update(editSection(rules, "quarters", { enabled }));
            }}
          />
          <RuleSwitch
            id={id("quarters-events")}
            label="Quarterly events"
            hint="A shared event fires at each quarter boundary."
            checked={rules.quarters.globalEvents}
            disabled={disabled || !rules.quarters.enabled}
            onChange={(globalEvents) => {
              update(editSection(rules, "quarters", { globalEvents }));
            }}
          />
          <RuleNumber
            id={id("quarters-count")}
            label="Quarters"
            value={rules.quarters.count}
            bounds={MODE_RULES_BOUNDS.quarterCount}
            disabled={disabled || !rules.quarters.enabled}
            issue={issueFor(issues, "rules.quarters.count")}
            onChange={(count) => {
              update(editSection(rules, "quarters", { count }));
            }}
          />
          <RuleNumber
            id={id("quarters-rounds")}
            label="Rounds per quarter"
            value={rules.quarters.roundsEach}
            bounds={MODE_RULES_BOUNDS.quarterRoundsEach}
            disabled={disabled || !rules.quarters.enabled}
            issue={issueFor(issues, "rules.quarters.roundsEach")}
            onChange={(roundsEach) => {
              update(editSection(rules, "quarters", { roundsEach }));
            }}
          />
          <RuleNumber
            id={id("turn-seconds")}
            label="Seconds per turn"
            value={rules.timers.turnSeconds}
            bounds={MODE_RULES_BOUNDS.turnSeconds}
            disabled={disabled}
            issue={issueFor(issues, "rules.timers.turnSeconds")}
            onChange={(turnSeconds) => {
              update(editSection(rules, "timers", { turnSeconds }));
            }}
          />
          <RuleSelect
            id={id("win-shape")}
            label="How it ends"
            value={rules.winShape}
            hint={WIN_SHAPE_HINTS[rules.winShape]}
            options={WIN_SHAPES.map((shape): readonly [string, string] => [
              shape,
              WIN_SHAPE_LABELS[shape],
            ])}
            disabled={disabled}
            onChange={(value) => {
              const match = WIN_SHAPES.find((shape) => shape === value);
              if (match !== undefined) update(editWinShape(rules, match));
            }}
          />

          <fieldset className="mode-checks" disabled={disabled}>
            <legend className="shell-field-label">Win by</legend>
            <RuleCheck
              id={id("win-promotion")}
              label="Promotion"
              checked={rules.winPaths.promotion}
              onChange={(promotion) => {
                update(editSection(rules, "winPaths", { promotion }));
              }}
            />
            <RuleCheck
              id={id("win-wealth")}
              label="Wealth"
              checked={rules.winPaths.wealth}
              onChange={(wealth) => {
                update(editSection(rules, "winPaths", { wealth }));
              }}
            />
            <RuleCheck
              id={id("win-influence")}
              label="Influence"
              checked={rules.winPaths.influence}
              onChange={(influence) => {
                update(editSection(rules, "winPaths", { influence }));
              }}
            />
            <RuleCheck
              id={id("win-survival")}
              label="Survival"
              checked={rules.winPaths.survival}
              onChange={(survival) => {
                update(editSection(rules, "winPaths", { survival }));
              }}
            />
            <IssueLine issue={issueFor(issues, "rules.winPaths")} />
          </fieldset>
        </RuleGroup>

        <RuleGroup
          title="How mean people can be"
          blurb="Whether players can act on each other directly, and what it costs them."
        >
          <RuleSwitch
            id={id("attacks")}
            label="Targeted attacks"
            hint="Play a card or ability at a named opponent."
            checked={rules.conflict.targetedAttacks}
            disabled={disabled}
            onChange={(targetedAttacks) => {
              update(editSection(rules, "conflict", { targetedAttacks }));
            }}
          />
          <RuleSwitch
            id={id("sabotage")}
            label="Sabotage projects"
            hint="Set back work somebody else has money in."
            checked={rules.projects.sabotageable}
            disabled={disabled || !rules.projects.enabled}
            onChange={(sabotageable) => {
              update(editSection(rules, "projects", { sabotageable }));
            }}
          />
          <RuleSwitch
            id={id("heat")}
            label="Heat"
            hint="Attacking accumulates suspicion until it triggers an investigation."
            checked={rules.conflict.heatEnabled}
            disabled={disabled}
            onChange={(heatEnabled) => {
              update(editSection(rules, "conflict", { heatEnabled }));
            }}
          />
          <RuleSwitch
            id={id("defence")}
            label="Defence"
            hint="A target can spend to blunt an incoming attack."
            checked={rules.conflict.defenceEnabled}
            disabled={disabled}
            onChange={(defenceEnabled) => {
              update(editSection(rules, "conflict", { defenceEnabled }));
            }}
          />
          <RuleSwitch
            id={id("elimination")}
            label="Elimination"
            hint="A removed player spectates for the rest of the match."
            tone="caution"
            checked={rules.conflict.elimination}
            disabled={disabled}
            onChange={(elimination) => {
              update(editSection(rules, "conflict", { elimination }));
            }}
          />
          <RuleNumber
            id={id("heat-threshold")}
            label="Investigation at"
            value={rules.conflict.heatThreshold}
            bounds={MODE_RULES_BOUNDS.heatThreshold}
            disabled={disabled || !rules.conflict.heatEnabled}
            issue={issueFor(issues, "rules.conflict.heatThreshold")}
            onChange={(heatThreshold) => {
              update(editSection(rules, "conflict", { heatThreshold }));
            }}
          />
          <RuleSelect
            id={id("leader-protection")}
            label="Protect whoever is ahead"
            value={rules.conflict.leaderProtection}
            hint={LEADER_PROTECTION_HINTS[rules.conflict.leaderProtection]}
            options={LEADER_PROTECTIONS.map(
              (protection): readonly [string, string] => [
                protection,
                LEADER_PROTECTION_LABELS[protection],
              ],
            )}
            disabled={disabled}
            onChange={(value) => {
              const match = LEADER_PROTECTIONS.find((protection) => protection === value);
              if (match !== undefined) {
                update(editSection(rules, "conflict", { leaderProtection: match }));
              }
            }}
          />
        </RuleGroup>

        <RuleGroup
          title="How much economy"
          blurb="Whether money has rival uses, or is only a promotion counter."
        >
          <RuleSwitch
            id={id("projects")}
            label="Projects"
            hint="Start or join work that pays out on a deadline."
            checked={rules.projects.enabled}
            disabled={disabled}
            onChange={(enabled) => {
              update(editSection(rules, "projects", { enabled }));
            }}
          />
          <RuleSwitch
            id={id("ownership")}
            label="Tile ownership"
            hint="Claim tiles and charge a toll on them."
            checked={rules.board.ownershipEnabled}
            disabled={disabled}
            onChange={(ownershipEnabled) => {
              update(editSection(rules, "board", { ownershipEnabled }));
            }}
          />
          <RuleSwitch
            id={id("placements")}
            label="Placements"
            hint="Leave objects on the board that act on whoever lands there."
            checked={rules.board.placementsEnabled}
            disabled={disabled}
            onChange={(placementsEnabled) => {
              update(editSection(rules, "board", { placementsEnabled }));
            }}
          />
          <RuleSwitch
            id={id("upkeep")}
            label="Upkeep"
            hint="A recurring charge per round that grows with your rank."
            checked={rules.economy.upkeepEnabled}
            disabled={disabled}
            onChange={(upkeepEnabled) => {
              update(editSection(rules, "economy", { upkeepEnabled }));
            }}
          />
          <RuleSwitch
            id={id("loans")}
            label="Loans"
            hint="Borrow against a rising interest charge."
            checked={rules.economy.loansEnabled}
            disabled={disabled}
            onChange={(loansEnabled) => {
              update(editSection(rules, "economy", { loansEnabled }));
            }}
          />
          <RuleSwitch
            id={id("trades")}
            label="Trading"
            hint="Swap money and items by agreement."
            checked={rules.interaction.tradesEnabled}
            disabled={disabled}
            onChange={(tradesEnabled) => {
              update(editSection(rules, "interaction", { tradesEnabled }));
            }}
          />
          <RuleSwitch
            id={id("auctions")}
            label="Auctions"
            hint="Contested items go to the highest bidder."
            checked={rules.interaction.auctionsEnabled}
            disabled={disabled}
            onChange={(auctionsEnabled) => {
              update(editSection(rules, "interaction", { auctionsEnabled }));
            }}
          />
          <RuleNumber
            id={id("loan-ceiling")}
            label="Loan ceiling"
            value={rules.economy.maxLoanPrincipal}
            bounds={MODE_RULES_BOUNDS.maxLoanPrincipal}
            disabled={disabled || !rules.economy.loansEnabled}
            issue={issueFor(issues, "rules.economy.maxLoanPrincipal")}
            onChange={(maxLoanPrincipal) => {
              update(editSection(rules, "economy", { maxLoanPrincipal }));
            }}
          />
          <RuleSelect
            id={id("bankruptcy")}
            label="Running out of money"
            value={rules.economy.bankruptcy}
            hint={BANKRUPTCY_HINTS[rules.economy.bankruptcy]}
            options={BANKRUPTCY_RULES.map((rule): readonly [string, string] => [
              rule,
              BANKRUPTCY_LABELS[rule],
            ])}
            disabled={disabled}
            onChange={(value) => {
              const match = BANKRUPTCY_RULES.find((rule) => rule === value);
              if (match !== undefined) {
                update(editSection(rules, "economy", { bankruptcy: match }));
              }
            }}
          />
        </RuleGroup>

        <RuleGroup
          title="How much stays hidden"
          blurb="Hidden information is what makes a table talk. It is also what makes a match harder to follow."
        >
          <RuleSwitch
            id={id("roles")}
            label="Hidden roles"
            hint="Each player is dealt a role nobody else can see."
            checked={rules.hidden.rolesEnabled}
            disabled={disabled}
            onChange={(rolesEnabled) => {
              update(editSection(rules, "hidden", { rolesEnabled }));
            }}
          />
          <RuleSwitch
            id={id("role-wins")}
            label="Secret win conditions"
            hint="A role can win on its own terms rather than the table's."
            checked={rules.hidden.roleWinConditions}
            disabled={disabled || !rules.hidden.rolesEnabled}
            onChange={(roleWinConditions) => {
              update(editSection(rules, "hidden", { roleWinConditions }));
            }}
          />
          <RuleSwitch
            id={id("objectives")}
            label="Secret objectives"
            hint="Private goals worth points nobody can see coming."
            checked={rules.hidden.secretObjectives}
            disabled={disabled}
            onChange={(secretObjectives) => {
              update(editSection(rules, "hidden", { secretObjectives }));
            }}
          />
          <RuleSwitch
            id={id("hands")}
            label="Hidden hands"
            hint="Cards in hand are yours alone until you play them."
            checked={rules.hidden.hiddenHands}
            disabled={disabled}
            onChange={(hiddenHands) => {
              update(editSection(rules, "hidden", { hiddenHands }));
            }}
          />
          <RuleSelect
            id={id("chat")}
            label="Table talk"
            value={rules.social.chat}
            hint={CHAT_HINTS[rules.social.chat]}
            options={CHAT_MODES.map((mode): readonly [string, string] => [
              mode,
              CHAT_LABELS[mode],
            ])}
            disabled={disabled}
            onChange={(value) => {
              const match = CHAT_MODES.find((mode) => mode === value);
              if (match !== undefined) update(editSection(rules, "social", { chat: match }));
            }}
          />
        </RuleGroup>
      </div>

      <div className="mode-builder-foot">
        {gate.ok ? (
          identical ? (
            <p className="shell-msg shell-msg-info">
              <span className="shell-led shell-led-idle shell-msg-led" aria-hidden="true" />
              <span className="shell-msg-body">
                <span className="shell-label shell-medium">Unchanged</span> This is still{" "}
                {baseName}, so the room will simply be created as {baseName}.
              </span>
            </p>
          ) : (
            <p className="shell-msg shell-msg-info">
              <span className="shell-led shell-led-active shell-msg-led" aria-hidden="true" />
              <span className="shell-msg-body">
                <span className="shell-label shell-medium">Ready</span> Edited from {baseName}.
                The server validates this ruleset again before any match uses it.
              </span>
            </p>
          )
        ) : (
          <p className="shell-msg shell-msg-error" role="alert" data-slot="rules-gate-error">
            <span className="shell-led shell-led-critical shell-msg-led" aria-hidden="true" />
            <span className="shell-msg-body">
              <span className="shell-label shell-medium">Not valid</span>{" "}
              <span className="shell-data">{gate.issue.path}</span> {gate.issue.message}.
            </span>
          </p>
        )}
      </div>
    </section>
  );
}

function RuleGroup({
  title,
  blurb,
  children,
}: {
  readonly title: string;
  readonly blurb: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="mode-group">
      <div className="mode-group-head">
        <h5 className="shell-label shell-high">{title}</h5>
        <p className="shell-caption shell-medium shell-prose">{blurb}</p>
      </div>
      <div className="mode-group-body">{children}</div>
    </section>
  );
}

function RuleSwitch({
  id,
  label,
  hint,
  checked,
  disabled,
  tone = "neutral",
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly tone?: "neutral" | "caution";
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <div className="mode-switch" data-tone={tone} data-on={checked}>
      <input
        id={id}
        type="checkbox"
        className="mode-switch-input"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.currentTarget.checked);
        }}
      />
      <label className="mode-switch-label" htmlFor={id}>
        <span className="shell-body shell-high">{label}</span>
        {hint === undefined ? null : (
          <span className="shell-caption shell-medium">{hint}</span>
        )}
      </label>
      <span className="shell-label shell-medium mode-switch-state">
        {checked ? "On" : "Off"}
      </span>
    </div>
  );
}

function RuleCheck({
  id,
  label,
  checked,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <span className="mode-check">
      <input
        id={id}
        type="checkbox"
        className="mode-switch-input"
        checked={checked}
        onChange={(event) => {
          onChange(event.currentTarget.checked);
        }}
      />
      <label className="shell-body shell-high" htmlFor={id}>
        {label}
      </label>
    </span>
  );
}

/**
 * `min`/`max`/`step` come straight off `MODE_RULES_BOUNDS`, which contracts
 * exports for exactly this: "the lobby needs them to render sliders that cannot
 * author an invalid ruleset". The browser constraint is the first line, the
 * mirrored message is the second, and the contract's own parser is the third.
 */
function RuleNumber({
  id,
  label,
  value,
  bounds,
  disabled,
  issue,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly bounds: { readonly minimum: number; readonly maximum: number };
  readonly disabled: boolean;
  readonly issue: ModeRulesIssue | null;
  readonly onChange: (value: number) => void;
}) {
  return (
    <div className="shell-field mode-field">
      <label className="shell-field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="shell-input mode-number"
        type="number"
        inputMode="numeric"
        value={value}
        min={bounds.minimum}
        max={bounds.maximum}
        step={1}
        disabled={disabled}
        aria-invalid={issue !== null}
        aria-describedby={issue === null ? `${id}-hint` : `${id}-issue`}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber;
          // An emptied number input reads NaN. Keep the last committed value
          // rather than writing NaN into the draft — the contract refuses it,
          // and a field that self-destructs while you retype is hostile.
          if (Number.isNaN(next)) return;
          onChange(next);
        }}
      />
      {issue === null ? (
        <span className="shell-field-hint" id={`${id}-hint`}>
          {groupDigits(bounds.minimum)}–{groupDigits(bounds.maximum)}
        </span>
      ) : (
        <span className="shell-field-hint mode-issue" id={`${id}-issue`}>
          {issue.message}
        </span>
      )}
    </div>
  );
}

function RuleSelect({
  id,
  label,
  value,
  hint,
  options,
  disabled,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  /** Spells out the current choice, which the narrow `<option>` cannot. */
  readonly hint: string;
  readonly options: readonly (readonly [string, string])[];
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="shell-field mode-field">
      <label className="shell-field-label" htmlFor={id}>
        {label}
      </label>
      <span className="shell-select-wrap">
        <select
          id={id}
          className="shell-select"
          value={value}
          disabled={disabled}
          aria-describedby={`${id}-hint`}
          onChange={(event) => {
            onChange(event.currentTarget.value);
          }}
        >
          {options.map(([optionValue, optionLabel]) => (
            <option key={optionValue} value={optionValue}>
              {optionLabel}
            </option>
          ))}
        </select>
      </span>
      <span className="shell-field-hint" id={`${id}-hint`}>
        {hint}
      </span>
    </div>
  );
}

/** Thousands separators, fixed to one locale so the hint never varies by user. */
const DIGIT_GROUPS = new Intl.NumberFormat("en-US");

function groupDigits(value: number): string {
  return DIGIT_GROUPS.format(value);
}

function IssueLine({ issue }: { readonly issue: ModeRulesIssue | null }) {
  if (issue === null) return null;

  return (
    <p className="shell-msg shell-msg-error mode-issue-line" role="alert">
      <span className="shell-led shell-led-critical shell-msg-led" aria-hidden="true" />
      <span className="shell-msg-body">
        <span className="shell-label shell-medium">Required</span> {issue.message}.
      </span>
    </p>
  );
}
