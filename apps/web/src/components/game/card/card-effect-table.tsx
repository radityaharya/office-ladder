import type { EffectDescriptor } from "@office-ladder/content";

import { cn } from "@/lib/utils";

import { describeEffect, type EffectPolarity } from "./effect-readout";

type CardEffectTableProps = {
  readonly effects: readonly EffectDescriptor[];
  readonly className?: string;
};

/**
 * The card's effects readout, as a data table (DESIGN.md §6.3): hairline row
 * separators, no zebra striping, 36px rows, sticky uppercase header, numeric
 * column right-aligned in mono tabular figures.
 *
 * Every row states its change three ways — a sentence-case verb ("Gain", "Lose",
 * "Pay"), an explicitly signed mono delta, and a tonal left rule — so polarity
 * is never carried by color alone. Only one status token is spent (critical, on
 * costs); gains route through the neutral sand step, keeping `accent` free for
 * the dialog's single primary action.
 *
 * A long list scrolls inside its own capped region rather than growing the
 * modal, and the entry count above the table makes the total explicit so a
 * scrolled-away row is never silently hidden.
 */
export function CardEffectTable({ effects, className }: CardEffectTableProps) {
  const readouts = effects.map((effect) => describeEffect(effect));

  return (
    <section
      className={cn("grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden", className)}
      data-slot="card-effect-readout"
    >
      <div className="flex items-center justify-between gap-4 border-b border-border bg-surface-raised px-4 py-2">
        <h3 className="ui-label text-muted-foreground">Effects applied</h3>
        <p className="ui-data text-[0.6875rem] text-muted-foreground" data-slot="card-effect-count">
          {readouts.length} {readouts.length === 1 ? "entry" : "entries"}
        </p>
      </div>
      <div className="card-effect-scroll max-h-72 min-h-0 overflow-y-auto">
        <table
          aria-label="Card effects"
          className="w-full border-collapse text-left"
          data-slot="card-effect-table"
        >
          <thead>
            <tr>
              <th
                className="ui-label sticky top-0 z-10 border-b border-border bg-surface-raised px-4 py-2 text-muted-foreground"
                scope="col"
              >
                Effect
              </th>
              <th
                className="ui-label sticky top-0 z-10 border-b border-border bg-surface-raised px-2 py-2 text-muted-foreground"
                scope="col"
              >
                Scope
              </th>
              <th
                className="ui-label sticky top-0 z-10 border-b border-border bg-surface-raised px-4 py-2 text-right text-muted-foreground"
                scope="col"
              >
                Delta
              </th>
            </tr>
          </thead>
          <tbody>
            {readouts.length === 0 ? (
              <tr data-slot="card-effect-empty">
                <td className="px-4 py-2 text-sm leading-5 text-muted-foreground" colSpan={3}>
                  No mechanical effect. This card is recorded in the log and nothing else changes.
                </td>
              </tr>
            ) : (
              readouts.map((readout, index) => (
                <tr
                  className="border-b border-border last:border-b-0"
                  data-polarity={readout.polarity}
                  data-slot="card-effect-row"
                  key={`${readout.type}-${index}`}
                >
                  <td
                    className={cn(
                      "border-l-2 px-4 py-2 text-sm leading-5 text-foreground",
                      polarityRule(readout.polarity),
                    )}
                  >
                    {readout.sentence}
                  </td>
                  <td className="ui-data px-2 py-2 text-[0.6875rem] leading-5 text-muted-foreground">
                    {readout.scope}
                  </td>
                  <td className="ui-data px-4 py-2 text-right leading-5 whitespace-nowrap text-foreground">
                    {readout.delta === null ? (
                      <span aria-hidden="true" className="text-muted-foreground">
                        —
                      </span>
                    ) : (
                      readout.delta
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function polarityRule(polarity: EffectPolarity): string {
  switch (polarity) {
    case "cost":
      return "border-l-status-critical";
    case "gain":
      return "border-l-sand";
    case "neutral":
      return "border-l-taupe";
  }
}
