/**
 * Body-parser attaches the raw request text to JSON parse failures.
 * That text can contain a submitted password, so it must not be logged.
 */
export function carriesRawRequestBody(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const record = err as { type?: unknown; body?: unknown; status?: unknown; statusCode?: unknown };
  const type = typeof record.type === "string" ? record.type : "";
  if (type === "entity.parse.failed" || type === "entity.verify.failed") return true;
  const status = record.status ?? record.statusCode;
  return typeof record.body === "string" && status === 400;
}

export function loggedRequestBodyFailure(
  err: unknown,
): { status: number; clientError: string; log: { reason: string } } | null {
  if (!carriesRawRequestBody(err)) return null;
  return {
    status: 400,
    clientError: "Invalid request body",
    log: { reason: "invalid_request_body" },
  };
}
