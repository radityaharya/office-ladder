import { auth, type Session } from "@/lib/auth";
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
    return { ok: false, error: toHttpError(error) };
  }
}
