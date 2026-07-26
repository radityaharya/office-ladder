import { log } from "@/observability/log";

/**
 * Startup validation for the environment variables this server cannot silently
 * do without.
 *
 * The failure that motivated this is genuinely invisible: with `BETTER_AUTH_URL`
 * unset, `http/trusted-origins.ts` falls back to `http://localhost:3072`, so in
 * any real deployment *every* mutating request — create, join, start, roll,
 * respond, bot seats — is rejected 403 FORBIDDEN by the same-origin check while
 * reads keep working. Nothing logs why. It looks exactly like a client bug, and
 * you can stare at the network tab for a long time before suspecting a missing
 * variable. Better Auth itself only warns ("Base URL is not set") on a line that
 * scrolls past during boot.
 *
 * Fatal in production, a warning in development, because in development the
 * fallback origin is genuinely correct — `bun run dev` really is served from
 * localhost:3072 — and refusing to start would break the documented local flow
 * for anyone who has not copied `.env.example` yet. A *malformed* value is fatal
 * everywhere: it cannot be right anywhere, and it otherwise dies deep inside
 * `new URL()` with no mention of which variable was at fault.
 *
 * Pure check + thin assert, and the environment is an argument, so the rules are
 * provable in a test even though nothing in this sandbox can boot the server.
 * `observability/startup.ts` reports the same variables' *presence* on the
 * startup line; that is the diagnostic, this is the enforcement.
 */
export type ProcessEnvironment = Readonly<Record<string, string | undefined>>;

export type EnvironmentProblemSeverity = "fatal" | "warning";

export type EnvironmentProblem = {
  readonly variable: string;
  readonly severity: EnvironmentProblemSeverity;
  /** Actionable: what breaks, and what to set. Never contains a value. */
  readonly detail: string;
};

export function checkServerEnvironment(
  env: ProcessEnvironment,
): readonly EnvironmentProblem[] {
  const production = env.NODE_ENV === "production";
  const problems: EnvironmentProblem[] = [];

  if (!isSet(env.DATABASE_URL)) {
    problems.push({
      variable: "DATABASE_URL",
      severity: "fatal",
      detail:
        "not set — every room read and write, and Better Auth's own session lookup, " +
        "go through it, so the first query would throw. Set the Postgres connection " +
        "string (see .env.example).",
    });
  }

  if (!isSet(env.BETTER_AUTH_SECRET)) {
    problems.push({
      variable: "BETTER_AUTH_SECRET",
      severity: production ? "fatal" : "warning",
      detail:
        "not set — sessions would be signed with a development fallback key, so " +
        "they cannot be trusted and do not survive a restart or a second instance. " +
        "Generate one with `openssl rand -base64 32`.",
    });
  }

  problems.push(...betterAuthUrlProblems(env, production));
  problems.push(...extraOriginsProblems(env));
  problems.push(...portProblems(env));

  return problems;
}

/**
 * Throws on any fatal problem, listing every one of them, and logs the rest.
 *
 * Reporting all of them at once matters: the variables are usually all missing
 * together (a fresh deployment with no env file), and fixing them one
 * failed-boot at a time is how a five-minute misconfiguration becomes an hour.
 */
export function assertServerEnvironment(env: ProcessEnvironment = process.env): void {
  const problems = checkServerEnvironment(env);

  for (const problem of problems) {
    if (problem.severity === "warning") {
      log("warn", "startup.environment-degraded", {
        variable: problem.variable,
        detail: problem.detail,
      });
    }
  }

  const fatal = problems.filter((problem) => problem.severity === "fatal");
  if (fatal.length === 0) return;

  const lines = fatal.map((problem) => `  - ${problem.variable}: ${problem.detail}`);
  throw new Error(
    `Refusing to start: ${fatal.length} environment variable${fatal.length === 1 ? " is" : "s are"} ` +
      `missing or invalid.\n${lines.join("\n")}\nSee .env.example for the full list.`,
  );
}

/** A type guard, so a "present" variable narrows to a string for its callers. */
function isSet(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function isAbsoluteUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function betterAuthUrlProblems(
  env: ProcessEnvironment,
  production: boolean,
): readonly EnvironmentProblem[] {
  const configured = env.BETTER_AUTH_URL;
  if (!isSet(configured)) {
    return [
      {
        variable: "BETTER_AUTH_URL",
        severity: production ? "fatal" : "warning",
        detail:
          "not set — the same-origin check would trust only http://localhost:3072, " +
          "so every mutating request from the real site is rejected 403 FORBIDDEN " +
          "while reads keep working. Set it to this deployment's public origin, " +
          "e.g. https://app.example.com.",
      },
    ];
  }

  if (!isAbsoluteUrl(configured)) {
    return [
      {
        variable: "BETTER_AUTH_URL",
        severity: "fatal",
        detail:
          "not an absolute http(s) URL — building the trusted-origin set throws " +
          "while the server boots. Use a full origin, e.g. https://app.example.com.",
      },
    ];
  }

  return [];
}

function extraOriginsProblems(env: ProcessEnvironment): readonly EnvironmentProblem[] {
  const configured = env.BETTER_AUTH_EXTRA_ORIGINS;
  if (!isSet(configured)) return [];

  const invalid = configured
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
    .some((origin) => !isAbsoluteUrl(origin));
  if (!invalid) return [];

  return [
    {
      variable: "BETTER_AUTH_EXTRA_ORIGINS",
      severity: "fatal",
      detail:
        "contains an entry that is not an absolute http(s) URL — building the " +
        "trusted-origin set throws while the server boots. Use a comma-separated " +
        "list of full origins, e.g. https://tunnel.example.com.",
    },
  ];
}

function portProblems(env: ProcessEnvironment): readonly EnvironmentProblem[] {
  const configured = env.PORT;
  if (!isSet(configured)) return [];

  const parsed = Number(configured.trim());
  if (Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 65535) return [];

  return [
    {
      variable: "PORT",
      severity: "fatal",
      detail:
        "not a port number between 1 and 65535 — the process would try to bind " +
        "NaN and fail with no mention of this variable.",
    },
  ];
}
