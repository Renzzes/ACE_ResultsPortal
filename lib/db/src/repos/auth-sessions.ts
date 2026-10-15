import type { Transaction } from "mssql";
import type { AuthSession } from "../types";
import { mapAuthSession } from "../mappers";
import { getPool, request, sql } from "../pool";

const SESSION_COLUMNS = `
  id, user_id, refresh_token_hash, expires_at, revoked_at, created_at, last_used_at,
  public_id, portal
`;

const INSERTED_COLUMNS = `
  INSERTED.id, INSERTED.user_id, INSERTED.refresh_token_hash, INSERTED.expires_at,
  INSERTED.revoked_at, INSERTED.created_at, INSERTED.last_used_at,
  INSERTED.public_id, INSERTED.portal
`;

export async function insertSession(input: {
  userId: number;
  refreshTokenHash: string;
  expiresAt: Date;
  publicId: string;
  portal: string;
}): Promise<AuthSession> {
  await getPool();
  const result = await request()
    .input("userId", sql.Int, input.userId)
    .input("refreshTokenHash", sql.Char(64), input.refreshTokenHash)
    .input("expiresAt", sql.DateTimeOffset, input.expiresAt)
    .input("publicId", sql.Char(22), input.publicId)
    .input("portal", sql.VarChar(16), input.portal)
    .query(
      `INSERT INTO dbo.auth_sessions
         (user_id, refresh_token_hash, expires_at, public_id, portal)
       OUTPUT ${INSERTED_COLUMNS}
       VALUES (@userId, @refreshTokenHash, @expiresAt, @publicId, @portal)`,
    );
  return mapAuthSession(result.recordset[0] as Record<string, unknown>);
}

export async function findByPublicId(publicId: string): Promise<AuthSession | undefined> {
  await getPool();
  const result = await request()
    .input("publicId", sql.Char(22), publicId)
    .query(
      `SELECT ${SESSION_COLUMNS}
       FROM dbo.auth_sessions
       WHERE public_id = @publicId`,
    );
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapAuthSession(row) : undefined;
}

export async function findUsableByPublicId(publicId: string): Promise<AuthSession | undefined> {
  await getPool();
  const result = await request()
    .input("publicId", sql.Char(22), publicId)
    .query(
      `SELECT ${SESSION_COLUMNS}
       FROM dbo.auth_sessions
       WHERE public_id = @publicId
         AND portal IS NOT NULL
         AND revoked_at IS NULL
         AND expires_at > SYSDATETIMEOFFSET()`,
    );
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapAuthSession(row) : undefined;
}

/** Replaces the refresh hash only when the presented hash still matches. public_id stays the same. */
export async function rotateRefreshSecret(input: {
  publicId: string;
  currentHash: string;
  nextHash: string;
}): Promise<AuthSession | undefined> {
  await getPool();
  const result = await request()
    .input("publicId", sql.Char(22), input.publicId)
    .input("currentHash", sql.Char(64), input.currentHash)
    .input("nextHash", sql.Char(64), input.nextHash)
    .query(
      `UPDATE dbo.auth_sessions
       SET refresh_token_hash = @nextHash,
           last_used_at = SYSDATETIMEOFFSET()
       OUTPUT ${INSERTED_COLUMNS}
       WHERE public_id = @publicId
         AND refresh_token_hash = @currentHash
         AND portal IS NOT NULL
         AND revoked_at IS NULL
         AND expires_at > SYSDATETIMEOFFSET()`,
    );
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapAuthSession(row) : undefined;
}

export async function revokeAllForUser(userId: number, tx?: Transaction): Promise<void> {
  if (!tx) await getPool();
  await request(tx)
    .input("userId", sql.Int, userId)
    .query(
      `UPDATE dbo.auth_sessions
       SET revoked_at = SYSDATETIMEOFFSET()
       WHERE user_id = @userId
         AND revoked_at IS NULL`,
    );
}

export async function revokeByPublicId(publicId: string, userId: number): Promise<boolean> {
  await getPool();
  const result = await request()
    .input("publicId", sql.Char(22), publicId)
    .input("userId", sql.Int, userId)
    .query(
      `UPDATE dbo.auth_sessions
       SET revoked_at = SYSDATETIMEOFFSET()
       WHERE public_id = @publicId
         AND user_id = @userId
         AND revoked_at IS NULL`,
    );
  return (result.rowsAffected[0] ?? 0) > 0;
}

export type ActiveSessionView = {
  id: number;
  userId: number;
  username: string;
  firstName: string;
  lastName: string;
  role: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
  status: "active" | "idle";
};

export async function listActiveSessions(limit = 50): Promise<ActiveSessionView[]> {
  await getPool();
  const result = await request()
    .input("limit", sql.Int, limit)
    .query(`
      SELECT TOP (@limit)
        s.id,
        s.user_id,
        u.username,
        u.first_name,
        u.last_name,
        u.role,
        s.created_at,
        s.last_used_at,
        s.expires_at
      FROM dbo.auth_sessions s
      INNER JOIN dbo.users u ON u.id = s.user_id
      WHERE s.revoked_at IS NULL
        AND s.expires_at > SYSDATETIMEOFFSET()
      ORDER BY COALESCE(s.last_used_at, s.created_at) DESC
    `);

  const idleMs = 15 * 60 * 1000;
  const now = Date.now();
  return (result.recordset as Array<Record<string, unknown>>).map((row) => {
    const lastUsedAt = row.last_used_at ? new Date(String(row.last_used_at)) : null;
    const createdAt = new Date(String(row.created_at));
    const anchor = lastUsedAt?.getTime() ?? createdAt.getTime();
    return {
      id: Number(row.id),
      userId: Number(row.user_id),
      username: String(row.username ?? ""),
      firstName: String(row.first_name ?? ""),
      lastName: String(row.last_name ?? ""),
      role: String(row.role ?? ""),
      createdAt,
      lastUsedAt,
      expiresAt: new Date(String(row.expires_at)),
      status: now - anchor > idleMs ? ("idle" as const) : ("active" as const),
    };
  });
}

export async function countActiveSessions(): Promise<number> {
  await getPool();
  const result = await request().query(`
    SELECT COUNT(*) AS total
    FROM dbo.auth_sessions
    WHERE revoked_at IS NULL
      AND expires_at > SYSDATETIMEOFFSET()
  `);
  return Number((result.recordset[0] as { total: number }).total ?? 0);
}
