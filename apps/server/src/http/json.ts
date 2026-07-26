import { logException } from "@/observability/log";
import {
  HTTP_ERROR_CODES,
  httpError,
  type HttpResult,
} from "./errors";
import { isTrustedOrigin } from "./trusted-origins";

const JSON_CONTENT_TYPE = "application/json";

/**
 * Upper bound on a request body this server will buffer.
 *
 * Every mutating handler used to `await request.json()`, which reads the whole
 * body into memory with no ceiling: one authenticated request with a multi-gigabyte
 * body — or a slow trickle of them — is enough to exhaust the process, and none of
 * the guards in front of it help (the same-origin check reads a header a non-browser
 * client simply sets). The largest legitimate body here is a room creation of a few
 * hundred bytes, so 64 KiB is generous by three orders of magnitude while still
 * being a bound.
 *
 * Enforced against the bytes actually read, not only `Content-Length`: a chunked
 * request declares no length at all, so trusting the header would be a bound in
 * name only.
 */
export const MAX_REQUEST_BODY_BYTES = 64 * 1024;

export function json<Value>(body: Value, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers as ConstructorParameters<typeof Headers>[0]);
  headers.set("cache-control", "no-store");
  headers.set("content-type", JSON_CONTENT_TYPE);

  return Response.json(body, { ...init, headers });
}

export async function parseJson(request: Request): Promise<HttpResult<unknown>> {
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return {
      ok: false,
      error: httpError(HTTP_ERROR_CODES.UNSUPPORTED_MEDIA_TYPE),
    };
  }

  try {
    const body = await readBoundedBody(request);
    if (!body.ok) return body;
    return { ok: true, value: JSON.parse(body.value) };
  } catch (error) {
    if (error instanceof SyntaxError) {
      // A malformed body is the caller's fault and self-announcing (they get the
      // 400). Logging it would let any client fill the log at will.
      return { ok: false, error: httpError(HTTP_ERROR_CODES.INVALID_JSON) };
    }

    // Anything else means the body could not be *read* — an aborted or broken
    // request stream, not bad JSON. Both branches used to be byte-identical, so
    // a transport failure was indistinguishable from a typo'd payload; telling
    // the client INVALID_JSON is still the right answer, but it must not be the
    // only record.
    logException("warn", "http.body-unreadable", error, {
      method: request.method,
      contentLength: request.headers.get("content-length"),
    });
    return { ok: false, error: httpError(HTTP_ERROR_CODES.INVALID_JSON) };
  }
}

export function requireSameOriginMutation(request: Request): HttpResult<void> {
  const fetchSite = request.headers.get("sec-fetch-site");

  if (
    !isTrustedOrigin(request.headers.get("origin")) ||
    (fetchSite !== null && fetchSite !== "same-origin")
  ) {
    return { ok: false, error: httpError(HTTP_ERROR_CODES.FORBIDDEN) };
  }

  return { ok: true, value: undefined };
}

/**
 * Reads the body as text, refusing anything over {@link MAX_REQUEST_BODY_BYTES}.
 *
 * A declared `Content-Length` over the limit is refused without reading a byte,
 * which is the cheap case; otherwise the stream is read chunk by chunk and
 * cancelled the moment the running total passes the limit, so an over-long body is
 * never fully buffered whether or not its length was declared honestly.
 */
async function readBoundedBody(request: Request): Promise<HttpResult<string>> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BODY_BYTES) {
    return { ok: false, error: httpError(HTTP_ERROR_CODES.PAYLOAD_TOO_LARGE) };
  }

  const body = request.body;
  // No body at all: JSON.parse("") throws SyntaxError, which is the same answer a
  // missing body used to get from request.json().
  if (body === null) return { ok: true, value: "" };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    size += value.byteLength;
    if (size > MAX_REQUEST_BODY_BYTES) {
      await reader.cancel();
      return { ok: false, error: httpError(HTTP_ERROR_CODES.PAYLOAD_TOO_LARGE) };
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // Lossy decoding, exactly as `request.json()` did: invalid UTF-8 is a client
  // fault that the JSON parse or a field validator will answer for, and making it
  // throw here would route it into the log line below, which any client could then
  // fill at will.
  return { ok: true, value: new TextDecoder().decode(merged) };
}

function isJsonContentType(contentType: string | null): boolean {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() === JSON_CONTENT_TYPE;
}
