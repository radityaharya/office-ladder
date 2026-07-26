import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DiceReadout, purposeLabel, type DiceRollFeedItem } from "./index";

const movementRoll = {
  eventId: "event-1",
  faces: [6],
  total: 6,
  purpose: "normal-movement",
  rollerName: "Avery",
  isSelf: true,
  isBot: false,
} satisfies DiceRollFeedItem;

describe("DiceReadout", () => {
  it("renders the committed faces on the first synchronous render", () => {
    // Given
    const markup = renderToStaticMarkup(
      <DiceReadout isRolling={false} roll={movementRoll} />,
    );

    // When
    const faces = markup.match(/data-dice-face="\d"/g) ?? [];

    // Then
    expect(faces).toEqual(['data-dice-face="6"']);
    expect(markup).toContain('data-dice-state="settled"');
    expect(markup).toContain('data-dice-led="live"');
    expect(markup).toContain("Committed");
  });

  it("labels a readout with its purpose and an accessible section name", () => {
    // Given
    const markup = renderToStaticMarkup(
      <DiceReadout isRolling={false} roll={movementRoll} />,
    );

    // Then
    expect(markup).toContain('aria-label="Dice readout"');
    expect(markup).toContain("Movement roll");
    expect(markup).toContain("Rolled by");
    expect(markup).toContain("Status");
  });

  it("is focusable so its horizontal scroll is keyboard-operable", () => {
    // Given — the instrument is `overflow-x: auto` and goes full width below
    // 768px, and a scroll container that cannot take focus cannot be scrolled
    // without a pointer (WCAG 2.1.1).
    const markup = renderToStaticMarkup(
      <DiceReadout isRolling={false} roll={movementRoll} />,
    );

    // Then
    expect(markup).toContain('tabindex="0"');
  });

  it("names a remote roller instead of relying on colour or position", () => {
    // Given
    const markup = renderToStaticMarkup(
      <DiceReadout
        isRolling={false}
        roll={{ ...movementRoll, isSelf: false, rollerName: "Morgan" }}
      />,
    );

    // Then
    expect(markup).toContain("Morgan");
    expect(markup).toContain("Morgan rolled 6.");
  });

  it("marks a bot roller with an explicit text tag", () => {
    // Given
    const markup = renderToStaticMarkup(
      <DiceReadout
        isRolling={false}
        roll={{ ...movementRoll, isSelf: false, isBot: true, rollerName: "Auto-Morgan" }}
      />,
    );

    // Then
    expect(markup).toContain("Auto-Morgan · Bot");
  });

  it("renders one cell per real face and only totals a multi-die roll", () => {
    // Given
    const single = renderToStaticMarkup(
      <DiceReadout isRolling={false} roll={movementRoll} />,
    );
    const pair = renderToStaticMarkup(
      <DiceReadout
        isRolling={false}
        roll={{ ...movementRoll, faces: [2, 2], total: 4, purpose: "audit-release" }}
      />,
    );

    // When
    const pairFaces = pair.match(/data-dice-face="\d"/g) ?? [];

    // Then
    expect(single).not.toContain('data-slot="dice-readout-total"');
    expect(pairFaces).toHaveLength(2);
    expect(pair).toContain('data-slot="dice-readout-total"');
    expect(pair).toContain("Audit release roll");
    expect(pair).toContain("You rolled 2 and 2. Total 4.");
  });

  it("holds an unresolved cell while a local roll is in flight", () => {
    // Given
    const markup = renderToStaticMarkup(<DiceReadout isRolling roll={null} />);

    // Then
    expect(markup).toContain('data-dice-state="rolling"');
    expect(markup).toContain('data-dice-face=""');
    expect(markup).toContain("Rolling");
    expect(markup).toContain("Movement roll");
  });

  it("keeps the previous faces visible while the next roll is requested", () => {
    // Given
    const markup = renderToStaticMarkup(<DiceReadout isRolling roll={movementRoll} />);

    // Then
    expect(markup).toContain('data-dice-state="rolling"');
    expect(markup).toContain("Rolling");
  });

  it("stays legible before any roll is recorded", () => {
    // Given
    const markup = renderToStaticMarkup(<DiceReadout isRolling={false} roll={null} />);

    // Then
    expect(markup).toContain('data-dice-state="empty"');
    expect(markup).toContain('data-dice-led="idle"');
    expect(markup).toContain("Idle");
    expect(markup).toContain("—");
  });

  it("announces a settled roll once and stays quiet otherwise", () => {
    // Given
    const settled = renderToStaticMarkup(
      <DiceReadout isRolling={false} roll={movementRoll} />,
    );
    const rolling = renderToStaticMarkup(<DiceReadout isRolling roll={movementRoll} />);

    // Then
    expect(settled).toContain('aria-live="polite"');
    expect(settled).toContain("You rolled 6.");
    expect(rolling).not.toContain("You rolled 6.");
  });

  it("renders every cell already locked on the first synchronous render", () => {
    // Given — the settle is one-shot and keyed off the committed event id, so a
    // board loaded mid-match must show its last real roll *seated*, not drop it
    // in on mount. This is also what makes the reduced-motion requirement real:
    // the faces are in the markup, not only in the animation.
    const markup = renderToStaticMarkup(
      <DiceReadout
        isRolling={false}
        roll={{ ...movementRoll, faces: [2, 5], total: 7, purpose: "audit-release" }}
      />,
    );

    // When
    const locked = markup.match(/data-dice-locked="true"/g) ?? [];

    // Then
    expect(locked).toHaveLength(2);
    expect(markup).not.toContain('data-dice-locked="false"');
    expect(markup).toContain('data-dice-face="2"');
    expect(markup).toContain('data-dice-face="5"');
  });

  it("states whose roll it was three ways, so a glance is enough", () => {
    // Given — following a bot round is the whole point; "which seat rolled that"
    // must not depend on colour alone (DESIGN.md §8) or on reading the log.
    const markup = renderToStaticMarkup(
      <DiceReadout
        isRolling={false}
        roll={{
          ...movementRoll,
          isSelf: false,
          isBot: true,
          rollerName: "Contract Auditor",
          seat: 3,
        }}
      />,
    );

    // Then — seat numeral, seat colour class, and the name with its bot tag.
    expect(markup).toContain('data-slot="dice-readout-seat"');
    expect(markup).toContain("dice-seat dice-seat-3");
    expect(markup).toContain(">3</span>");
    expect(markup).toContain("Seat 3.");
    expect(markup).toContain("Contract Auditor · Bot");
    expect(markup).toContain('data-dice-actor="bot"');
  });

  it("marks the actor kind so a local roll can be distinguished tonally", () => {
    // Given
    const own = renderToStaticMarkup(
      <DiceReadout isRolling={false} roll={movementRoll} />,
    );
    const remote = renderToStaticMarkup(
      <DiceReadout isRolling={false} roll={{ ...movementRoll, isSelf: false }} />,
    );
    const idle = renderToStaticMarkup(<DiceReadout isRolling={false} roll={null} />);
    const inFlight = renderToStaticMarkup(<DiceReadout isRolling roll={null} />);

    // Then
    expect(own).toContain('data-dice-actor="self"');
    expect(remote).toContain('data-dice-actor="remote"');
    expect(idle).toContain('data-dice-actor="none"');
    expect(inFlight).toContain('data-dice-actor="self"');
  });

  it("omits the seat chip for a roll with no seat", () => {
    // Given — a system roll has no seat, and an absent seat must not render a
    // chip labelled "null".
    const markup = renderToStaticMarkup(
      <DiceReadout
        isRolling={false}
        roll={{ ...movementRoll, isSelf: false, rollerName: "System", seat: null }}
      />,
    );

    // Then
    expect(markup).not.toContain('data-slot="dice-readout-seat"');
    expect(markup).toContain("System");
  });
});

describe("purposeLabel", () => {
  it("names the authored purposes the engine actually emits", () => {
    // Then
    expect(purposeLabel("normal-movement")).toBe("Movement roll");
    expect(purposeLabel("audit-release")).toBe("Audit release roll");
  });

  it("falls back to a readable label for an unknown purpose", () => {
    // Then
    expect(purposeLabel("reaction.window-open")).toBe("Reaction window open roll");
    expect(purposeLabel("")).toBe("Roll");
  });
});
