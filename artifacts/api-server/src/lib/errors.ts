export class AppError extends Error {
  readonly status: number;
  readonly extra?: Record<string, unknown>;

  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.extra = extra;
  }
}

export function clientIp(req: { headers: Record<string, unknown>; socket?: { remoteAddress?: string } }): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return req.socket?.remoteAddress ?? "unknown";
}
