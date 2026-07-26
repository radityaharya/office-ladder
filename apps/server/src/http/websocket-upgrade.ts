import { HTTP_ERROR_CODES, httpError, type HttpResult } from "./errors";
import { isTrustedOrigin } from "./trusted-origins";

/**
 * Origin guard for the WebSocket handshake — the CORS-exempt sibling of
 * requireSameOriginMutation.
 *
 * A WebSocket handshake is a plain GET that no browser subjects to CORS: any
 * page on any origin can open `new WebSocket("wss://ours/...")` and the user's
 * session cookie rides along. Without this check that yields an authenticated
 * socket owned by a hostile page (cross-site WebSocket hijacking). Origin is the
 * defence that works, because browsers set it themselves and forbid page script
 * from overriding it.
 *
 * Two deliberate differences from requireSameOriginMutation:
 *
 * - `Sec-Fetch-Site` is *not* consulted. It is computed by comparing the page's
 *   origin against the request URL's origin, and a `ws://`/`wss://` URL has a
 *   different scheme from the `http(s)://` page that opened it, so a legitimate
 *   same-page connection is not reliably reported as `same-origin` across
 *   browsers. Gating on it risks rejecting real clients for no added protection:
 *   the Origin allow-list already answers the question.
 * - A missing Origin is rejected, matching requireSameOriginMutation. Every
 *   client this server supports is a browser, and browsers always send Origin on
 *   a handshake; a non-browser client must therefore send one too, which is no
 *   new burden since it already must to create or join a room at all.
 */
export function requireTrustedUpgradeOrigin(request: Request): HttpResult<void> {
  if (!isTrustedOrigin(request.headers.get("origin"))) {
    return { ok: false, error: httpError(HTTP_ERROR_CODES.FORBIDDEN) };
  }

  return { ok: true, value: undefined };
}
