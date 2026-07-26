const LOCAL_ORIGIN = "http://localhost:3072";

/**
 * BETTER_AUTH_URL covers the canonical deployment origin. BETTER_AUTH_EXTRA_ORIGINS
 * (comma-separated) covers additional origins the app is legitimately served from —
 * e.g. a local tunnel host used for testing on another device — without weakening
 * the same-origin check to accept arbitrary hosts.
 *
 * A misconfigured value here silently disables every mutation (the same-origin
 * check rejects the real origin) so it is validated at startup as well — see
 * apps/server/src/env.ts.
 */
export function trustedOrigins(): ReadonlySet<string> {
  const configuredOrigin = originOf(
    process.env.BETTER_AUTH_URL ?? LOCAL_ORIGIN,
    "BETTER_AUTH_URL",
  );
  const extraOrigins = (process.env.BETTER_AUTH_EXTRA_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
    .map((origin) => originOf(origin, "BETTER_AUTH_EXTRA_ORIGINS"));

  // The dev origins are trusted only outside production. They have to be trusted
  // in development (that is where `bun run dev` serves the app from, and where
  // BETTER_AUTH_URL is legitimately unset), but a deployed site has no reason to
  // accept requests initiated by a page on the visitor's own localhost — and
  // BETTER_AUTH_URL is mandatory in production anyway (config/environment.ts), so
  // dropping it there cannot leave the allow-list empty.
  //
  // Both dev ports are listed, because in development the app is genuinely
  // reachable on two of them: Vite on 3072 (the intended one, which proxies
  // /api to the server) and the server's own port, because serve.ts mounts the
  // static client unconditionally. Trusting only 3072 meant a request from a
  // page THIS PROCESS had just served was rejected as cross-origin, logged as
  // `origin-rejected ... fetchSite=same-origin` — a self-contradiction, since
  // the browser was attesting the request came from the origin we served.
  // See the note in serve.ts: browsing the server port directly gets a stale
  // built client, so 3072 is still the right URL to use.
  const localOrigins =
    process.env.NODE_ENV === "production"
      ? []
      : [LOCAL_ORIGIN, ...serverOrigins()];

  return new Set([...localOrigins, configuredOrigin, ...extraOrigins]);
}

/**
 * The origin(s) this process is actually listening on, for development only.
 *
 * `PORT` is what the server binds; `scripts/dev.ts` sets it from `API_PORT`
 * (default 3073) so the two dev processes do not collide. A malformed value is
 * ignored rather than thrown on, because the port is validated separately at
 * startup (config/environment.ts) and this set must not be the thing that
 * reports it.
 */
function serverOrigins(): readonly string[] {
  const port = Number((process.env.PORT ?? "").trim());
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) return [];

  return [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
}

/**
 * Single source of truth for "did this request come from an origin we serve?".
 * Both the mutating-HTTP guard (requireSameOriginMutation) and the WebSocket
 * upgrade guard (requireTrustedUpgradeOrigin) answer it from here, so the policy
 * cannot drift between the two transports.
 */
export function isTrustedOrigin(origin: string | null): boolean {
  return origin !== null && trustedOrigins().has(origin);
}

/**
 * Deliberately throws rather than skipping an unparseable entry: silently
 * dropping a misconfigured origin would turn a config typo into "every mutation
 * is forbidden", which is exactly the failure this naming exists to make legible.
 */
function originOf(value: string, variable: string): string {
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(
      `${variable} must be an absolute URL such as https://app.example.com (received "${value}")`,
    );
  }
}
