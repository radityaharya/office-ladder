import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  HTTP_ERROR_CODES,
  httpError,
  json,
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
