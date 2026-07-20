export const HTTP_ERROR_CODES = {
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
  INVALID_JSON: "INVALID_JSON",
  FORBIDDEN: "FORBIDDEN",
  UNAUTHORIZED: "UNAUTHORIZED",
  UNSUPPORTED_MEDIA_TYPE: "UNSUPPORTED_MEDIA_TYPE",
} as const;

export type HttpErrorCode =
  (typeof HTTP_ERROR_CODES)[keyof typeof HTTP_ERROR_CODES];

export type HttpError = {
  readonly code: HttpErrorCode;
  readonly status: number;
};

export type HttpResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: HttpError };

const HTTP_ERROR_STATUSES = {
  INTERNAL_SERVER_ERROR: 500,
  INVALID_JSON: 400,
  FORBIDDEN: 403,
  UNAUTHORIZED: 401,
  UNSUPPORTED_MEDIA_TYPE: 415,
} as const satisfies Record<HttpErrorCode, number>;

export function httpError(code: HttpErrorCode): HttpError {
  return { code, status: HTTP_ERROR_STATUSES[code] };
}

export function toHttpError(error: unknown): HttpError {
  void error;
  return httpError(HTTP_ERROR_CODES.INTERNAL_SERVER_ERROR);
}
