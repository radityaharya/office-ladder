import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EMOTES, QUICK_CHAT_PHRASES } from "@office-ladder/contracts";
import type { ChatMessage } from "@/realtime/chat-channel";

import {
  ChatPanel,
  DEFAULT_EMOTES,
  emoteLabel,
  quickPhraseLabel,
  quickPhrasesFor,
  SERVER_QUICK_PHRASES,
  toChatMessageViews,
  type ChatMessageView,
  type ChatSeat,
} from "./chat-panel";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const SEATS: readonly ChatSeat[] = [
  { playerId: "player-avery", seat: 1, name: "Alex" },
  { playerId: "player-morgan", seat: 2, name: "Alex" },
  { playerId: "player-bot", seat: 3, name: "Contract Auditor", isBot: true },
];

const MINE: ChatMessageView = {
  id: "message-2",
  authorName: "Alex",
  seat: 1,
  origin: "local",
  kind: "text",
  body: "Only if you stay off my tiles.",
  sentAt: "2026-07-26T09:42:11.000Z",
};

const THEIRS: ChatMessageView = {
  id: "message-1",
  authorName: "Alex",
  seat: 2,
  origin: "remote",
  kind: "text",
  body: "Fund my project and I will leave your tiles alone.",
  sentAt: "2026-07-26T09:41:07.000Z",
};

function transportMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "message-1",
    roomId: "room-1",
    authorId: "player-morgan",
    kind: "text",
    body: "Fund my project.",
    createdAt: "2026-07-26T09:41:07.000Z",
    authorName: "Stored name",
    reactions: [],
    ...overrides,
  };
}

/** The markup of the one element carrying `data-slot="<slot>"`, opening tag only. */
function tagWithSlot(markup: string, slot: string): string {
  const match = new RegExp(`<[a-z]+[^>]*data-slot="${slot}"[^>]*>`).exec(markup);
  return match?.[0] ?? "";
}

/* -------------------------------------------------------------------------- */
/* Modes                                                                      */
/* -------------------------------------------------------------------------- */

describe("the three chat modes are all real surfaces", () => {
  it("gives full mode free text capped at the server's own limit", () => {
    // When
    const markup = renderToStaticMarkup(
      <ChatPanel maxLength={280} messages={[THEIRS]} mode="full" onSend={() => undefined} />,
    );

    // Then
    expect(markup).toContain('data-slot="panel-chat-field"');
    expect(markup).toContain('maxLength="280"');
    expect(markup).toContain("0/280");
  });

  it("gives quick mode a phrase set and an emote set, and no way to type", () => {
    // When — the inclusive surface, and the only one a bot seat can use (§8.1).
    const markup = renderToStaticMarkup(
      <ChatPanel
        messages={[THEIRS]}
        mode="quick"
        onQuickSend={() => undefined}
        onReact={() => undefined}
        phrases={SERVER_QUICK_PHRASES}
      />,
    );

    // Then
    expect(markup).not.toContain('data-slot="panel-chat-field"');
    expect(markup).not.toContain('data-slot="panel-chat-composer"');
    expect(markup.match(/data-slot="panel-chat-phrase"/g) ?? []).toHaveLength(
      SERVER_QUICK_PHRASES.length,
    );
    expect(markup.match(/data-slot="panel-chat-emote"/g) ?? []).toHaveLength(
      DEFAULT_EMOTES.length,
    );
  });

  it("states the reason chat is off instead of showing an inert box", () => {
    // When
    const markup = renderToStaticMarkup(
      <ChatPanel
        messages={[]}
        mode="off"
        offReason="This table has chat switched off, so nothing you send would reach anyone."
      />,
    );

    // Then — a destination that silently shows nothing tells a player their
    // messages are being sent when they are not.
    expect(markup).toContain("Chat is off in this mode");
    expect(markup).toContain("nothing you send would reach anyone");
    expect(markup).not.toContain('data-slot="panel-chat-quick"');
    expect(markup).not.toContain('data-slot="panel-chat-field"');
    expect(markup).not.toContain('data-slot="panel-chat-emotes"');
  });

  it("offers the phrase ids the server actually validates against", () => {
    // Given — a phrase id the send route does not know is a 400 the player
    // cannot fix, and this list and `QUICK_CHAT_PHRASES` are the two halves of
    // one contract.
    const offered = SERVER_QUICK_PHRASES.map((phrase) => phrase.id);

    // Then
    expect([...offered].sort()).toEqual([...QUICK_CHAT_PHRASES].sort());
    for (const phrase of SERVER_QUICK_PHRASES) {
      expect(phrase.label).not.toContain("chat.phrase.");
      expect(quickPhraseLabel(phrase.id)).toBe(phrase.label);
    }
    // An id from a newer build is printed rather than thrown away.
    expect(quickPhraseLabel("chat.phrase.invented")).toBe("chat.phrase.invented");
  });

  it("gives quick mode the whole phrase set and full mode a short accelerator strip", () => {
    // Given — in `quick` the set is the entire vocabulary and none of it may be
    // withheld; in `full` the player can type any of the twelve, so the strip is
    // trimmed rather than allowed to take four wrapped rows of a 320px rail.
    expect(quickPhrasesFor("quick")).toEqual(SERVER_QUICK_PHRASES);
    expect(quickPhrasesFor("full").length).toBeLessThan(SERVER_QUICK_PHRASES.length);
    expect(quickPhrasesFor("full").length).toBeGreaterThan(0);
    expect(quickPhrasesFor("off")).toEqual([]);

    // Every accelerator is still a real server phrase.
    for (const phrase of quickPhrasesFor("full")) {
      expect(QUICK_CHAT_PHRASES).toContain(phrase.id);
    }
  });

  it("offers exactly the emotes the reaction endpoint accepts", () => {
    expect([...DEFAULT_EMOTES.map((emote) => emote.id)].sort()).toEqual([...EMOTES].sort());
    for (const emote of DEFAULT_EMOTES) {
      // Every glyph travels with a word (§8): an icon is never the only carrier.
      expect(emoteLabel(emote.id)).toBe(emote.label);
      expect(emote.label).not.toContain("emote.");
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Identity                                                                   */
/* -------------------------------------------------------------------------- */

describe("own versus opponent is structural, not a name tag", () => {
  it("separates the viewer's own line from an opponent's with the same display name", () => {
    // Given two players who are both called Alex — the case a name label cannot
    // answer (§12.1).
    const markup = renderToStaticMarkup(
      <ChatPanel messages={[THEIRS, MINE]} mode="full" />,
    );
    const rows = markup.match(/<li[^>]*data-slot="panel-chat-message"[^>]*>/g) ?? [];

    // Then — origin and seat are on the row itself, so the split is readable
    // without parsing any text.
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('data-panel-origin="remote"');
    expect(rows[0]).toContain("panel-seat-2");
    expect(rows[1]).toContain('data-panel-origin="local"');
    expect(rows[1]).toContain("panel-seat-1");

    // And the byline says "You" rather than repeating the ambiguous name, with
    // the same fact stated in text for assistive tech.
    expect(markup).toContain(">You<");
    expect(markup).toContain("Your message.");
    expect(markup.match(/Your message\./g) ?? []).toHaveLength(1);
  });

  it("marks a quick phrase as a fixed utterance rather than something typed", () => {
    // When
    const markup = renderToStaticMarkup(
      <ChatPanel
        messages={[{ ...THEIRS, kind: "quick", body: "No deal" }]}
        mode="quick"
      />,
    );

    // Then
    expect(markup).toContain('data-panel-kind="quick"');
    expect(markup).toContain("No deal");
  });

  it("keeps the office's own lines unseated", () => {
    // When
    const markup = renderToStaticMarkup(
      <ChatPanel
        messages={[{ ...THEIRS, origin: "system", seat: null, authorName: "The office" }]}
        mode="full"
      />,
    );

    // Then — no seat rule, because no seat said it.
    expect(markup).toContain('data-panel-origin="system"');
    expect(markup).not.toContain("panel-seat-");
  });
});

/* -------------------------------------------------------------------------- */
/* Reactions                                                                  */
/* -------------------------------------------------------------------------- */

describe("emote reactions", () => {
  const reacted: ChatMessageView = {
    ...THEIRS,
    reactions: [
      { id: "emote.fire", label: "Brutal", count: 2, mine: true },
      { id: "emote.laugh", label: "Funny", count: 1, mine: false },
    ],
  };

  it("renders a tally per emote and marks the viewer's own with more than colour", () => {
    // When
    const markup = renderToStaticMarkup(
      <ChatPanel messages={[reacted]} mode="full" onReact={() => undefined} />,
    );
    const tallies = markup.match(/<button[^>]*data-slot="panel-chat-tally"[^>]*>/g) ?? [];

    // Then
    expect(tallies).toHaveLength(2);
    expect(tallies[0]).toContain('data-emote-id="emote.fire"');
    expect(tallies[0]).toContain('aria-pressed="true"');
    expect(tallies[1]).toContain('aria-pressed="false"');

    // The pressed state is also a shape and a sentence, never a hue alone (§8).
    expect(markup).toContain('data-tone="active"');
    expect(markup).toContain("Your reaction. Activate to clear it.");
    expect(markup).toContain("Activate to add yours.");
  });

  it("draws no reaction row on a message nobody has reacted to", () => {
    // When
    const markup = renderToStaticMarkup(<ChatPanel messages={[THEIRS]} mode="full" />);

    // Then
    expect(markup).not.toContain('data-slot="panel-chat-tallies"');
  });

  it("withdraws the palette when the room has emote reactions switched off", () => {
    // When
    const markup = renderToStaticMarkup(
      <ChatPanel emotes={[]} messages={[reacted]} mode="full" onReact={() => undefined} />,
    );

    // Then — the palette is gone, but tallies already sent are still readable: a
    // reaction does not un-happen when the switch flips.
    expect(markup).not.toContain('data-slot="panel-chat-emotes"');
    expect(markup).toContain('data-slot="panel-chat-tallies"');
  });

  it("names the message the palette targets", () => {
    // When
    const theirs = renderToStaticMarkup(
      <ChatPanel messages={[THEIRS]} mode="full" onReact={() => undefined} />,
    );
    const mine = renderToStaticMarkup(
      <ChatPanel messages={[MINE]} mode="full" onReact={() => undefined} />,
    );

    // Then — "react" is never ambiguous about what it reacts to.
    expect(theirs).toContain("React to Alex&#x27;s last message");
    expect(mine).toContain("React to your own last message");
  });

  it("offers no palette at all until there is something to react to", () => {
    // When
    const markup = renderToStaticMarkup(
      <ChatPanel messages={[]} mode="quick" onReact={() => undefined} />,
    );

    // Then
    expect(markup).not.toContain('data-slot="panel-chat-emote"');
    expect(markup).toContain("No messages yet");
  });
});

/* -------------------------------------------------------------------------- */
/* Refusals, pagination, layout invariants                                    */
/* -------------------------------------------------------------------------- */

describe("refusals and paging", () => {
  it("disables the composer and says why when a refusal blocks posting", () => {
    // When
    const markup = renderToStaticMarkup(
      <ChatPanel
        disabledReason="You are sending messages too quickly. Wait a few seconds and try again."
        messages={[THEIRS]}
        mode="full"
        onQuickSend={() => undefined}
        onReact={() => undefined}
        onSend={() => undefined}
      />,
    );

    // Then
    expect(markup).toContain("You are sending messages too quickly.");
    expect(tagWithSlot(markup, "panel-chat-field")).toContain("disabled");
    expect(tagWithSlot(markup, "panel-chat-rule")).toContain('data-slot="panel-chat-rule"');
    expect(markup.match(/disabled=""/g)?.length ?? 0).toBeGreaterThan(1);
  });

  it("states a non-blocking refusal without greying the whole surface out", () => {
    // When — a refused emote is not a mute.
    const markup = renderToStaticMarkup(
      <ChatPanel
        messages={[THEIRS]}
        mode="full"
        notice="One emote per message. Clear the one you have before adding another."
        onQuickSend={() => undefined}
        onReact={() => undefined}
        onSend={() => undefined}
      />,
    );

    // Then
    expect(markup).toContain('data-slot="panel-chat-notice"');
    expect(markup).toContain("One emote per message.");
    expect(tagWithSlot(markup, "panel-chat-field")).not.toContain("disabled");
    expect(tagWithSlot(markup, "panel-chat-phrase")).not.toContain("disabled");
    expect(tagWithSlot(markup, "panel-chat-emote")).not.toContain("disabled");
    // Send stays disabled because the draft is empty — a state of the composer,
    // not of the room. Every other control is live.
    expect(tagWithSlot(markup, "panel-chat-send")).toContain("disabled");
  });

  it("hangs the older-history control off the header, never inside the list", () => {
    // Given
    const without = renderToStaticMarkup(<ChatPanel messages={[THEIRS]} mode="full" />);
    const with_ = renderToStaticMarkup(
      <ChatPanel hasOlder messages={[THEIRS]} mode="full" onLoadOlder={() => undefined} />,
    );
    const loading = renderToStaticMarkup(
      <ChatPanel
        hasOlder
        loadingOlder
        messages={[THEIRS]}
        mode="full"
        onLoadOlder={() => undefined}
      />,
    );

    // Then — a control inside a scrolling list moves as the list grows, and
    // prepending rows above it is what loses a reader's place.
    expect(without).not.toContain('data-slot="panel-chat-older"');
    expect(with_).toContain('data-slot="panel-chat-older"');
    expect(with_).toContain('data-slot="panel-head-action"');
    expect(loading).toContain("Loading");
    expect(tagWithSlot(loading, "panel-chat-older")).toContain("disabled");
  });

  it("renders its whole resting state on the first pass, with no hidden rows", () => {
    // When
    const markup = renderToStaticMarkup(
      <ChatPanel messages={[THEIRS, MINE]} mode="full" />,
    );

    // Then — §12.6's arrival reveal is one-shot and only for rows that arrive
    // AFTER mount, so nothing in the static render depends on JavaScript to
    // become visible.
    expect(markup).not.toContain("opacity:0");
    expect(markup).not.toContain("opacity: 0");
    expect(markup).toContain('data-slot="panel-chat-anchor"');
  });

  it("carries no recipient selector, because DMs are deliberately not in v1", () => {
    // When
    const markup = renderToStaticMarkup(
      <ChatPanel messages={[THEIRS, MINE]} mode="full" onSend={() => undefined} />,
    );

    // Then — §8.1 rules private channels out; there is nothing here to hide later
    // because there is nothing here.
    expect(markup).not.toContain("<select");
    expect(markup.toLowerCase()).not.toContain("whisper");
    expect(markup.toLowerCase()).not.toContain("recipient");
    expect(markup).toContain("Chat is not game state.");
  });
});

/* -------------------------------------------------------------------------- */
/* Transport-to-view mapping                                                  */
/* -------------------------------------------------------------------------- */

describe("toChatMessageViews", () => {
  it("decides mine-versus-theirs by id, never by name", () => {
    // Given two members with identical display names.
    const views = toChatMessageViews(
      [
        transportMessage({ id: "message-1", authorId: "player-morgan" }),
        transportMessage({
          id: "message-2",
          authorId: "player-avery",
          createdAt: "2026-07-26T09:42:00.000Z",
        }),
      ],
      { selfPlayerId: "player-avery", seats: SEATS },
    );

    // Then
    expect(views[0].origin).toBe("remote");
    expect(views[0].seat).toBe(2);
    expect(views[1].origin).toBe("local");
    expect(views[1].seat).toBe(1);
    expect(views[0].authorName).toBe(views[1].authorName);
  });

  it("prefers the roster's name over the one stored with the message", () => {
    // Given a display name that has changed since the line was sent.
    const [view] = toChatMessageViews([transportMessage()], {
      selfPlayerId: "player-avery",
      seats: SEATS,
    });

    // Then — the chat log agrees with the board and the seat glyphs.
    expect(view.authorName).toBe("Alex");
  });

  it("resolves a quick phrase id into words", () => {
    // Given
    const [view] = toChatMessageViews(
      [transportMessage({ kind: "quick", body: "chat.phrase.no-deal" })],
      { selfPlayerId: "player-avery", seats: SEATS },
    );

    // Then — the id is what crosses the wire; the wording is this client's.
    expect(view.kind).toBe("quick");
    expect(view.body).toBe("No deal");
  });

  it("reads an authorless line as the office, and an unknown author as unseated", () => {
    // Given
    const views = toChatMessageViews(
      [
        transportMessage({ id: "message-1", authorId: null, authorName: null }),
        transportMessage({
          id: "message-2",
          authorId: "player-departed",
          authorName: null,
          createdAt: "2026-07-26T09:43:00.000Z",
        }),
      ],
      { selfPlayerId: "player-avery", seats: SEATS },
    );

    // Then — neither case is a blank byline.
    expect(views[0]).toMatchObject({ origin: "system", seat: null, authorName: "The office" });
    expect(views[1]).toMatchObject({ origin: "remote", seat: null, authorName: "Unseated" });
  });

  it("carries tallies through with their labels", () => {
    // Given
    const [view] = toChatMessageViews(
      [transportMessage({ reactions: [{ emote: "emote.fire", count: 3, mine: true }] })],
      { selfPlayerId: "player-avery", seats: SEATS },
    );

    // Then
    expect(view.reactions).toEqual([
      { id: "emote.fire", label: "Brutal", count: 3, mine: true },
    ]);
  });
});
