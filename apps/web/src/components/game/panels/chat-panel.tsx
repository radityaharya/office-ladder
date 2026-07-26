import {
  RiAlarmWarningLine,
  RiEmotionLaughLine,
  RiEmotionSadLine,
  RiEyeLine,
  RiFireLine,
  RiMedalLine,
  RiThumbDownLine,
  RiThumbUpLine,
} from "@remixicon/react";
import { useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type FormEvent,
} from "react";

import { cn } from "@/lib/utils";
import { EASING_STANDARD_BEZIER, GAMEPLAY_MOTION_MS } from "@/lib/motion";
import {
  applyChatReaction,
  ChatTransportError,
  chatRefusalBlocksComposer,
  chatRefusalMessage,
  CHAT_TEXT_MAX_LENGTH,
  effectiveChatMode,
  EMPTY_CHAT_FEED,
  fetchChatHistory,
  isEmote,
  narrowestModeRefusal,
  RATE_LIMIT_COOLDOWN_MS,
  reactToChatMessage,
  receiveChatHistoryPage,
  receiveChatMessage,
  receiveChatMessages,
  receiveChatReaction,
  sendChatMessage,
  subscribeRoomChat,
  type ChatFeed,
  type ChatMessage,
  type ChatRefusalCode,
} from "@/realtime/chat-channel";

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

/** One emote's tally on a message, as this viewer sees it. */
export type ChatMessageReaction = {
  /** The contract emote id, e.g. `emote.thumbs-up`. Drives the glyph lookup. */
  readonly id: string;
  /** What the emote means, in words. Never omitted — a glyph alone fails §8. */
  readonly label: string;
  readonly count: number;
  /** Whether the viewer is one of the `count`. */
  readonly mine: boolean;
};

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
  /** Emotes already on this message. Omit or pass `[]` for none. */
  readonly reactions?: readonly ChatMessageReaction[];
};

/** One entry of the fixed phrase set. */
export type QuickPhrase = {
  readonly id: string;
  readonly label: string;
};

/** One entry of the fixed emote set. */
export type ChatEmoteOption = {
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
 * **These ids are this component's own, not the server's.** `QUICK_CHAT_PHRASES`
 * in `packages/contracts` is the set the send endpoint validates against, and the
 * two do not agree (`phrase.deal` here, `chat.phrase.deal` there). Anything wired
 * to the server therefore passes {@link SERVER_QUICK_PHRASES} — which
 * {@link RoomChatPanel} does — and this list survives only as the unwired default
 * that `panel-destinations.test.tsx` asserts on. Retiring it is a one-line change
 * plus three assertions in a file this wave does not own; see the wave report.
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

/**
 * The phrase set the SERVER accepts, with this client's wording.
 *
 * Ids are `QUICK_CHAT_PHRASES` from `packages/contracts` verbatim, because the
 * send route validates the body against that enum and a mismatched id is a 400
 * the player cannot fix. The labels are ours: contracts is explicit that "the
 * client owns the wording, so the same room can be read in two languages and a
 * bot can 'speak' without generating text".
 *
 * Order is the order they are offered in. Openers first, then the negotiation
 * pair, then the reactions, then the closers — a player reaching for "No deal"
 * mid-turn should not have to read the whole strip.
 */
export const SERVER_QUICK_PHRASES: readonly QuickPhrase[] = [
  { id: "chat.phrase.deal", label: "Deal" },
  { id: "chat.phrase.no-deal", label: "No deal" },
  { id: "chat.phrase.thinking", label: "Give me a moment" },
  { id: "chat.phrase.your-turn", label: "Your move" },
  { id: "chat.phrase.nice-move", label: "Nice move" },
  { id: "chat.phrase.well-played", label: "Well played" },
  { id: "chat.phrase.ouch", label: "Ouch" },
  { id: "chat.phrase.sorry", label: "Sorry" },
  { id: "chat.phrase.thanks", label: "Thanks" },
  { id: "chat.phrase.hello", label: "Hello" },
  { id: "chat.phrase.good-luck", label: "Good luck" },
  { id: "chat.phrase.good-game", label: "Good game" },
];

const SERVER_QUICK_PHRASE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  SERVER_QUICK_PHRASES.map((phrase) => [phrase.id, phrase.label]),
);

/**
 * How many phrases a `full` table is offered as accelerators.
 *
 * All twelve is the right answer in `quick` mode, where the set is the entire
 * vocabulary. In `full` mode it is not: twelve chips is four wrapped rows in a
 * 320px rail (§12.7), and the footer has to share that column with a textarea,
 * an emote row and a note without squeezing the conversation to nothing. A
 * player with free text loses no capability from a shorter strip — they can type
 * any of the twelve — so the strip is trimmed to the negotiation verbs that are
 * actually wanted mid-turn.
 */
const FULL_MODE_ACCELERATORS = 4;

/**
 * The phrase set to offer for a mode.
 *
 * Pure and exported so the density decision above is a testable rule rather than
 * a number buried in a render.
 */
export function quickPhrasesFor(mode: ChatMode): readonly QuickPhrase[] {
  if (mode === "off") return [];
  if (mode === "quick") return SERVER_QUICK_PHRASES;
  return SERVER_QUICK_PHRASES.slice(0, FULL_MODE_ACCELERATORS);
}

/**
 * The wording for a phrase id, falling back to the id itself.
 *
 * The fallback is deliberate rather than a crash: a room may hold phrases sent
 * by a newer build than the one reading them, and an unrecognised id printed raw
 * is a legible artefact, whereas a thrown render is a blank rail.
 */
export function quickPhraseLabel(phraseId: string): string {
  return SERVER_QUICK_PHRASE_LABELS[phraseId] ?? phraseId;
}

/**
 * The emote set, matching `EMOTES` in `packages/contracts`.
 *
 * Spec §8.2: emotes are reactions **on messages**, capped at one per player per
 * message, and never in `GameState`. There is deliberately no emote aimed at a
 * *player* — contracts calls that "a harassment primitive with no gameplay use" —
 * so every option here targets a line somebody chose to say.
 */
export const DEFAULT_EMOTES: readonly ChatEmoteOption[] = [
  { id: "emote.thumbs-up", label: "Agree" },
  { id: "emote.thumbs-down", label: "Disagree" },
  { id: "emote.laugh", label: "Funny" },
  { id: "emote.shock", label: "Shocked" },
  { id: "emote.sad", label: "Sympathy" },
  { id: "emote.fire", label: "Brutal" },
  { id: "emote.clap", label: "Respect" },
  { id: "emote.eyes", label: "Watching" },
];

const EMOTE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  DEFAULT_EMOTES.map((emote) => [emote.id, emote.label]),
);

export function emoteLabel(emoteId: string): string {
  return EMOTE_LABELS[emoteId] ?? emoteId;
}

/**
 * The glyph for each emote.
 *
 * Line icons from the system's own icon set rather than emoji: an emoji is a
 * second typeface with its own colour palette, which §4 and §2.2 both rule out.
 * Every glyph is `aria-hidden` and travels with its label, so the icon is never
 * the only carrier (§8).
 */
type GlyphComponent = ComponentType<{ readonly size?: number | string }>;

const EMOTE_GLYPHS: Readonly<Record<string, GlyphComponent>> = {
  "emote.thumbs-up": RiThumbUpLine,
  "emote.thumbs-down": RiThumbDownLine,
  "emote.laugh": RiEmotionLaughLine,
  "emote.shock": RiAlarmWarningLine,
  "emote.sad": RiEmotionSadLine,
  "emote.fire": RiFireLine,
  "emote.clap": RiMedalLine,
  "emote.eyes": RiEyeLine,
};

const EMOTE_GLYPH_SIZE = 12;

type ChatPanelProps = {
  readonly mode: ChatMode;
  /** Oldest first — a conversation reads down the page. */
  readonly messages: readonly ChatMessageView[];
  readonly phrases?: readonly QuickPhrase[];
  /**
   * The emote palette. Pass `[]` when the room has `social.emoteReactions` off —
   * held tallies still render, because a reaction someone already sent does not
   * disappear when the switch flips.
   */
  readonly emotes?: readonly ChatEmoteOption[];
  /** Server-owned length cap, echoed so a truncation is never a surprise. */
  readonly maxLength?: number;
  /** Rate limit, mute, or disconnection — stated in words, never a dead field. */
  readonly disabledReason?: string | null;
  /**
   * A refusal that does NOT stop the player composing — a rejected emote, a stale
   * cursor. Stated in the same note line, without disabling the composer, because
   * greying out the whole surface over a failed reaction is a lie about what is
   * available.
   */
  readonly notice?: string | null;
  /** Extra sentence for `off` mode: the server's own reason, when there is one. */
  readonly offReason?: string | null;
  readonly pending?: boolean;
  readonly onSend?: (body: string) => void;
  readonly onQuickSend?: (phraseId: string) => void;
  /** Toggles one emote on one message. `removed` is what the click asks for. */
  readonly onReact?: (messageId: string, emoteId: string, removed: boolean) => void;
  readonly hasOlder?: boolean;
  readonly loadingOlder?: boolean;
  readonly onLoadOlder?: () => void;
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
 * panel whose footer holds an input. All three of §8.1's modes are built —
 *   - `full` gets the free-text composer AND the phrase set, because a player with
 *     free text still wants one-tap acknowledgements;
 *   - `quick` gets the phrase set and the emote set only, which is the same
 *     surface a bot uses — not a degraded mode, the inclusive one;
 *   - `off` gets a real explanation, plus the server's own reason when the client
 *     learned the mode from a refusal rather than from configuration.
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
 * **Own versus opponent is structural, not a name tag** (§12.1). A `local` row
 * carries a tonal step, its own seat rule, the word "You" in place of a name and
 * an `sr-only` "Your message." — four carriers, none of them colour alone, all
 * readable in peripheral vision without parsing the byline.
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
  emotes = DEFAULT_EMOTES,
  maxLength = DEFAULT_MAX_LENGTH,
  disabledReason = null,
  notice = null,
  offReason = null,
  pending = false,
  onSend,
  onQuickSend,
  onReact,
  hasOlder = false,
  loadingOlder = false,
  onLoadOlder,
  scope,
  chrome,
}: ChatPanelProps) {
  const definition = PANEL_DEFINITIONS.chat;
  const [draft, setDraft] = useState("");
  const blocked = disabledReason !== null || pending;
  const newest = messages.length === 0 ? null : messages[messages.length - 1];

  if (mode === "off") {
    return (
      <Panel
        chrome={chrome}
        footer={
          offReason === null ? undefined : (
            <PanelNote slot="panel-chat-rule" tone="critical">
              {offReason}
            </PanelNote>
          )
        }
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
      action={
        /*
         * History is paginated (§11.2) and the control that walks it lives in the
         * header rather than at the top of the list: a control INSIDE a scrolling
         * list moves as the list grows, and pressing it prepends rows above
         * itself, which is the one motion in a chat log that loses a reader's
         * place.
         */
        hasOlder ? (
          <button
            className="panel-btn"
            data-slot="panel-chat-older"
            disabled={loadingOlder || onLoadOlder === undefined}
            onClick={onLoadOlder}
            type="button"
          >
            {loadingOlder ? "Loading" : "Older"}
          </button>
        ) : null
      }
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
          <EmotePalette
            blocked={blocked}
            emotes={emotes}
            onReact={onReact}
            target={newest}
          />
          <PanelNote
            slot="panel-chat-rule"
            tone={disabledReason === null ? "idle" : "critical"}
          >
            {disabledReason ?? "Chat is not game state. Nothing said here is enforced by the office."}
          </PanelNote>
          {notice === null ? null : (
            <PanelNote slot="panel-chat-notice" tone="caution">
              {notice}
            </PanelNote>
          )}
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
        <ChatMessageList blocked={blocked} messages={messages} onReact={onReact} />
      )}
    </Panel>
  );
}

/**
 * The message list.
 *
 * Split out of {@link ChatPanel} so the arrival animation and the scroll anchor
 * have somewhere to live that is not also the composer: both are keyed on the
 * message set, and neither should re-run because somebody typed a character.
 */
function ChatMessageList({
  blocked,
  messages,
  onReact,
}: {
  readonly blocked: boolean;
  readonly messages: readonly ChatMessageView[];
  readonly onReact: ChatPanelProps["onReact"];
}) {
  const history = useHistoryMessageIds(messages);
  const reduceMotion = useReducedMotion() ?? false;
  const anchor = useNewestMessageAnchor(messages.length);

  return (
    <ol aria-label="Table chat" className="panel-chat-list" data-slot="panel-chat-list">
      {messages.map((message) => (
        <ChatMessageRow
          arrival={!reduceMotion && !history.has(message.id)}
          blocked={blocked}
          key={message.id}
          message={message}
          onReact={onReact}
        />
      ))}
      {/*
        Out-of-flow scroll target, not a row: `scrollIntoView` needs an element
        at the end of the list and a zero-height `li` cannot shift the layout of
        the rows above it.
      */}
      <li aria-hidden="true" data-slot="panel-chat-anchor" ref={anchor} />
    </ol>
  );
}

/**
 * The message ids that were already on screen when the list first rendered.
 *
 * Same device as the activity log's `useHistoryEntryIds`, for the same reason:
 * those rows are history and must render at rest, so no inline `opacity: 0` ever
 * reaches the markup and the first synchronous render — the one
 * `renderToStaticMarkup` asserts on — is already the correct resting state.
 * Everything after is an arrival and gets §12.6's one-shot reveal.
 */
function useHistoryMessageIds(messages: readonly ChatMessageView[]): ReadonlySet<string> {
  const [history] = useState(() => new Set(messages.map((message) => message.id)));
  return history;
}

/**
 * Keeps the newest message in view.
 *
 * A chat log that opens scrolled to the oldest of thirty messages is unreadable,
 * and the panel primitive owns its own scroll container — so rather than reaching
 * for it, an anchor at the end of the list is scrolled into view. `block:
 * "nearest"` is load-bearing: it moves the smallest scrollable ancestor that
 * needs moving, which is the panel body, and cannot pan a page that has no
 * overflow. Never `behavior: "smooth"` — an animated scroll is chrome motion far
 * past §7.1's 200ms ceiling.
 */
function useNewestMessageAnchor(count: number): (node: HTMLElement | null) => void {
  const node = useRef<HTMLElement | null>(null);
  const setNode = useCallback((element: HTMLElement | null) => {
    node.current = element;
  }, []);

  useEffect(() => {
    if (count === 0) return;
    node.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [count]);

  return setNode;
}

function ChatMessageRow({
  arrival,
  blocked,
  message,
  onReact,
}: {
  readonly arrival: boolean;
  readonly blocked: boolean;
  readonly message: ChatMessageView;
  readonly onReact: ChatPanelProps["onReact"];
}) {
  /*
   * §12.6: a panel gaining a row uses `gameplay-reveal`, one-shot. Opacity plus a
   * 4px transform — a transform cannot reflow the list, so a line arriving never
   * nudges the line a player is mid-read of. No spring, no stagger: this is
   * conversation, and staggering would delay it to decorate it.
   */
  const arrivalProps = arrival
    ? {
        initial: { opacity: 0, y: -4 },
        animate: { opacity: 1, y: 0 },
        transition: {
          duration: GAMEPLAY_MOTION_MS.reveal / 1_000,
          ease: EASING_STANDARD_BEZIER,
        },
      }
    : {};

  return (
    <m.li
      className={cn("panel-chat-message", panelSeatClass(message.seat))}
      data-panel-kind={message.kind}
      data-panel-origin={message.origin}
      data-slot="panel-chat-message"
      {...arrivalProps}
    >
      <span className="panel-chat-byline">
        <span className="panel-chat-author">
          {message.origin === "local" ? "You" : message.authorName}
        </span>
        {/*
          The tonal step and the seat rule carry mine-vs-theirs visually (§12.1);
          nothing in them reaches a screen reader, and "You" alone is ambiguous
          when the byline is read out of context. Stated in text on the viewer's
          own rows only, exactly as the activity log does it.
        */}
        {message.origin === "local" ? <span className="sr-only">Your message.</span> : null}
        <time className="panel-chat-time" dateTime={message.sentAt}>
          {panelClock(message.sentAt)}
        </time>
      </span>
      <p className="panel-chat-body">{message.body}</p>
      <ChatReactionTallies blocked={blocked} message={message} onReact={onReact} />
    </m.li>
  );
}

/**
 * The emotes already on a message.
 *
 * Rendered as buttons rather than static counts, because joining a reaction
 * somebody else started is one tap and is the commonest thing a player wants to
 * do with a line. Absent entirely when a message has none, so an untouched log
 * carries no extra chrome — a row growing inside the rail's own scroll container
 * cannot move the board either way.
 */
function ChatReactionTallies({
  blocked,
  message,
  onReact,
}: {
  readonly blocked: boolean;
  readonly message: ChatMessageView;
  readonly onReact: ChatPanelProps["onReact"];
}) {
  const reactions = message.reactions ?? [];
  if (reactions.length === 0) return null;

  return (
    <ul
      aria-label="Reactions"
      className="panel-chat-quick panel-chat-tallies"
      data-slot="panel-chat-tallies"
    >
      {reactions.map((reaction) => (
        <li key={reaction.id}>
          <button
            aria-pressed={reaction.mine}
            className="panel-btn panel-chat-tally"
            data-emote-id={reaction.id}
            data-mine={reaction.mine ? "true" : "false"}
            data-slot="panel-chat-tally"
            disabled={blocked || onReact === undefined}
            onClick={
              onReact === undefined
                ? undefined
                : () => onReact(message.id, reaction.id, reaction.mine)
            }
            type="button"
          >
            {/*
              `aria-pressed` alone is invisible and a fill alone would be colour
              (§8), so the viewer's own reaction also carries the 6px active LED —
              a shape that is present or absent, not a hue.
            */}
            {reaction.mine ? (
              <span aria-hidden="true" className="panel-led" data-tone="active" />
            ) : null}
            <EmoteGlyph emoteId={reaction.id} />
            <span className="panel-fact">{formatPanelNumber(reaction.count)}</span>
            <span className="sr-only">
              {reaction.label}
              {reaction.mine ? ". Your reaction. Activate to clear it." : ". Activate to add yours."}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function EmoteGlyph({ emoteId }: { readonly emoteId: string }) {
  const Glyph = EMOTE_GLYPHS[emoteId];
  if (Glyph === undefined) {
    // An emote a newer build introduced: print the id's own tail rather than
    // nothing, so an unknown reaction is still countable and clickable.
    return <span className="panel-fact">{emoteId.replace(/^emote\./, "")}</span>;
  }

  return <Glyph size={EMOTE_GLYPH_SIZE} />;
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

/**
 * The emote set, offered once against the newest message.
 *
 * §8.2 puts emotes on messages, so the palette needs a target. It sits in the
 * footer against the newest line rather than being repeated per row for a reason
 * worth stating: eight 28px controls on each of thirty rows is 240 buttons in a
 * 320px column, and a per-row palette that only appears on hover would break §8
 * outright. Older messages stay reactable through their existing tallies, and the
 * button group names its target so "react" is never ambiguous.
 *
 * A fuller answer — a per-row palette behind a keyboard-reachable popover — needs
 * chrome this panel is not allowed to invent; it is reported as a follow-up rather
 * than half-built here.
 */
function EmotePalette({
  blocked,
  emotes,
  onReact,
  target,
}: {
  readonly blocked: boolean;
  readonly emotes: readonly ChatEmoteOption[];
  readonly onReact: ChatPanelProps["onReact"];
  readonly target: ChatMessageView | null | undefined;
}) {
  if (emotes.length === 0 || target === null || target === undefined) return null;

  const held = new Set((target.reactions ?? []).filter((tally) => tally.mine).map((tally) => tally.id));
  const author = target.origin === "local" ? "your own last message" : `${target.authorName}'s last message`;

  return (
    <ul
      aria-label={`React to ${author}`}
      className="panel-chat-quick panel-chat-emotes"
      data-slot="panel-chat-emotes"
    >
      {emotes.map((emote) => {
        const mine = held.has(emote.id);
        return (
          <li key={emote.id}>
            <button
              aria-pressed={mine}
              className="panel-btn panel-chat-emote"
              data-emote-id={emote.id}
              data-slot="panel-chat-emote"
              disabled={blocked || onReact === undefined}
              onClick={
                onReact === undefined ? undefined : () => onReact(target.id, emote.id, mine)
              }
              type="button"
            >
              {mine ? (
                <span aria-hidden="true" className="panel-led" data-tone="active" />
              ) : null}
              <EmoteGlyph emoteId={emote.id} />
              <span className="sr-only">
                {emote.label}
                {mine ? ". Your reaction. Activate to clear it." : ""}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Wiring                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Who is at the table, as far as chat is concerned.
 *
 * Deliberately not `RoomMemberProjection`: a panel is handed exactly what a
 * viewer may see (see `panel-registry.ts`), and chat needs three facts — the id
 * a message is attributed to, the seat that identifies it visually, and the name
 * to print. Taking the whole member projection would let a future private field
 * leak into a chat byline by accident.
 *
 * `playerId` is the engine's `PlayerId`, which is what `room.members[].id`,
 * `publicProjection.players[].id`, `self.playerId` and a chat row's `authorId`
 * all already are — the server derives the last one with
 * `createStableId("PlayerId", …)` from the session, so the comparison that
 * decides "mine" is an id match, never a name match.
 */
export type ChatSeat = {
  readonly playerId: string;
  readonly seat: number;
  readonly name: string;
  readonly isBot?: boolean;
};

/**
 * Turns transport rows into panel rows.
 *
 * The only place own-versus-opponent is decided, and it is decided by id: the
 * viewer's `playerId` against the message's `authorId`. A name comparison would
 * make two players called "Alex" indistinguishable and is exactly the failure
 * §12.1 is about.
 *
 * Pure, so the mapping is unit-testable without a render or a socket.
 */
export function toChatMessageViews(
  messages: readonly ChatMessage[],
  options: {
    readonly selfPlayerId: string;
    readonly seats: readonly ChatSeat[];
  },
): readonly ChatMessageView[] {
  const bySeat = new Map(options.seats.map((seat) => [seat.playerId, seat]));

  return messages.map((message): ChatMessageView => {
    const seat = message.authorId === null ? undefined : bySeat.get(message.authorId);
    const origin =
      message.authorId === null
        ? "system"
        : message.authorId === options.selfPlayerId
          ? "local"
          : "remote";

    return {
      id: message.id,
      // The roster wins over the stored name: it is the same source the board,
      // the seat glyphs and the activity log read, and a chat log that disagreed
      // with them about who somebody is would be worse than one with no names.
      authorName: seat?.name ?? message.authorName ?? (origin === "system" ? "The office" : "Unseated"),
      seat: seat?.seat ?? null,
      origin,
      kind: message.kind,
      body: message.kind === "quick" ? quickPhraseLabel(message.body) : message.body,
      sentAt: message.createdAt,
      reactions: message.reactions.map((tally) => ({
        id: tally.emote,
        label: emoteLabel(tally.emote),
        count: tally.count,
        mine: tally.mine,
      })),
    };
  });
}

export type UseRoomChatOptions = {
  readonly roomId: string;
  /**
   * The realtime topic. Defaults to `roomId`, which is what it is — the server
   * publishes chat to `parseRoomTopic(room.id)` and the socket route takes the
   * same opaque id. Never the six-character join code, which is a credential.
   */
  readonly roomTopic?: string;
  /** The room's configured `ModeRules.social.chat`. */
  readonly chatMode: ChatMode;
  readonly selfPlayerId: string;
  readonly seats: readonly ChatSeat[];
  /** The room's `ModeRules.social.emoteReactions`. */
  readonly emoteReactionsEnabled?: boolean;
};

export type RoomChatState = {
  /** The configured mode, narrowed by anything the server has refused. */
  readonly mode: ChatMode;
  /** Why chat is off, when the client learned it from a refusal. */
  readonly offReason: string | null;
  readonly messages: readonly ChatMessageView[];
  readonly emotes: readonly ChatEmoteOption[];
  readonly phrases: readonly QuickPhrase[];
  readonly maxLength: number;
  readonly disabledReason: string | null;
  readonly notice: string | null;
  readonly pending: boolean;
  readonly hasOlder: boolean;
  readonly loadingOlder: boolean;
  readonly send: (body: string) => void;
  readonly quickSend: (phraseId: string) => void;
  readonly react: (messageId: string, emoteId: string, removed: boolean) => void;
  readonly loadOlder: () => void;
};

/**
 * Chat, wired: history over HTTP, new lines over the socket, sends and emotes
 * back over HTTP.
 *
 * Everything hard lives in `@/realtime/chat-channel` as pure functions — the
 * merge, the dedupe, the reaction ledger, the refusal vocabulary, the mode
 * narrowing — so this hook is wiring and nothing else. That split is why the
 * behaviour is testable at all in a `node` environment with no DOM.
 *
 * Three properties to keep if this is edited:
 *
 * - **A refusal is always rendered.** Every catch sets a code, and every code has
 *   a sentence. Chat that silently stops accepting messages is the failure this
 *   whole wave exists to fix.
 * - **The rate limit un-sticks itself.** The server's window is ten seconds; a
 *   composer disabled until the player reloads would be a worse outcome than the
 *   flood it prevents.
 * - **An emote is applied optimistically and the echo is free.** The socket
 *   broadcast reaches the sender too, and the ledger in `applyChatReaction` makes
 *   the second application of the same state a no-op rather than a double count.
 */
export function useRoomChat(options: UseRoomChatOptions): RoomChatState {
  const { chatMode, roomId, selfPlayerId } = options;
  const roomTopic = options.roomTopic ?? roomId;
  const emotesEnabled = options.emoteReactionsEnabled ?? true;

  const [feed, setFeed] = useState<ChatFeed>(EMPTY_CHAT_FEED);
  const [refusal, setRefusal] = useState<ChatRefusalCode | null>(null);
  /**
   * The refusal that told us what this room's mode really is.
   *
   * Kept apart from `refusal` and never cleared, because the two have different
   * lifetimes: a rate limit expires, whereas "this table has chat off" is a fact
   * about the ruleset. Folding them into one slot would let the next refusal —
   * or the rate-limit cooldown — quietly re-open a composer in a room that
   * refuses every message.
   */
  const [narrowing, setNarrowing] = useState<ChatRefusalCode | null>(null);
  const [pending, setPending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const mode = effectiveChatMode(chatMode, narrowing);

  const refuse = useCallback((code: ChatRefusalCode) => {
    setRefusal(code);
    setNarrowing((current) => narrowestModeRefusal(current, code));
  }, []);

  /* Bootstrap: the newest page of history. */
  useEffect(() => {
    if (chatMode === "off") return;

    const controller = new AbortController();
    let cancelled = false;
    setFeed(EMPTY_CHAT_FEED);

    void (async () => {
      try {
        const page = await fetchChatHistory(roomId, { signal: controller.signal });
        if (cancelled) return;
        setFeed((current) => receiveChatHistoryPage(current, page));
      } catch (error) {
        if (cancelled) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (error instanceof ChatTransportError) {
          refuse(error.code);
          return;
        }
        throw error;
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [chatMode, refuse, roomId]);

  /* New lines and emotes, pushed. */
  useEffect(() => {
    if (chatMode === "off") return;

    let cleanup: (() => Promise<void>) | null = null;
    try {
      cleanup = subscribeRoomChat(roomTopic, {
        onMessage: (frame) => setFeed((current) => receiveChatMessage(current, frame)),
        onReaction: (frame) =>
          setFeed((current) => receiveChatReaction(current, frame, selfPlayerId)),
      });
    } catch {
      // A topic this client cannot subscribe to is a wiring mistake, not a state
      // the player can act on. History still loads over HTTP, so chat degrades to
      // "correct on open" rather than to an error the player cannot clear.
      cleanup = null;
    }

    return () => {
      void cleanup?.();
    };
  }, [chatMode, roomTopic, selfPlayerId]);

  /* The rate-limit window, mirrored so the composer un-sticks itself. */
  useEffect(() => {
    if (refusal !== "RATE_LIMITED") return;
    const timer = window.setTimeout(() => setRefusal(null), RATE_LIMIT_COOLDOWN_MS);
    return () => window.clearTimeout(timer);
  }, [refusal]);

  const post = useCallback(
    async (kind: "text" | "quick", body: string): Promise<void> => {
      setPending(true);
      try {
        const message = await sendChatMessage(roomId, { kind, body });
        setFeed((current) => receiveChatMessages(current, [message]));
        setRefusal(null);
      } catch (error) {
        if (error instanceof ChatTransportError) {
          refuse(error.code);
          return;
        }
        throw error;
      } finally {
        // The single termination guarantee for the pending state: it clears on
        // success, on every refusal, and on a rethrown unexpected error.
        setPending(false);
      }
    },
    [refuse, roomId],
  );

  const send = useCallback(
    (body: string) => {
      void post("text", body);
    },
    [post],
  );

  const quickSend = useCallback(
    (phraseId: string) => {
      void post("quick", phraseId);
    },
    [post],
  );

  const react = useCallback(
    (messageId: string, emoteId: string, removed: boolean) => {
      if (!isEmote(emoteId)) return;

      const apply = (state: boolean) => {
        setFeed((current) =>
          applyChatReaction(current, {
            messageId,
            actorId: selfPlayerId,
            emote: emoteId,
            removed: state,
            selfPlayerId,
          }),
        );
      };

      apply(removed);
      void (async () => {
        try {
          await reactToChatMessage(roomId, { messageId, emote: emoteId, removed });
          setRefusal(null);
        } catch (error) {
          if (error instanceof ChatTransportError) {
            // The server did not record it, so neither do we. Applying the
            // inverse disagrees with the ledger and therefore lands.
            apply(!removed);
            refuse(error.code);
            return;
          }
          throw error;
        }
      })();
    },
    [refuse, roomId, selfPlayerId],
  );

  const olderCursor = feed.olderCursor;
  const loadOlder = useCallback(() => {
    if (olderCursor === null) return;

    setLoadingOlder(true);
    void (async () => {
      try {
        const page = await fetchChatHistory(roomId, { before: olderCursor });
        setFeed((current) => receiveChatHistoryPage(current, page));
      } catch (error) {
        if (error instanceof ChatTransportError) {
          refuse(error.code);
          return;
        }
        throw error;
      } finally {
        setLoadingOlder(false);
      }
    })();
  }, [olderCursor, refuse, roomId]);

  const messages = useMemo(
    () => toChatMessageViews(feed.messages, { selfPlayerId, seats: options.seats }),
    [feed.messages, options.seats, selfPlayerId],
  );

  const blocking = refusal !== null && chatRefusalBlocksComposer(refusal);
  const sentence = refusal === null ? null : chatRefusalMessage(refusal);

  return {
    mode,
    // Read off the narrowing rather than the live refusal, so the reason the
    // panel prints in `off` mode is the one that made it `off`.
    offReason: narrowing === "CHAT_DISABLED" ? chatRefusalMessage(narrowing) : null,
    messages,
    emotes: emotesEnabled ? DEFAULT_EMOTES : [],
    phrases: quickPhrasesFor(mode),
    maxLength: CHAT_TEXT_MAX_LENGTH,
    disabledReason: blocking ? sentence : null,
    notice: blocking ? null : sentence,
    pending,
    hasOlder: olderCursor !== null,
    loadingOlder,
    send,
    quickSend,
    react,
    loadOlder,
  };
}

export type RoomChatPanelProps = UseRoomChatOptions & {
  readonly scope?: string;
  /** Pass `"none"` when the host already draws panel chrome. */
  readonly chrome?: PanelChrome;
};

/**
 * The chat destination, wired end to end.
 *
 * This is what a host mounts. It owns no layout and no chrome: it renders
 * {@link ChatPanel}, which is the same presentational component the panel kit's
 * tests exercise, so the wiring cannot drift from the surface those tests pin.
 */
export function RoomChatPanel({ chrome, scope, ...options }: RoomChatPanelProps) {
  const chat = useRoomChat(options);

  return (
    <ChatPanel
      chrome={chrome}
      disabledReason={chat.disabledReason}
      emotes={chat.emotes}
      hasOlder={chat.hasOlder}
      loadingOlder={chat.loadingOlder}
      maxLength={chat.maxLength}
      messages={chat.messages}
      mode={chat.mode}
      notice={chat.notice}
      offReason={chat.offReason}
      onLoadOlder={chat.loadOlder}
      onQuickSend={chat.quickSend}
      onReact={chat.react}
      onSend={chat.send}
      pending={chat.pending}
      phrases={chat.phrases}
      scope={scope}
    />
  );
}
