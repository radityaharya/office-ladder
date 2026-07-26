import type { ModeRules } from "@office-ladder/contracts";

import {
  DEFAULT_MODE_PRESET_ID,
  matchingPresetId,
  modePresets,
  presetName,
  summarizeModeRules,
  type ModePresetId,
  type ModeSummary,
} from "./mode-presets";
import { draftFromPreset, type ModeRulesDraft } from "./mode-rules-draft";
import { ModeSystemLine, ModeTagRow } from "./mode-summary-view";

/**
 * What the host has chosen to play.
 *
 * `mode.custom` is deliberately **not** a member of `ModePresetId`: spec §4.2 is
 * explicit that it "is not a content preset. It is a lobby-authored `ModeRules`
 * object". So a custom selection carries the preset it was derived from — that
 * id is what the room is created under, and the authored ruleset is applied on
 * top of it.
 */
export type ModeSelection =
  | { readonly kind: "preset"; readonly modeId: ModePresetId }
  | { readonly kind: "custom"; readonly draft: ModeRulesDraft };

export const CUSTOM_MODE_VALUE = "mode.custom";

export const DEFAULT_MODE_SELECTION: ModeSelection = {
  kind: "preset",
  modeId: DEFAULT_MODE_PRESET_ID,
};

/** The preset id a room is created under, custom or not. */
export function selectionModeId(selection: ModeSelection): ModePresetId {
  return selection.kind === "preset" ? selection.modeId : selection.draft.baseModeId;
}

/**
 * The ruleset to put on the create body's `rules` field, or `null` when the
 * preset the room is created under already *is* the ruleset.
 *
 * A "custom" ruleset a host never actually edited is still Standard, and posting
 * it would claim an authored ruleset where there is none — the room would carry
 * a frozen copy of a preset instead of the preset, for no gain.
 */
export function customRulesToSend(selection: ModeSelection): ModeRules | null {
  if (selection.kind === "preset") return null;
  return matchingPresetId(selection.draft.rules) === selection.draft.baseModeId
    ? null
    : selection.draft.rules;
}

type ModePickerProps = {
  readonly selection: ModeSelection;
  readonly onSelectionChange: (selection: ModeSelection) => void;
  readonly disabled?: boolean;
  /** Namespaces the radio group and its ids; one picker per form. */
  readonly idPrefix?: string;
};

/**
 * The mode picker.
 *
 * Every line of every row is derived from the preset's own `rules` block (see
 * `mode-presets.ts`) — there is no hand-written description of a mode anywhere
 * in this file, because a description is a second copy of the ruleset and the
 * copy is what rots.
 *
 * Resting state shows all five options in full. Nothing is behind a disclosure:
 * a picker where you have to select an option to find out what it does is a
 * picker you have to try five times.
 */
export function ModePicker({
  selection,
  onSelectionChange,
  disabled = false,
  idPrefix = "create",
}: ModePickerProps) {
  const group = `${idPrefix}-mode`;
  const presets = modePresets();
  const selectedValue =
    selection.kind === "preset" ? selection.modeId : CUSTOM_MODE_VALUE;
  const customDraft =
    selection.kind === "custom" ? selection.draft : draftFromPreset(DEFAULT_MODE_PRESET_ID);

  return (
    <fieldset
      className="mode-picker"
      disabled={disabled}
      data-slot="mode-picker"
      aria-describedby={`${group}-hint`}
    >
      {/*
       * The legend is the group's accessible name and is announced on every
       * radio, so it stays two words. The sentence explaining where the copy
       * comes from is described-by instead of part of the name.
       */}
      <legend className="shell-field-label mode-picker-legend">Match rules</legend>
      <p className="shell-field-hint mode-picker-hint" id={`${group}-hint`}>
        Every preset below is described from the ruleset it actually ships.
      </p>

      <div className="mode-options">
        {presets.map((preset) => (
          <ModeOption
            key={preset.id}
            group={group}
            value={preset.id}
            name={preset.name}
            aside={preset.durationLabel}
            summary={preset.summary}
            selected={selectedValue === preset.id}
            onSelect={() => {
              onSelectionChange({ kind: "preset", modeId: preset.id });
            }}
          />
        ))}

        <ModeOption
          group={group}
          value={CUSTOM_MODE_VALUE}
          name="Custom"
          aside={`from ${presetName(customDraft.baseModeId)}`}
          summary={summarizeModeRules(customDraft.rules)}
          selected={selectedValue === CUSTOM_MODE_VALUE}
          onSelect={() => {
            onSelectionChange({ kind: "custom", draft: customDraft });
          }}
        />
      </div>
    </fieldset>
  );
}

function ModeOption({
  group,
  value,
  name,
  aside,
  summary,
  selected,
  onSelect,
}: {
  readonly group: string;
  readonly value: string;
  readonly name: string;
  readonly aside: string;
  readonly summary: ModeSummary;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const on = summary.facets.filter((facet) => facet.enabled);
  const off = summary.facets.filter((facet) => !facet.enabled);

  return (
    <label className="mode-option" data-selected={selected} data-mode={value}>
      <input
        type="radio"
        className="mode-option-input"
        name={group}
        value={value}
        checked={selected}
        onChange={onSelect}
      />

      {/*
       * Two blocks, not six stacked lines: at anything above a narrow column
       * the container query below puts "what shape is this match" beside "what
       * does it switch on", which halves the height of the whole list. The
       * split is by kind of fact, so it stays meaningful when it stacks again.
       */}
      <span className="mode-option-body">
        <span className="mode-option-main">
          <span className="mode-option-head">
            <span className="shell-headline shell-high">{name}</span>
            <span className="shell-data mode-option-aside">{aside}</span>
          </span>

          <span className="shell-body shell-medium mode-option-line">
            {summary.length} — {summary.ending}. {summary.scoring}
          </span>

          <span className="shell-caption shell-medium mode-option-line">
            {summary.stakes} {summary.turnClock}.
          </span>
        </span>

        <span className="mode-option-detail">
          <ModeSystemLine state="on" facets={on} />
          <ModeSystemLine state="off" facets={off} />
          <ModeTagRow tags={summary.tags} />
        </span>
      </span>
    </label>
  );
}
