import { authSessionsRepo } from "@workspace/db";
import type { AuthSession } from "@workspace/db";
import {
  REFRESH_COOKIE_MAX_AGE_MS,
  generateRefreshSecret,
  generateSessionPublicId,
  hashRefreshToken,
  type PortalChannel,
} from "./auth";

export interface IssuedAuthSession {
  session: AuthSession;
  publicId: string;
  refreshSecret: string;
  expiresAt: Date;
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const number = "number" in err ? Number((err as { number?: unknown }).number) : Number.NaN;
  return number === 2601 || number === 2627;
}

/** Inserts one new auth_sessions row. public_id is retried only if the unique index collides. */
export async function issueAuthSession(input: {
  userId: number;
  portal: PortalChannel;
}): Promise<IssuedAuthSession> {
  const refreshSecret = generateRefreshSecret();
  const refreshTokenHash = hashRefreshToken(refreshSecret);
  const expiresAt = new Date(Date.now() + REFRESH_COOKIE_MAX_AGE_MS);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const publicId = generateSessionPublicId();
    try {
      const session = await authSessionsRepo.insertSession({
        userId: input.userId,
        refreshTokenHash,
        expiresAt,
        publicId,
        portal: input.portal,
      });
      return { session, publicId, refreshSecret, expiresAt };
    } catch (err) {
      if (!isUniqueViolation(err) || attempt === 2) throw err;
    }
  }

  throw new Error("Unable to allocate a session id");
}
