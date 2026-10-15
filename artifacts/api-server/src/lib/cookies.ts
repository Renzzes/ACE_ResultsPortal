import type { CookieOptions, Response } from "express";
import { REFRESH_COOKIE_MAX_AGE_MS, REFRESH_COOKIE_NAME } from "./auth";

/**
 * HttpOnly refresh cookies.
 * SameSite=Lax and POST-only refresh/logout mean a cross-site form POST does not
 * include the cookie, so a separate CSRF token is not added.
 * Secure stays on only when NODE_ENV is production (HTTPS). Development HTTP
 * does not set Secure and does not widen the cookie to JavaScript.
 */
export function refreshCookieOptions(): CookieOptions {
  const secure = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/api/auth",
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  };
}

/** Expires a leftover `ace_refresh_token` cookie. Does not set a new value. */
export function expireLegacyRefreshCookie(res: Response, presented: unknown): void {
  if (typeof presented !== "string" || presented.length === 0) return;
  res.clearCookie(REFRESH_COOKIE_NAME, { ...refreshCookieOptions(), maxAge: 0 });
}

export { REFRESH_COOKIE_NAME };
