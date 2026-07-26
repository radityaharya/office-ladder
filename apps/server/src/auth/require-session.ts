import { auth, type Session } from "@/lib/auth";
import { logException } from "@/observability/log";
import {
  HTTP_ERROR_CODES,
  httpError,
  type HttpResult,
  toHttpError,
} from "../http/errors";

export type AuthenticatedSession = NonNullable<Session>;

export async function requireSession(
  requestHeaders: Headers,
): Promise<HttpResult<AuthenticatedSession>> {
  try {
    const session = await auth.api.getSession({
      headers: requestHeaders,
      query: { disableCookieCache: true },
    });

    if (session === null) {
      return {
        ok: false,
        error: httpError(HTTP_ERROR_CODES.UNAUTHORIZED),
      };
    }

    return { ok: true, value: session };
  } catch (error) {
    // Better Auth's getSession goes to Postgres, so a database outage or a bad
    // DATABASE_URL surfaces here — as an opaque 500 on *every* authenticated
    // request, previously with no trace at all. Distinguishing "no session"
    // (returned above, and deliberately silent: an expired cookie on a 5s poll
    // is not news) from "the auth backend is broken" is the whole point.
    logException("error", "session.lookup-failed", error);
    return { ok: false, error: toHttpError(error) };
  }
}
