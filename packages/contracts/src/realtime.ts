import {
  parseChatMessagePosted,
  parseEmoteReactionPosted,
  type ChatMessagePosted,
  type EmoteReactionPosted,
} from "./chat";
import { ContractValidationError, parseOpaqueId } from "./rooms";
import { requireObject as requireObjectAtPath } from "./validate";

/**
 * The areas of the *canonical projection* an update can invalidate.
 *
 * Note what is not here and never will be: chat and emote reactions. They are not
 * game state (spec §8.1), they are not derived from `GameState`, and re-fetching
 * the bootstrap would not produce them — so they travel as their own realtime
 * message kinds carrying their own content, not as an invalidation of this list.
 */
export const PROJECTION_CHANGE_AREAS = [
  "room",
  "game",
  "players",
  "prompts",
  "reactions",
  "legal-actions",
  "history",
  /**
   * The v2 shared state: ownership, placements, projects, agreements, objectives,
   * ballots, quarters and the per-player economy. One area rather than nine
   * because this is an invalidation hint, not a diff — the client re-fetches its
   * (per-socket, redacted) projection either way.
   */
  "gameplay",
] as const;

export type ProjectionChangeArea = (typeof PROJECTION_CHANGE_AREAS)[number];

export type ProjectionUpdated = {
  readonly kind: "projection-updated";
  readonly messageId: string;
  readonly aggregateVersion: number;
  readonly projectionRevision: number;
  readonly changed: readonly ProjectionChangeArea[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ContractValidationError("projectionUpdated", "must be an object");
  }

  return value;
}

function requireExactKeys(value: Record<string, unknown>): void {
  const expectedKeys = new Set([
    "kind",
    "messageId",
    "aggregateVersion",
    "projectionRevision",
    "changed",
  ]);
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== expectedKeys.size ||
    actualKeys.some((key) => !expectedKeys.has(key))
  ) {
    throw new ContractValidationError(
      "projectionUpdated",
      "contains unknown or missing fields",
    );
  }
}

function requireRevision(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ContractValidationError(path, "must be a non-negative safe integer");
  }

  return value;
}

function isProjectionChangeArea(value: unknown): value is ProjectionChangeArea {
  return (
    typeof value === "string" &&
    (PROJECTION_CHANGE_AREAS as readonly string[]).includes(value)
  );
}

function parseChanged(value: unknown): readonly ProjectionChangeArea[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ContractValidationError("changed", "must be a non-empty array");
  }

  const changed: ProjectionChangeArea[] = [];
  const seen = new Set<ProjectionChangeArea>();
  for (const area of value) {
    // Membership in the exported vocabulary rather than a hand-written chain of
    // comparisons: the chain this replaced had to be edited in lockstep with the
    // list, and an area added to one and not the other fails at runtime only.
    if (!isProjectionChangeArea(area)) {
      throw new ContractValidationError("changed", "contains an unsupported area");
    }
    if (seen.has(area)) {
      throw new ContractValidationError("changed", "must not contain duplicates");
    }

    seen.add(area);
    changed.push(area);
  }

  return changed;
}

/**
 * Everything that can arrive on a room socket.
 *
 * A discriminated union on `kind` rather than one message type with optional
 * fields, because the three are unrelated: a projection update is an
 * invalidation of canonical state, and the two chat kinds carry content that has
 * no canonical state to invalidate.
 */
export type RealtimeMessage = ProjectionUpdated | ChatMessagePosted | EmoteReactionPosted;

export const REALTIME_MESSAGE_KINDS = [
  "projection-updated",
  "chat-message-posted",
  "emote-reaction-posted",
] as const;

export type RealtimeMessageKind = (typeof REALTIME_MESSAGE_KINDS)[number];

/**
 * Parses any room socket message, dispatching on `kind`.
 *
 * Each branch delegates to the parser that owns that shape, so a client can add
 * chat handling without loosening the projection-update validation it already
 * relies on.
 */
export function parseRealtimeMessage(value: unknown): RealtimeMessage {
  const input = requireObjectAtPath(value, "realtimeMessage");
  const kind = input["kind"];
  if (kind === "chat-message-posted") return parseChatMessagePosted(input);
  if (kind === "emote-reaction-posted") return parseEmoteReactionPosted(input);
  if (kind === "projection-updated") return parseProjectionUpdated(input);

  throw new ContractValidationError("kind", "must be a supported realtime message");
}

export function parseProjectionUpdated(value: unknown): ProjectionUpdated {
  const input = requireObject(value);
  requireExactKeys(input);
  if (input["kind"] !== "projection-updated") {
    throw new ContractValidationError(
      "kind",
      "must be projection-updated",
    );
  }

  return {
    kind: "projection-updated",
    messageId: parseOpaqueId(input["messageId"], "messageId"),
    aggregateVersion: requireRevision(input["aggregateVersion"], "aggregateVersion"),
    projectionRevision: requireRevision(
      input["projectionRevision"],
      "projectionRevision",
    ),
    changed: parseChanged(input["changed"]),
  };
}
