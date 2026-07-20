import {
  HTTP_ERROR_CODES,
  httpError,
  type HttpResult,
} from "./errors";

const JSON_CONTENT_TYPE = "application/json";
const LOCAL_ORIGIN = "http://localhost:3072";

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
    return { ok: true, value: await request.json() };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { ok: false, error: httpError(HTTP_ERROR_CODES.INVALID_JSON) };
    }

    return { ok: false, error: httpError(HTTP_ERROR_CODES.INVALID_JSON) };
  }
}

export function requireSameOriginMutation(request: Request): HttpResult<void> {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");

  if (
    origin === null ||
    !trustedOrigins().has(origin) ||
    (fetchSite !== null && fetchSite !== "same-origin")
  ) {
    return { ok: false, error: httpError(HTTP_ERROR_CODES.FORBIDDEN) };
  }

  return { ok: true, value: undefined };
}

function isJsonContentType(contentType: string | null): boolean {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() === JSON_CONTENT_TYPE;
}

function trustedOrigins(): ReadonlySet<string> {
  const configuredOrigin = new URL(
    process.env.BETTER_AUTH_URL ?? LOCAL_ORIGIN,
  ).origin;

  return new Set([LOCAL_ORIGIN, configuredOrigin]);
}
