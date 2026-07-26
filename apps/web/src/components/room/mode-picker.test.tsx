import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_ROOM_MODE, MODE_RULES_BOUNDS } from "@office-ladder/contracts";

import { CustomRulesBuilder } from "./custom-rules-builder";
import { LobbyPanel } from "./lobby-panel";
import { ModeBriefing } from "./mode-briefing";
import {
  DEFAULT_MODE_SELECTION,
  ModePicker,
  customRulesToSend,
  selectionModeId,
  type ModeSelection,
} from "./mode-picker";
import {
  MODE_PRESET_IDS,
  presetRules,
  summarizeModeRules,
  type ModePresetId,
} from "./mode-presets";
import {
  draftFromPreset,
  editSection,
  gateModeRules,
  modeRulesFieldIssues,
} from "./mode-rules-draft";
import type { CharacterOption, LobbyPlayer } from "./types";

/**
 * Nothing interactive is unit-testable in this repo (spec §8.5), so every
 * assertion here is about structure and resting state — what a host sees before
 * they touch anything.
 *
 * The derived copy is asserted against **literal strings**, deliberately, rather
 * than against `summarizeModeRules` run a second time. Re-deriving would prove
 * only that a function is deterministic. Spelling out "4 quarters of 4 rounds"
 * means that flipping a preset in `packages/content` fails this file, which is
 * the point: the copy is supposed to track the data, and a test that tracks the
 * data too would notice nothing.
 */

function picker(selection: ModeSelection = DEFAULT_MODE_SELECTION): string {
  return renderToStaticMarkup(
    <ModePicker selection={selection} onSelectionChange={vi.fn()} />,
  );
}

/** The markup of one option row, so a per-preset assertion cannot match a sibling. */
function optionRow(markup: string, mode: string): string {
  const anchor = markup.indexOf(`data-mode="${mode}"`);
  expect(anchor).toBeGreaterThan(-1);
  const start = markup.lastIndexOf("<label", anchor);
  const end = markup.indexOf("</label>", anchor);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(-1);
  return markup.slice(start, end);
}

describe("mode picker", () => {
  it("offers every preset the content pack ships, plus custom", () => {
    // Given — four presets ship; two of them could not even be validated before
    // this run, so "all four are offered" is the whole point.
    const markup = picker();

    // Then
    expect(MODE_PRESET_IDS).toHaveLength(4);
    for (const id of MODE_PRESET_IDS) {
      expect(markup).toContain(`data-mode="${id}"`);
      expect(markup).toContain(`value="${id}"`);
    }
    expect(markup).toContain('data-mode="mode.custom"');
    expect(markup).toContain("Quick");
    expect(markup).toContain("Standard");
    expect(markup).toContain("Marathon");
    expect(markup).toContain("Campaign");
    expect(markup).toContain("Custom");
  });

  it("pre-selects Standard, the mode the spec calls the default", () => {
    // Given
    const markup = picker();

    // Then — exactly one row is selected, and it is the contract's own default.
    expect(DEFAULT_ROOM_MODE).toBe("mode.standard");
    expect(selectionModeId(DEFAULT_MODE_SELECTION)).toBe("mode.standard");
    expect(markup.match(/data-selected="true"/g) ?? []).toHaveLength(1);
    expect(optionRow(markup, "mode.standard")).toContain('data-selected="true"');
    expect(optionRow(markup, "mode.quick")).toContain('data-selected="false"');
  });

  it("describes quick from its rules: no quarters, a race, nothing switched on", () => {
    // When
    const row = optionRow(picker(), "mode.quick");

    // Then
    expect(row).toContain("20–30 min");
    expect(row).toContain("No fixed length — first to Director wins.");
    expect(row).toContain("Scores on promotion.");
    expect(row).toContain("Running out of money costs nothing.");
    expect(row).toContain("20s per turn");
    expect(row).toContain(
      "Projects, Tile ownership, Placements, Trading, Auctions, Loans, Upkeep, Sabotage",
    );
    // Every system is off, so there is no "On" line at all to mislabel.
    expect(row).toContain(">Off<");
    expect(row).not.toContain(">On<");
  });

  it("describes standard from its rules: 4x4 quarters, everything on, no elimination", () => {
    // When
    const row = optionRow(picker(), "mode.standard");

    // Then
    expect(row).toContain("40–60 min");
    expect(row).toContain("4 quarters of 4 rounds — highest score at the end.");
    expect(row).toContain("Scores on promotion, wealth and influence.");
    expect(row).toContain("Running out of money demotes you a rank.");
    expect(row).toContain(
      "Projects, Tile ownership, Placements, Trading, Auctions, Loans, Upkeep, Sabotage",
    );
    expect(row).toContain(">On<");
    expect(row).not.toContain(">Off<");
    expect(row).toContain("Hidden roles");
    expect(row).toContain("Secret objectives");
    expect(row).not.toContain("Elimination");
    expect(row).not.toContain("Secret win conditions");
  });

  it("separates marathon from standard on the facts that actually differ", () => {
    // Given — both are fixed-length with every system on. Elimination, the
    // rounds per quarter, the extra win path and the bankruptcy rule are what a
    // player is choosing between, so all four have to be on the card.
    const markup = picker();
    const marathon = optionRow(markup, "mode.marathon");

    // Then
    expect(marathon).toContain("60–120 min");
    expect(marathon).toContain("4 quarters of 6 rounds");
    expect(marathon).toContain("Scores on promotion, wealth, influence and survival.");
    expect(marathon).toContain("Running out of money puts you out of the match.");
    expect(marathon).toContain("Elimination");
    expect(marathon).toContain("Secret win conditions");
    expect(optionRow(markup, "mode.campaign")).not.toContain("Elimination");
  });

  it("describes campaign as the objectives preset", () => {
    // When
    const row = optionRow(picker(), "mode.campaign");

    // Then
    expect(row).toContain("120–240 min");
    expect(row).toContain("8 quarters of 4 rounds — resolves on objectives.");
    expect(row).toContain("45s per turn");
  });

  it("marks elimination in the warning register rather than as another feature", () => {
    // Given — §12.4: a rule that removes a player reads as a warning. The word
    // still carries it; the tone is the second signal.
    const row = optionRow(picker(), "mode.marathon");

    // Then
    expect(row).toContain('data-tone="caution"');
    expect(row).toMatch(/data-tone="caution">Elimination</);
  });

  it("describes the custom row through the same derivation as a preset", () => {
    // Given a draft that is still Standard.
    const row = optionRow(picker(), "mode.custom");

    // Then it reads exactly like the Standard row, plus where it came from.
    expect(row).toContain("from Standard");
    expect(row).toContain("4 quarters of 4 rounds — highest score at the end.");
  });

  it("keeps the builder out of the form until custom is chosen", () => {
    // Then
    expect(picker()).not.toContain('data-slot="custom-rules-builder"');
  });
});

describe("mode selection to request body", () => {
  it("creates a room under a preset with no rules payload at all", () => {
    // Given
    const selection: ModeSelection = { kind: "preset", modeId: "mode.campaign" };

    // Then
    expect(selectionModeId(selection)).toBe("mode.campaign");
    expect(customRulesToSend(selection)).toBeNull();
  });

  it("sends nothing extra for a custom selection that was never edited", () => {
    // Given — an untouched "Custom" is still Standard, and posting a frozen copy
    // of a preset as an authored ruleset would claim a choice nobody made.
    const selection: ModeSelection = {
      kind: "custom",
      draft: draftFromPreset("mode.standard"),
    };

    // Then
    expect(selectionModeId(selection)).toBe("mode.standard");
    expect(customRulesToSend(selection)).toBeNull();
  });

  it("rides an edited ruleset on the preset it was derived from", () => {
    // Given
    const base = draftFromPreset("mode.standard");
    const selection: ModeSelection = {
      kind: "custom",
      draft: {
        ...base,
        rules: editSection(base.rules, "conflict", { elimination: true }),
      },
    };

    // Then — the room is still created as Standard; only the rules block differs.
    expect(selectionModeId(selection)).toBe("mode.standard");
    expect(customRulesToSend(selection)?.conflict.elimination).toBe(true);
  });
});

describe("custom rules builder", () => {
  function builder(rules = presetRules("mode.standard")): string {
    return renderToStaticMarkup(
      <CustomRulesBuilder
        draft={{ baseModeId: "mode.standard", rules }}
        onDraftChange={vi.fn()}
      />,
    );
  }

  it("groups the ruleset the way a table argues about it", () => {
    // When
    const markup = builder();

    // Then
    expect(markup).toContain("How long a match runs");
    expect(markup).toContain("How mean people can be");
    expect(markup).toContain("How much economy");
    expect(markup).toContain("How much stays hidden");
  });

  it("offers a base preset to start from, and says the rest is inherited", () => {
    // When
    const markup = builder();

    // Then
    expect(markup).toContain('id="create-rules-base"');
    for (const id of MODE_PRESET_IDS) {
      expect(markup).toContain(`value="${id}"`);
    }
    expect(markup).toContain("inherited from Standard");
  });

  it("bounds every numeric with the contract's own table", () => {
    // Given — MODE_RULES_BOUNDS is exported so "the lobby needs them to render
    // sliders that cannot author an invalid ruleset". A hand-typed max here
    // would be a fourth copy of the bound.
    const markup = builder();

    // Then
    expect(markup).toContain(
      `min="${String(MODE_RULES_BOUNDS.quarterCount.minimum)}" max="${String(MODE_RULES_BOUNDS.quarterCount.maximum)}"`,
    );
    expect(markup).toContain(
      `min="${String(MODE_RULES_BOUNDS.turnSeconds.minimum)}" max="${String(MODE_RULES_BOUNDS.turnSeconds.maximum)}"`,
    );
    expect(markup).toContain(
      `min="${String(MODE_RULES_BOUNDS.maxLoanPrincipal.minimum)}" max="${String(MODE_RULES_BOUNDS.maxLoanPrincipal.maximum)}"`,
    );
  });

  it("never offers the fields the contract or the design refuses", () => {
    // Given — a switch that can only ever be wrong is worse than no switch.
    const markup = builder();

    // Then
    expect(markup).not.toContain("directMessages");
    expect(markup).not.toContain("Direct messages");
    expect(markup).not.toContain("interestBasisPoints");
    expect(markup).not.toContain("Interest");
    expect(markup).not.toContain("upkeepByRankIndex");
    expect(markup).not.toContain("thinkMsRange");
  });

  it("tells the host an untouched draft is still the preset", () => {
    // When
    const markup = builder();

    // Then
    expect(markup).toContain("This is still Standard");
    expect(markup).not.toContain('data-slot="rules-gate-error"');
  });

  it("reports an edited draft as ready, and says the server checks it again", () => {
    // When
    const markup = builder(
      editSection(presetRules("mode.standard"), "conflict", { elimination: true }),
    );

    // Then
    expect(markup).toContain("Edited from Standard");
    expect(markup).toContain("The server validates this ruleset again");
  });

  it("mirrors the contract's all-false winPaths refusal before submit", () => {
    // Given the exact cheat §8.4 names: every scoring path off is not a
    // stalemate, it is a match nobody can win.
    const rules = editSection(presetRules("mode.standard"), "winPaths", {
      promotion: false,
      wealth: false,
      influence: false,
      survival: false,
    });

    // When
    const markup = builder(rules);

    // Then — the field says it, the gate says it, and the gate is the contract's
    // own parser rather than a copy of it.
    expect(markup).toContain("must enable at least one win path");
    expect(markup).toContain('data-slot="rules-gate-error"');
    expect(gateModeRules(rules).ok).toBe(false);
  });
});

describe("client validation mirrors the contract", () => {
  it("passes every shipped preset, so no preset is a ruleset the lobby cannot re-save", () => {
    for (const id of MODE_PRESET_IDS) {
      expect(modeRulesFieldIssues(presetRules(id))).toEqual([]);
      expect(gateModeRules(presetRules(id)).ok).toBe(true);
    }
  });

  it("reports every bad field at once, where the contract reports only the first", () => {
    // Given two independently invalid numbers.
    const rules = editSection(
      editSection(presetRules("mode.standard"), "quarters", { count: 99 }),
      "timers",
      { turnSeconds: 1 },
    );

    // When
    const issues = modeRulesFieldIssues(rules);

    // Then — both, so the form can mark both fields rather than one per round trip.
    expect(issues.map((issue) => issue.path)).toEqual([
      "rules.quarters.count",
      "rules.timers.turnSeconds",
    ]);
    // And the gate still refuses, on the contract's own terms.
    expect(gateModeRules(rules)).toMatchObject({ ok: false });
  });

  it("refuses direct messages exactly as the contract does", () => {
    // Given
    const rules = editSection(presetRules("mode.standard"), "social", {
      directMessages: true,
    });

    // Then
    expect(modeRulesFieldIssues(rules)).toContainEqual({
      path: "rules.social.directMessages",
      message: "must be false: direct messages are not available",
    });
    expect(gateModeRules(rules).ok).toBe(false);
  });
});

describe("lobby mode briefing", () => {
  const characters = [{ id: "operator", label: "The Operator" }] satisfies readonly CharacterOption[];
  const host = {
    id: "player-1",
    name: "Avery",
    seat: 0,
    isHost: true,
    isCurrentPlayer: true,
    isReady: true,
    isConnected: true,
    isBot: false,
    botDifficulty: null,
    characterId: "operator",
    characterLabel: "The Operator",
  } satisfies LobbyPlayer;

  function lobby(briefing: Parameters<typeof ModeBriefing>[0] | null): string {
    return renderToStaticMarkup(
      <LobbyPanel
        modeBriefing={briefing}
        state={{
          kind: "ready",
          players: [host],
          characterOptions: characters,
          minimumPlayers: 3,
          maximumPlayers: 6,
          startControl: { kind: "enabled" },
        }}
      />,
    );
  }

  function briefingFor(modeId: ModePresetId, custom = false) {
    return {
      presetName: modeId === "mode.standard" ? "Standard" : "Marathon",
      custom,
      summary: summarizeModeRules(presetRules(modeId)),
    };
  }

  it("restates the room's ruleset for whoever joined with a code", () => {
    // When
    const markup = lobby(briefingFor("mode.standard"));

    // Then
    expect(markup).toContain('data-slot="mode-briefing"');
    expect(markup).toContain("4 quarters of 4 rounds — highest score at the end.");
    expect(markup).toContain("Running out of money demotes you a rank.");
  });

  it("names a host-authored ruleset as custom, and the preset it came from", () => {
    // When
    const markup = lobby(briefingFor("mode.standard", true));

    // Then
    expect(markup).toContain("Custom — from Standard");
  });

  it("renders no briefing at all when the mode cannot be described", () => {
    // Given — a guessed ruleset is worse than an absent one.
    const markup = lobby(null);

    // Then
    expect(markup).not.toContain('data-slot="mode-briefing"');
    expect(markup).toContain('data-action="start-match"');
  });
});
