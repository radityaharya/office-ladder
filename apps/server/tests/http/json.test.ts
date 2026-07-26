import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  HTTP_ERROR_CODES,
  httpError,
  json,
  MAX_REQUEST_BODY_BYTES,
  parseJson,
  requireSameOriginMutation,
} from "../../src/http";

describe("HTTP JSON helpers", () => {
  it("Given a response body and caller headers, When creating JSON, Then JSON and no-store headers are authoritative", async () => {
    const response = json(
      { roomId: "room-1" },
      { headers: { "cache-control": "public, max-age=3600", "content-type": "text/plain" } },
    );

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ roomId: "room-1" });
  });

  it("Given a JSON request with a media-type parameter, When parsing its body, Then the decoded value is returned", async () => {
    const request = new Request("http://localhost:3072/api/rooms", {
      body: '{"roomCode":"ABC123"}',
      headers: { "content-type": "application/json; charset=utf-8" },
      method: "POST",
    });

    const result = await parseJson(request);

    expect(result).toEqual({ ok: true, value: { roomCode: "ABC123" } });
  });

  it("Given a request with a non-JSON content type, When parsing its body, Then unsupported media type is returned", async () => {
    const request = new Request("http://localhost:3072/api/rooms", {
      body: "roomCode=ABC123",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });

    const result = await parseJson(request);

    expect(result).toEqual({
      ok: false,
      error: httpError(HTTP_ERROR_CODES.UNSUPPORTED_MEDIA_TYPE),
    });
  });

  it("Given malformed JSON, When parsing its body, Then invalid JSON is returned", async () => {
    const request = new Request("http://localhost:3072/api/rooms", {
      body: '{"roomCode":',
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    const result = await parseJson(request);

    expect(result).toEqual({
      ok: false,
      error: httpError(HTTP_ERROR_CODES.INVALID_JSON),
    });
  });

  /**
   * Every mutating handler buffered the whole body with `request.json()` and no
   * ceiling, so one authenticated request could ask this process to hold an
   * arbitrary amount of memory. The same-origin guard in front of it is a header
   * check, which a non-browser client simply sets.
   */
  it("Given a body whose declared length exceeds the cap, When parsing it, Then it is refused without being read", async () => {
    const body = "x".repeat(16);
    const request = new Request("http://localhost:3072/api/rooms", {
      body,
      headers: {
        "content-type": "application/json",
        // Declared, not actual: the cheap rejection must not depend on reading.
        "content-length": String(MAX_REQUEST_BODY_BYTES + 1),
      },
      method: "POST",
    });

    expect(await parseJson(request)).toEqual({
      ok: false,
      error: httpError(HTTP_ERROR_CODES.PAYLOAD_TOO_LARGE),
    });
    expect(httpError(HTTP_ERROR_CODES.PAYLOAD_TOO_LARGE).status).toBe(413);
  });

  it("Given an over-long body that declares no length, When parsing it, Then the bytes read are what is bounded", async () => {
    // A chunked request declares no Content-Length at all, so a header-only check
    // would be a bound in name only.
    const oversized = `{"playerName":"${"a".repeat(MAX_REQUEST_BODY_BYTES + 1)}"}`;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(oversized));
        controller.close();
      },
    });
    const request = new Request("http://localhost:3072/api/rooms", {
      body: stream,
      headers: { "content-type": "application/json" },
      method: "POST",
      // Required whenever the body is a stream rather than a buffered value.
      duplex: "half",
    } as RequestInit & { readonly duplex: "half" });

    expect(await parseJson(request)).toEqual({
      ok: false,
      error: httpError(HTTP_ERROR_CODES.PAYLOAD_TOO_LARGE),
    });
  });

  it("Given a body just under the cap, When parsing it, Then it is still accepted", async () => {
    const filler = "a".repeat(MAX_REQUEST_BODY_BYTES - 32);
    const request = new Request("http://localhost:3072/api/rooms", {
      body: JSON.stringify({ playerName: filler }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    // The positive control: a bound that refused ordinary bodies would also pass
    // the two cases above.
    expect(await parseJson(request)).toEqual({
      ok: true,
      value: { playerName: filler },
    });
  });

  it("Given a same-origin mutation request, When validating its origin, Then it is accepted", () => {
    const request = new Request("http://localhost:3072/api/rooms", {
      headers: {
        origin: "http://localhost:3072",
        "sec-fetch-site": "same-origin",
      },
      method: "POST",
    });

    const result = requireSameOriginMutation(request);

    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("Given a request without an allowed origin, When validating its mutation origin, Then forbidden is returned", () => {
    const request = new Request("http://localhost:3072/api/rooms", {
      headers: { origin: "https://untrusted.example" },
      method: "POST",
    });

    const result = requireSameOriginMutation(request);

    expect(result).toEqual({
      ok: false,
      error: httpError(HTTP_ERROR_CODES.FORBIDDEN),
    });
  });

  it("Given an allowed origin with a cross-site fetch context, When validating its mutation origin, Then forbidden is returned", () => {
    const request = new Request("http://localhost:3072/api/rooms", {
      headers: {
        origin: "http://localhost:3072",
        "sec-fetch-site": "cross-site",
      },
      method: "POST",
    });

    const result = requireSameOriginMutation(request);

    expect(result).toEqual({
      ok: false,
      error: httpError(HTTP_ERROR_CODES.FORBIDDEN),
    });
  });

  it("Given the unauthorized error code, When mapping it to HTTP, Then its public status is 401", () => {
    const result = httpError(HTTP_ERROR_CODES.UNAUTHORIZED);

    expect(result).toEqual({ code: "UNAUTHORIZED", status: 401 });
  });
});
