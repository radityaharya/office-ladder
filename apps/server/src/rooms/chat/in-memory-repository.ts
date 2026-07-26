/**
 * Test/dev chat storage.
 *
 * Mirrors {@link PostgresChatRepository} in every way that can change an
 * outcome: the same keyset ordering (`createdAt` then `id`, both descending),
 * the same "one emote per player per message" cap, and the same three-valued
 * insert result. What it deliberately does *not* mirror is the foreign keys —
 * which is exactly why nothing that depends on write ordering may be verified
 * only against this class. See the note at the top of the Postgres one.
 */
import type { Emote } from "@office-ladder/contracts";
import type { PlayerId } from "@office-ladder/engine";
import type {
  ChatMessageRecord,
  ChatReactionRecord,
  ChatRepository,
  InsertReactionResult,
} from "./types";

export class InMemoryChatRepository implements ChatRepository {
  readonly #messages = new Map<string, ChatMessageRecord>();
  readonly #reactions: ChatReactionRecord[] = [];

  async insertMessage(message: ChatMessageRecord): Promise<void> {
    this.#messages.set(message.id, { ...message });
  }

  async getMessage(messageId: string): Promise<ChatMessageRecord | null> {
    const held = this.#messages.get(messageId);
    return held === undefined ? null : { ...held };
  }

  async listMessages(input: {
    readonly roomId: string;
    readonly before: ChatMessageRecord | null;
    readonly limit: number;
  }): Promise<readonly ChatMessageRecord[]> {
    const cursor = input.before;
    return [...this.#messages.values()]
      .filter((message) => message.roomId === input.roomId)
      .filter((message) => cursor === null || isOlderThan(message, cursor))
      .sort(newestFirst)
      .slice(0, input.limit)
      .map((message) => ({ ...message }));
  }

  async listReactions(
    messageIds: readonly string[],
  ): Promise<readonly ChatReactionRecord[]> {
    const wanted = new Set(messageIds);
    return this.#reactions
      .filter((reaction) => wanted.has(reaction.messageId))
      .map((reaction) => ({ ...reaction }));
  }

  async insertReaction(
    reaction: ChatReactionRecord,
    maxPerPlayerPerMessage: number,
  ): Promise<InsertReactionResult> {
    const held = this.#reactions.filter(
      (existing) =>
        existing.messageId === reaction.messageId &&
        existing.playerId === reaction.playerId,
    );
    if (held.some((existing) => existing.emote === reaction.emote)) return "duplicate";
    if (held.length >= maxPerPlayerPerMessage) return "limit-reached";

    this.#reactions.push({ ...reaction });
    return "inserted";
  }

  async deleteReaction(input: {
    readonly messageId: string;
    readonly playerId: PlayerId;
    readonly emote: Emote;
  }): Promise<boolean> {
    const index = this.#reactions.findIndex(
      (reaction) =>
        reaction.messageId === input.messageId &&
        reaction.playerId === input.playerId &&
        reaction.emote === input.emote,
    );
    if (index === -1) return false;

    this.#reactions.splice(index, 1);
    return true;
  }
}

/**
 * ISO-8601 UTC instants of identical width sort lexicographically in
 * chronological order, which is what makes a string comparison here equivalent
 * to Postgres comparing two `timestamp` values. `now()` produces exactly that
 * shape everywhere in this server (`new Date().toISOString()`).
 */
function isOlderThan(message: ChatMessageRecord, cursor: ChatMessageRecord): boolean {
  if (message.createdAt !== cursor.createdAt) return message.createdAt < cursor.createdAt;
  return message.id < cursor.id;
}

function newestFirst(left: ChatMessageRecord, right: ChatMessageRecord): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt < right.createdAt ? 1 : -1;
  }
  return left.id < right.id ? 1 : -1;
}
