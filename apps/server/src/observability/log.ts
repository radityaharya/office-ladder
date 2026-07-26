/**
 * The entire logging surface of this server, deliberately kept to one small
 * dependency-free module.
 *
 * Shape: one line per event, `[level] event.name key=value key=value`, with a
 * dotted event name from a shared vocabulary and a flat bag of scalar fields.
 * That is enough to answer "which room, which player, what happened" with
 * `grep` and nothing else. `console.error` was already the established "this
 * was logged" precedent (realtime/publish-projection-update.ts); this only
 * makes the shape consistent and adds a level, so the useful-but-chatty lines
 * can be switched on with `LOG_LEVEL=debug` instead of a code edit.
 *
 * Three rules matter more than the format:
 * - **Never log a secret value.** Log presence instead — see
 *   observability/startup.ts. Room *codes* count as secrets too: they are join
 *   credentials.
 * - **Log state changes and failures, never steady state.** The GET bootstrap
 *   path is polled every ~5s per client; anything on that path must be `debug`.
 * - **A log call must never be able to break the thing it is describing.** No
 *   throwing formatters, no awaits, no I/O beyond `console`.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Scalars only. Nested objects are what make structured logs unreadable, and an
 * `undefined` field is omitted entirely rather than printed as the string
 * "undefined" — "not applicable here" and "we do not know" both mean "leave it
 * out".
 */
export type LogValue = string | number | boolean | null | undefined;

export type LogContext = Readonly<Record<string, LogValue>>;

const LEVEL_WEIGHT = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
} as const satisfies Record<LogLevel, number>;

export const DEFAULT_LOG_LEVEL: LogLevel = "info";

/**
 * Values printable bare. Everything else is JSON-quoted, which also escapes
 * newlines — log lines carry raw request input (an `Origin` header, a path
 * parameter), so a value must never be able to forge a second log line.
 */
const BARE_VALUE_PATTERN = /^[A-Za-z0-9._:@/+-]+$/;

function isLogLevel(value: string): value is LogLevel {
  switch (value) {
    case "debug":
    case "info":
    case "warn":
    case "error":
      return true;
    default:
      return false;
  }
}

/**
 * Read on every call rather than memoized at import: nothing here is hot, and a
 * per-call read means a test (or a `bun --watch` restart) can change the level
 * without module-cache surprises. An unrecognized value falls back to the
 * default silently — reporting it would need the very thing being configured.
 */
export function configuredLogLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (configured === undefined || configured.length === 0) return DEFAULT_LOG_LEVEL;
  return isLogLevel(configured) ? configured : DEFAULT_LOG_LEVEL;
}

export function isLevelEnabled(level: LogLevel): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[configuredLogLevel()];
}

function formatValue(value: Exclude<LogValue, undefined>): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : JSON.stringify(String(value));
  }
  return value.length > 0 && BARE_VALUE_PATTERN.test(value) ? value : JSON.stringify(value);
}

/**
 * Pure, so the exact line a seam produces can be asserted without a console
 * spy. The timestamp is added by log() rather than here, precisely so this stays
 * pure.
 */
export function formatLogLine(
  level: LogLevel,
  event: string,
  context?: LogContext,
): string {
  const fields: string[] = [];
  for (const [key, value] of Object.entries(context ?? {})) {
    if (value === undefined) continue;
    fields.push(`${key}=${formatValue(value)}`);
  }

  const prefix = `[${level}] ${event}`;
  return fields.length === 0 ? prefix : `${prefix} ${fields.join(" ")}`;
}

function write(level: LogLevel, line: string): void {
  const stamped = `${new Date().toISOString()} ${line}`;
  if (level === "error" || level === "warn") {
    console.error(stamped);
    return;
  }
  console.log(stamped);
}

export function log(level: LogLevel, event: string, context?: LogContext): void {
  if (!isLevelEnabled(level)) return;
  write(level, formatLogLine(level, event, context));
}

/**
 * A one-line, never-throwing description of an unknown throwable. Deliberately
 * total: `String(value)` can itself throw (a hostile `Symbol.toPrimitive`), and
 * a logger that throws while reporting a failure loses both the failure and the
 * report.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.length === 0 ? error.name : `${error.name}: ${error.message}`;
  }
  if (typeof error === "string") return error;
  if (
    typeof error === "number" ||
    typeof error === "boolean" ||
    error === null ||
    error === undefined
  ) {
    return String(error);
  }
  return `<non-error ${typeof error}>`;
}

/**
 * Logs the event line, then the stack on its own following line. A stack inside
 * a logfmt value is unreadable, and everything needed to *find* the failure is
 * already on the event line — the stack is only there to shorten the fix.
 */
export function logException(
  level: LogLevel,
  event: string,
  error: unknown,
  context?: LogContext,
): void {
  if (!isLevelEnabled(level)) return;
  write(level, formatLogLine(level, event, { ...context, error: describeError(error) }));
  const stack = error instanceof Error ? error.stack : undefined;
  if (stack !== undefined) console.error(stack);
}
