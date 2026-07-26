import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HTTP_ERROR_CODES, httpError } from "../../src/http/errors";
import { trustedOrigins } from "../../src/http/trusted-origins";
import { requireTrustedUpgradeOrigin } from "../../src/http/websocket-upgrade";

/**
 * A WebSocket handshake is a plain GET that CORS does not apply to, so before
 * this guard existed any page on any origin could open an authenticated socket
 * with the visitor's cookie attached. Nothing on the upgrade path checked Origin
 * at all, even though every mutating HTTP route did.
 */
function handshake(headers: Record<string, string>): Request {
  return new Request("http://localhost:3072/ws/rooms/room-1", { headers });
}

const FORBIDDEN = { ok: false, error: httpError(HTTP_ERROR_CODES.FORBIDDEN) } as const;
const ALLOWED = { ok: true, value: undefined } as const;

describe("requireTrustedUpgradeOrigin", () => {
  const originalAuthUrl = process.env.BETTER_AUTH_URL;
  const originalExtra = process.env.BETTER_AUTH_EXTRA_ORIGINS;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    delete process.env.BETTER_AUTH_URL;
    delete process.env.BETTER_AUTH_EXTRA_ORIGINS;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    restore("BETTER_AUTH_URL", originalAuthUrl);
    restore("BETTER_AUTH_EXTRA_ORIGINS", originalExtra);
    restore("NODE_ENV", originalNodeEnv);
  });

  function restore(name: string, value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  it("Given the origin the app is served from, When the handshake is checked, Then it is allowed", () => {
    expect(requireTrustedUpgradeOrigin(handshake({ origin: "http://localhost:3072" }))).toEqual(
      ALLOWED,
    );
  });

  it("Given a hostile page's origin, When the handshake is checked, Then it is forbidden", () => {
    expect(requireTrustedUpgradeOrigin(handshake({ origin: "https://evil.example" }))).toEqual(
      FORBIDDEN,
    );
  });

  it("Given a handshake with no Origin at all, When it is checked, Then it is forbidden", () => {
    // Same call as the mutating-HTTP guard makes: browsers always send one, so a
    // missing Origin is not a case worth opening a hole for.
    expect(requireTrustedUpgradeOrigin(handshake({}))).toEqual(FORBIDDEN);
  });

  it("Given a configured deployment origin, When a handshake arrives from it, Then it is allowed", () => {
    process.env.BETTER_AUTH_URL = "https://app.example.com";

    expect(
      requireTrustedUpgradeOrigin(handshake({ origin: "https://app.example.com" })),
    ).toEqual(ALLOWED);
    expect(
      requireTrustedUpgradeOrigin(handshake({ origin: "https://app.example.com.evil.test" })),
    ).toEqual(FORBIDDEN);
  });

  it("Given a trusted origin whose Sec-Fetch-Site says cross-site, When the handshake is checked, Then it is still allowed", () => {
    // Deliberate difference from requireSameOriginMutation: `Sec-Fetch-Site` is
    // computed against the request URL's origin, and a ws:// URL is not the same
    // origin as the http:// page that opened it, so a real client can legitimately
    // report cross-site here. The Origin allow-list is what answers the question.
    expect(
      requireTrustedUpgradeOrigin(
        handshake({ origin: "http://localhost:3072", "sec-fetch-site": "cross-site" }),
      ),
    ).toEqual(ALLOWED);
  });

  it("Given an extra configured origin, When a handshake arrives from it, Then it is allowed", () => {
    process.env.BETTER_AUTH_URL = "https://app.example.com";
    process.env.BETTER_AUTH_EXTRA_ORIGINS = "https://tunnel.example.com";

    expect(
      requireTrustedUpgradeOrigin(handshake({ origin: "https://tunnel.example.com" })),
    ).toEqual(ALLOWED);
  });

  it("Given production, When the allow-list is built, Then the local dev origin is not in it", () => {
    process.env.NODE_ENV = "production";
    process.env.BETTER_AUTH_URL = "https://app.example.com";

    // A deployed site has no reason to accept a handshake initiated by a page on
    // the visitor's own machine.
    expect([...trustedOrigins()]).toEqual(["https://app.example.com"]);
    expect(requireTrustedUpgradeOrigin(handshake({ origin: "http://localhost:3072" }))).toEqual(
      FORBIDDEN,
    );
  });

  it("Given a malformed BETTER_AUTH_URL, When the allow-list is built, Then it fails naming the variable", () => {
    process.env.BETTER_AUTH_URL = "app.example.com";

    // Previously a bare `Invalid URL` from deep inside new URL(), with no hint
    // about which variable was wrong.
    expect(() => trustedOrigins()).toThrow(/BETTER_AUTH_URL/);
  });
});
