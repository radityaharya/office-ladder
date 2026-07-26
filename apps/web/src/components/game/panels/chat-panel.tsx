import { useState, type FormEvent } from "react";

import { cn } from "@/lib/utils";

import { Panel, type PanelChrome } from "./panel";
import { formatPanelNumber, panelClock, pluralise } from "./panel-format";
import { PanelEmpty, PanelNote, panelSeatClass } from "./panel-parts";
import { PANEL_DEFINITIONS } from "./panel-registry";

/**
 * `ModeRules.social.chat` (spec §4.1). `off` is a real state the panel renders —
 * a destination that silently shows nothing tells a player their messages are
 * being dropped rather than refused.
 */
export type ChatMode = "off" | "quick" | "full";

export type ChatMessageView = {
  readonly id: string;
  readonly authorName: string;
  /** Display seat 1..6, or null for the office/system. */
  readonly seat: number | null;
  readonly origin: "local" | "remote" | "system";
  /** `quick` is a fixed phrase; `text` is free composition. */
  readonly kind: "text" | "quick";
  readonly body: string;
  readonly sentAt: string;
};

/** One entry of the fixed phrase set. */
export type QuickPhrase = {
  readonly id: string;
  readonly label: string;
};

/**
 * The default fixed phrase set.
 *
 * Spec §8.1: `quick` mode "= a fixed phrase/emote set, which is also the only mode
 * bots can meaningfully use". So this list is not decoration — it is the entire
 * expressive vocabulary of a bot seat and of any table playing with free text
 * switched off. Phrases are therefore chosen to cover the things a negotiation
 * actually needs to say (an offer, a refusal, a warning, an acknowledgement)
 * rather than to be funny, and they are authored in the game's own dry register.
 *
 * The server owns the canonical set (it has to, to validate an incoming id); this
 * is the client default so the panel is never empty in `quick` mode, and a host
 * may pass its own.
 */
export const DEFAULT_QUICK_PHRASES: readonly QuickPhrase[] = [
  { id: "phrase.deal", label: "Deal" },
  { id: "phrase.no-deal", label: "No deal" },
  { id: "phrase.thinking", label: "Give me a moment" },
  { id: "phrase.your-turn", label: "Your move" },
  { id: "phrase.nice", label: "Nicely played" },
  { id: "phrase.ouch", label: "That hurt" },
  { id: "phrase.watch-them", label: "Watch the leader" },
  { id: "phrase.later", label: "I owe you one" },
];

type ChatPanelProps = {
  readonly mode: ChatMode;
  /** Oldest first — a conversation reads down the page. */
  readonly messages: readonly ChatMessageView[];
  readonly phrases?: readonly QuickPhrase[];
  /** Server-owned length cap, echoed so a truncation is never a surprise. */
  readonly maxLength?: number;
  /** Rate limit, mute, or disconnection — stated in words, never a dead field. */
  readonly disabledReason?: string | null;
  readonly pending?: boolean;
  readonly onSend?: (body: string) => void;
  readonly onQuickSend?: (phraseId: string) => void;
  readonly scope?: string;
  /** Pass `"none"` when the host already draws panel chrome. */
  readonly chrome?: PanelChrome;
};

const DEFAULT_MAX_LENGTH = 240;

/**
 * Chat: a message list plus a composer.
 *
 * Structurally the odd one out, which is why it is in the kit rather than left to
 * a later wave: everything else in the rail is read-only, and this is the only
 * panel whose footer holds an input. Both of §8.1's modes are built —
 *   - `full` gets the free-text composer AND the phrase set, because a player with
 *     free text still wants one-tap acknowledgements;
 *   - `quick` gets the phrase set only, which is the same surface a bot uses;
 *   - `off` gets a real explanation.
 *
 * Deliberately absent: any recipient selector. Spec §8.1 keeps DMs out of v1
 * ("private channels are a large abuse surface and a moderation obligation"), and
 * `social.directMessages` exists as an off switch rather than a feature. There is
 * nothing to hide later because there is nothing here.
 *
 * Chat is NOT game state (spec §3) and the panel says so in its own footer note,
 * so a player never mistakes a promise typed here for something the engine will
 * enforce.
 *
 * The draft lives in local state. That is the one piece of state in this whole kit,
 * and it is here because a controlled draft would make every keystroke a rail
 * re-render; `renderToStaticMarkup` still sees the correct resting composer,
 * because the initial state is the empty string.
 */
export function ChatPanel({
  mode,
  messages,
  phrases = DEFAULT_QUICK_PHRASES,
  maxLength = DEFAULT_MAX_LENGTH,
  disabledReason = null,
  pending = false,
  onSend,
  onQuickSend,
  scope,
  chrome,
}: ChatPanelProps) {
  const definition = PANEL_DEFINITIONS.chat;
  const [draft, setDraft] = useState("");
  const blocked = disabledReason !== null || pending;

  if (mode === "off") {
    return (
      <Panel
        chrome={chrome}
        panelId={definition.id}
        scope={scope}
        scrollBody={false}
        sizing="content"
        title={definition.title}
      >
        <PanelEmpty
          detail="This mode has chat switched off for everyone at the table, so nothing you type would reach anyone. Table talk is not part of the game state either way — the engine never reads it."
          headline="Chat is off in this mode"
          summary={definition.summary}
        />
      </Panel>
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (body.length === 0 || onSend === undefined || blocked) return;
    onSend(body);
    setDraft("");
  }

  return (
    <Panel
      chrome={chrome}
      footer={
        <>
          {mode === "full" ? (
            <form
              className="panel-chat-composer"
              data-slot="panel-chat-composer"
              onSubmit={submit}
            >
              <label className="sr-only" htmlFor={`${definition.id}-chat-field`}>
                Message the table
              </label>
              <textarea
                className="panel-chat-field"
                data-slot="panel-chat-field"
                disabled={blocked}
                id={`${definition.id}-chat-field`}
                maxLength={maxLength}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Say something to the table"
                rows={2}
                value={draft}
              />
              <div className="panel-chat-composer-foot">
                <span className="panel-sub" data-slot="panel-chat-counter">
                  {formatPanelNumber(draft.length)}/{formatPanelNumber(maxLength)}
                </span>
                <span aria-hidden="true" className="panel-head-spacer" />
                <button
                  className="panel-btn"
                  data-slot="panel-chat-send"
                  data-variant="primary"
                  disabled={blocked || draft.trim().length === 0 || onSend === undefined}
                  type="submit"
                >
                  Send
                </button>
              </div>
            </form>
          ) : null}
          <QuickPhrases
            blocked={blocked}
            mode={mode}
            onQuickSend={onQuickSend}
            phrases={phrases}
          />
          <PanelNote
            slot="panel-chat-rule"
            tone={disabledReason === null ? "idle" : "critical"}
          >
            {disabledReason ?? "Chat is not game state. Nothing said here is enforced by the office."}
          </PanelNote>
        </>
      }
      meta={messages.length === 0 ? undefined : pluralise(messages.length, "message")}
      panelId={definition.id}
      scope={scope}
      title={definition.title}
    >
      {messages.length === 0 ? (
        <PanelEmpty
          detail={
            mode === "quick"
              ? "This table is on quick chat: everyone picks from a fixed phrase set instead of typing, which is also the only way a bot seat can say anything."
              : "Table talk lives here. Nothing said in chat is read by the engine, so a promise made here is worth exactly as much as the player who made it."
          }
          headline="No messages yet"
          summary={definition.summary}
        />
      ) : (
        <ol aria-label="Table chat" className="panel-chat-list" data-slot="panel-chat-list">
          {messages.map((message) => (
            <li
              className={cn("panel-chat-message", panelSeatClass(message.seat))}
              data-panel-kind={message.kind}
              data-panel-origin={message.origin}
              data-slot="panel-chat-message"
              key={message.id}
            >
              <span className="panel-chat-byline">
                <span className="panel-chat-author">
                  {message.origin === "local" ? "You" : message.authorName}
                </span>
                <time className="panel-chat-time" dateTime={message.sentAt}>
                  {panelClock(message.sentAt)}
                </time>
              </span>
              <p className="panel-chat-body">{message.body}</p>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/**
 * The fixed phrase set — `quick` mode in its entirety, and an accelerator in
 * `full` mode.
 *
 * Rendered as real buttons rather than a select, because one tap is the point: a
 * player mid-turn should be able to answer an offer without leaving the board, and
 * a bot's phrase arrives through the same server route.
 */
function QuickPhrases({
  blocked,
  mode,
  onQuickSend,
  phrases,
}: {
  readonly blocked: boolean;
  readonly mode: Exclude<ChatMode, "off">;
  readonly onQuickSend: ((phraseId: string) => void) | undefined;
  readonly phrases: readonly QuickPhrase[];
}) {
  if (phrases.length === 0) return null;

  return (
    <ul
      aria-label={mode === "quick" ? "Phrases you can send" : "Quick phrases"}
      className="panel-chat-quick"
      data-slot="panel-chat-quick"
    >
      {phrases.map((phrase) => (
        <li key={phrase.id}>
          <button
            className="panel-btn"
            data-phrase-id={phrase.id}
            data-slot="panel-chat-phrase"
            disabled={blocked || onQuickSend === undefined}
            onClick={onQuickSend === undefined ? undefined : () => onQuickSend(phrase.id)}
            type="button"
          >
            {phrase.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
