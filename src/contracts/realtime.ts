import { ContractValidationError, parseOpaqueId } from "./rooms";

export const PROJECTION_CHANGE_AREAS = [
  "room",
  "game",
  "players",
  "prompts",
  "reactions",
  "legal-actions",
  "history",
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

function parseChanged(value: unknown): readonly ProjectionChangeArea[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ContractValidationError("changed", "must be a non-empty array");
  }

  const changed: ProjectionChangeArea[] = [];
  const seen = new Set<ProjectionChangeArea>();
  for (const area of value) {
    if (
      area !== "room" &&
      area !== "game" &&
      area !== "players" &&
      area !== "prompts" &&
      area !== "reactions" &&
      area !== "legal-actions" &&
      area !== "history"
    ) {
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
