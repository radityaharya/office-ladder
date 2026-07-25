const LOCAL_ORIGIN = "http://localhost:3072";

/**
 * BETTER_AUTH_URL covers the canonical deployment origin. BETTER_AUTH_EXTRA_ORIGINS
 * (comma-separated) covers additional origins the app is legitimately served from —
 * e.g. a local tunnel host used for testing on another device — without weakening
 * the same-origin check to accept arbitrary hosts.
 */
export function trustedOrigins(): ReadonlySet<string> {
  const configuredOrigin = new URL(process.env.BETTER_AUTH_URL ?? LOCAL_ORIGIN).origin;
  const extraOrigins = (process.env.BETTER_AUTH_EXTRA_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
    .map((origin) => new URL(origin).origin);

  return new Set([LOCAL_ORIGIN, configuredOrigin, ...extraOrigins]);
}
