import type { ModeFacet, ModeTag } from "./mode-presets";

/**
 * The two shared readouts of a derived {@link import("./mode-presets").ModeSummary}.
 *
 * Both the create-room picker and the lobby briefing render them, and they must
 * render identically: a mode that describes itself one way while you are
 * choosing it and another way once you are sitting in it is a mode nobody can
 * check.
 */

/**
 * "On — Projects, Trading, Loans" / "Off — …".
 *
 * The word carries the state, the LED carries it peripherally, and neither is
 * ever alone: status is never colour-only in this system (DESIGN.md §8).
 */
export function ModeSystemLine({
  state,
  facets,
}: {
  readonly state: "on" | "off";
  readonly facets: readonly ModeFacet[];
}) {
  if (facets.length === 0) return null;

  return (
    <span className="mode-systems" data-state={state}>
      <span
        className={
          state === "on" ? "shell-led shell-led-active" : "shell-led shell-led-idle"
        }
        aria-hidden="true"
      />
      <span className="shell-label shell-medium">{state === "on" ? "On" : "Off"}</span>
      <span className="shell-body shell-medium">
        {facets.map((facet) => facet.label).join(", ")}
      </span>
    </span>
  );
}

export function ModeTagRow({ tags }: { readonly tags: readonly ModeTag[] }) {
  if (tags.length === 0) return null;

  return (
    <span className="mode-tags">
      {tags.map((tag) => (
        <span className="shell-tag" data-tone={tag.tone} key={tag.id}>
          {tag.label}
        </span>
      ))}
    </span>
  );
}
