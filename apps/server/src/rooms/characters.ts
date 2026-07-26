import { deadlineDashCharacters } from "@office-ladder/content";
import type { CharacterOptionProjection } from "@office-ladder/contracts";
import type { PlayerId } from "@office-ladder/engine";

/**
 * Everything about turning a lobby's character *preferences* into the distinct
 * per-seat assignment the engine's setup validator demands.
 *
 * The engine refuses a setup with a duplicate `characterId`
 * (`DUPLICATE_CHARACTER_ID`), so "two players picked the same character" has to
 * be resolved before `createDeadlineDashGame` ever sees it. Resolving it in one
 * pure function — rather than at each of the three places that care (setup, the
 * lobby projection, the claim endpoint) — is what keeps the lobby's answer and
 * the match's answer the same answer.
 */

/** Content order, which is also the order the lobby picker offers them in. */
export const CHARACTER_IDS: readonly string[] = Object.values(deadlineDashCharacters).map(
  (character) => character.id,
);

export function isKnownCharacterId(value: string): boolean {
  return CHARACTER_IDS.includes(value);
}

/**
 * Display text derived from the id (`character.social-butterfly` → "Social
 * Butterfly").
 *
 * The content pack only carries `displayNameKey`, an i18n key, and there is no
 * message catalogue in this repo yet — so a server-side label is the only way to
 * give the lobby something a human can read. The key travels alongside it in
 * {@link characterOptions} so the client can switch to real translations without
 * a server change, at which point this becomes a fallback.
 */
export function characterLabel(characterId: string): string {
  const prefix = "character.";
  const name = characterId.startsWith(prefix) ? characterId.slice(prefix.length) : characterId;
  return name
    .split("-")
    .filter((word) => word.length > 0)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function characterNameKey(characterId: string): string {
  const character = Object.values(deadlineDashCharacters).find(
    (candidate) => candidate.id === characterId,
  );
  return character?.displayNameKey ?? characterId;
}

/**
 * Resolves every member's character: their own claim when they have one,
 * otherwise the first character nobody claimed, in seat order.
 *
 * Two invariants, both load-bearing:
 *
 * - **Distinct.** A claim is honoured only if no *earlier* seat holds it, so a
 *   duplicate that somehow reached storage (a legacy snapshot, a write race) is
 *   resolved in favour of the earlier seat rather than failing the whole match.
 * - **Total, or explicitly not.** A member with no claim and nothing left
 *   unclaimed gets `null`, and the caller decides what that means. It cannot
 *   happen with the current content pack (six characters, capacity at most six),
 *   which is exactly why it must not be silently papered over: reaching it would
 *   mean the seat/character invariant had broken somewhere upstream.
 */
export function resolveCharacterAssignments(
  memberIds: readonly PlayerId[],
  claims: Readonly<Partial<Record<PlayerId, string>>>,
): ReadonlyMap<PlayerId, string | null> {
  const assigned = new Map<PlayerId, string | null>();
  const taken = new Set<string>();

  for (const memberId of memberIds) {
    const claimed = claims[memberId];
    if (claimed !== undefined && isKnownCharacterId(claimed) && !taken.has(claimed)) {
      taken.add(claimed);
      assigned.set(memberId, claimed);
    }
  }

  for (const memberId of memberIds) {
    if (assigned.has(memberId)) continue;
    const fallback = CHARACTER_IDS.find((candidate) => !taken.has(candidate)) ?? null;
    if (fallback !== null) taken.add(fallback);
    assigned.set(memberId, fallback);
  }

  return assigned;
}

/**
 * The claims as the lobby should show them: only what members actually picked,
 * never the fallback. A picker pre-filled with an assignment nobody chose is how
 * "your choice was ignored" looks from the inside.
 */
export function claimedCharacters(
  memberIds: readonly PlayerId[],
  claims: Readonly<Partial<Record<PlayerId, string>>>,
): ReadonlyMap<PlayerId, string> {
  const claimed = new Map<PlayerId, string>();
  const taken = new Set<string>();
  for (const memberId of memberIds) {
    const candidate = claims[memberId];
    if (candidate === undefined || !isKnownCharacterId(candidate)) continue;
    if (taken.has(candidate)) continue;
    taken.add(candidate);
    claimed.set(memberId, candidate);
  }
  return claimed;
}

export function characterOptions(
  memberIds: readonly PlayerId[],
  claims: Readonly<Partial<Record<PlayerId, string>>>,
): readonly CharacterOptionProjection[] {
  const claimed = claimedCharacters(memberIds, claims);
  const holders = new Map<string, PlayerId>();
  for (const [memberId, characterId] of claimed) holders.set(characterId, memberId);

  return CHARACTER_IDS.map((characterId) => ({
    id: characterId,
    label: characterLabel(characterId),
    nameKey: characterNameKey(characterId),
    takenByMemberId: holders.get(characterId) ?? null,
  }));
}
