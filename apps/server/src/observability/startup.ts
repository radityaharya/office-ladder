import { DEFAULT_LOG_LEVEL, type LogContext, type LogValue } from "./log";

/**
 * Environment variables this process cannot work without. `DATABASE_URL` is the
 * one that actually kills the boot (packages/db throws at module load), so its
 * absence is the single most valuable thing a startup line can name.
 */
const REQUIRED_ENV_VARS = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
] as const;

/**
 * Present-or-not is genuinely interesting; the values are noise or secrets.
 *
 * `TURN_TIMEOUT_SECONDS` earns a place because "missing" and "set" mean genuinely
 * different games: unset arms a 60s clock that commits turns for absent players,
 * and `0` switches that off entirely. When somebody reports that a turn was taken
 * from them — or that the timer they configured does nothing — this line is the
 * first thing worth reading. The value itself stays out, like every other one
 * here; the parser reports a rejected value separately as
 * `turn-timer.timeout-invalid`.
 */
const OPTIONAL_ENV_VARS = [
  "BETTER_AUTH_EXTRA_ORIGINS",
  "BOT_TURN_DELAY_MS",
  "TURN_TIMEOUT_SECONDS",
] as const;

export type ProcessEnvironment = Readonly<Record<string, string | undefined>>;

function presence(value: string | undefined): "set" | "missing" {
  return value !== undefined && value.trim().length > 0 ? "set" : "missing";
}

/**
 * The startup line's fields: the port, and **presence only** for every
 * configured secret.
 *
 * `DATABASE_URL` embeds a password and `BETTER_AUTH_SECRET` is a signing key, so
 * neither value may ever reach a log — hence "set"/"missing" rather than the
 * string itself, for every variable uniformly (a rule with no exceptions is the
 * only kind that survives someone adding the next variable). `missingRequired`
 * is the field to grep for when a deployment will not come up.
 *
 * Pure, and takes the environment as an argument, so this is provable in a test
 * even though nothing in this sandbox can boot the server.
 */
export function startupContext(env: ProcessEnvironment, port: number): LogContext {
  const context: Record<string, LogValue> = {
    port,
    nodeEnv: env.NODE_ENV ?? null,
    logLevel: env.LOG_LEVEL?.trim().toLowerCase() ?? DEFAULT_LOG_LEVEL,
  };

  for (const name of [...REQUIRED_ENV_VARS, ...OPTIONAL_ENV_VARS]) {
    context[name] = presence(env[name]);
  }

  const missing = REQUIRED_ENV_VARS.filter((name) => presence(env[name]) === "missing");
  context.missingRequired = missing.length === 0 ? null : missing.join(",");
  return context;
}
