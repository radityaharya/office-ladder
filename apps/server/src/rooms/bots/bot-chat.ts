import {
  QUICK_CHAT_PHRASES,
  type ChatMode,
  type QuickChatPhraseId,
} from "@office-ladder/contracts";
import type { BotActionSlug } from "./bot-policy";

/**
 * What a bot says, and when it says nothing.
 *
 * Three rules, and the third is the one that matters:
 *
 * 1. **`off` — silence.** The room has chat switched off; a bot is not an
 *    exception to that.
 * 2. **`quick` — the fixed phrase set, and only that.** `QUICK_CHAT_PHRASES` is
 *    a closed list of ids whose wording the client owns, so a bot "speaks"
 *    without generating a single character of text. §8.1 calls this "the only
 *    mode bots can meaningfully use", and this is why.
 * 3. **`full` — still silence.** This is deliberate and worth stating plainly: a
 *    room with free-typed chat is a room where anything a bot writes is
 *    indistinguishable from a person writing it. Generating text on a player's
 *    behalf in a channel humans are talking in is a different product decision
 *    from filling an empty seat, and it is not one this package gets to make. A
 *    bot in `full` mode plays and stays quiet.
 *
 * The phrase is chosen from the decision the bot is *about* to commit, so the
 * line is a real signal rather than chatter: a watching player sees "thinking",
 * then the command lands, and the two agree.
 */

/** The beat that turns a silent pause into a visible one. */
export const BOT_THINKING_PHRASE: QuickChatPhraseId = "chat.phrase.thinking";

/**
 * One phrase per decision slug, or `null` for the decisions a bot should not
 * announce.
 *
 * Most rungs are deliberately silent. A bot that commented on every roll would
 * be six lines of noise per round, which is the same unreadable feed the pacing
 * work exists to fix — so only the moves a human would actually remark on get a
 * line: a promotion, an attack, a trade, a costly fine.
 */
const PHRASE_BY_SLUG: Readonly<Partial<Record<BotActionSlug, QuickChatPhraseId>>> = {
  promote: "chat.phrase.well-played",
  attack: "chat.phrase.sorry",
  sabotage: "chat.phrase.sorry",
  trade: "chat.phrase.deal",
  fine: "chat.phrase.ouch",
  block: "chat.phrase.no-deal",
};

export type BotChatLine = {
  readonly phraseId: QuickChatPhraseId;
  /** Always `"quick"`: a bot has no other legal kind. See rule 3 above. */
  readonly messageKind: "quick";
};

function line(phraseId: QuickChatPhraseId): BotChatLine {
  return { phraseId, messageKind: "quick" };
}

/** Guards against a phrase id drifting out of the contract's closed list. */
function isKnownPhrase(value: string): value is QuickChatPhraseId {
  return (QUICK_CHAT_PHRASES as readonly string[]).includes(value);
}

/**
 * The "I am deciding" beat, shown *before* the pause rather than after it.
 *
 * Before, because the whole point is that the wait has an explanation while it
 * is happening. A beat that arrived with the command would be decoration on an
 * event the player can already see.
 */
export function botThinkingLine(chatMode: ChatMode): BotChatLine | null {
  if (chatMode !== "quick") return null;
  return line(BOT_THINKING_PHRASE);
}

/** The optional remark after a decision lands, or `null` for a quiet one. */
export function botDecisionLine(
  chatMode: ChatMode,
  slug: BotActionSlug,
): BotChatLine | null {
  if (chatMode !== "quick") return null;
  const phraseId = PHRASE_BY_SLUG[slug];
  if (phraseId === undefined || !isKnownPhrase(phraseId)) return null;

  return line(phraseId);
}
