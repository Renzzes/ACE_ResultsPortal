import type { Transaction } from "mssql";
import type { NotificationPriority, NotificationRow } from "../types";
import { mapNotification } from "../mappers";
import { getPool, request, sql } from "../pool";
import { bindInInts } from "../sql-helpers";

const COLS = `
  id, recipient_user_id, type, title, body, entity_type, entity_id,
  priority, is_read, read_at, created_at, expires_at
`;

export async function messagingSchemaReady(): Promise<boolean> {
  try {
    await getPool();
    const result = await request().query(`
      SELECT
        OBJECT_ID(N'dbo.notifications', N'U') AS n,
        OBJECT_ID(N'dbo.announcements', N'U') AS a,
        OBJECT_ID(N'dbo.message_threads', N'U') AS t,
        OBJECT_ID(N'dbo.messages', N'U') AS m
    `);
    const row = result.recordset[0] as Record<string, unknown>;
    return Boolean(row.n && row.a && row.t && row.m);
  } catch {
    return false;
  }
}

export async function insertNotification(
  input: {
    recipientUserId: number;
    type: string;
    title: string;
    body: string;
    entityType?: string | null;
    entityId?: number | null;
    priority?: NotificationPriority;
    expiresAt?: Date | null;
  },
  tx?: Transaction,
): Promise<NotificationRow> {
  if (!tx) await getPool();
  const result = await request(tx)
    .input("recipientUserId", sql.Int, input.recipientUserId)
    .input("type", sql.NVarChar(64), input.type)
    .input("title", sql.NVarChar(255), input.title)
    .input("body", sql.NVarChar(1000), input.body)
    .input("entityType", sql.NVarChar(64), input.entityType ?? null)
    .input("entityId", sql.Int, input.entityId ?? null)
    .input("priority", sql.NVarChar(32), input.priority ?? "normal")
    .input("expiresAt", sql.DateTimeOffset, input.expiresAt ?? null)
    .query(`
      INSERT INTO dbo.notifications
        (recipient_user_id, type, title, body, entity_type, entity_id, priority, expires_at)
      OUTPUT INSERTED.*
      VALUES
        (@recipientUserId, @type, @title, @body, @entityType, @entityId, @priority, @expiresAt)
    `);
  return mapNotification(result.recordset[0] as Record<string, unknown>);
}

/** Insert one notification per recipient, skipping duplicates for same type+entity. */
export async function insertNotificationsDeduped(
  recipients: number[],
  input: {
    type: string;
    title: string;
    body: string;
    entityType?: string | null;
    entityId?: number | null;
    priority?: NotificationPriority;
    expiresAt?: Date | null;
  },
  tx?: Transaction,
): Promise<number> {
  const unique = [...new Set(recipients.filter((id) => Number.isFinite(id) && id > 0))];
  let created = 0;
  for (const recipientUserId of unique) {
    if (!tx) await getPool();
    const existing = await request(tx)
      .input("recipientUserId", sql.Int, recipientUserId)
      .input("type", sql.NVarChar(64), input.type)
      .input("entityType", sql.NVarChar(64), input.entityType ?? null)
      .input("entityId", sql.Int, input.entityId ?? null)
      .query(`
        SELECT TOP 1 id FROM dbo.notifications
        WHERE recipient_user_id = @recipientUserId
          AND type = @type
          AND ((@entityType IS NULL AND entity_type IS NULL) OR entity_type = @entityType)
          AND ((@entityId IS NULL AND entity_id IS NULL) OR entity_id = @entityId)
      `);
    if (existing.recordset.length > 0) continue;
    await insertNotification({ ...input, recipientUserId }, tx);
    created += 1;
  }
  return created;
}

export async function listNotificationsForUser(
  userId: number,
  opts: { unreadOnly?: boolean; page?: number; limit?: number } = {},
): Promise<{ data: NotificationRow[]; total: number }> {
  await getPool();
  const page = opts.page ?? 1;
  const limit = Math.min(opts.limit ?? 20, 50);
  const offset = (page - 1) * limit;
  const unreadClause = opts.unreadOnly ? "AND is_read = 0" : "";
  const countResult = await request()
    .input("userId", sql.Int, userId)
    .query(`
      SELECT COUNT(*) AS total FROM dbo.notifications
      WHERE recipient_user_id = @userId
        AND (expires_at IS NULL OR expires_at > SYSDATETIMEOFFSET())
        ${unreadClause}
    `);
  const total = Number((countResult.recordset[0] as { total: number }).total ?? 0);
  const result = await request()
    .input("userId", sql.Int, userId)
    .input("offset", sql.Int, offset)
    .input("limit", sql.Int, limit)
    .query(`
      SELECT ${COLS} FROM dbo.notifications
      WHERE recipient_user_id = @userId
        AND (expires_at IS NULL OR expires_at > SYSDATETIMEOFFSET())
        ${unreadClause}
      ORDER BY created_at DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);
  return {
    data: (result.recordset as Record<string, unknown>[]).map(mapNotification),
    total,
  };
}

export async function countUnread(userId: number): Promise<number> {
  await getPool();
  const result = await request()
    .input("userId", sql.Int, userId)
    .query(`
      SELECT COUNT(*) AS total FROM dbo.notifications
      WHERE recipient_user_id = @userId
        AND is_read = 0
        AND (expires_at IS NULL OR expires_at > SYSDATETIMEOFFSET())
    `);
  return Number((result.recordset[0] as { total: number }).total ?? 0);
}

export async function findNotificationForUser(
  id: number,
  userId: number,
): Promise<NotificationRow | undefined> {
  await getPool();
  const result = await request()
    .input("id", sql.Int, id)
    .input("userId", sql.Int, userId)
    .query(`SELECT ${COLS} FROM dbo.notifications WHERE id = @id AND recipient_user_id = @userId`);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapNotification(row) : undefined;
}

export async function markRead(id: number, userId: number): Promise<NotificationRow | undefined> {
  await getPool();
  const result = await request()
    .input("id", sql.Int, id)
    .input("userId", sql.Int, userId)
    .query(`
      UPDATE dbo.notifications
      SET is_read = 1, read_at = SYSDATETIMEOFFSET()
      OUTPUT INSERTED.*
      WHERE id = @id AND recipient_user_id = @userId
    `);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapNotification(row) : undefined;
}

export async function markAllRead(userId: number): Promise<number> {
  await getPool();
  const result = await request()
    .input("userId", sql.Int, userId)
    .query(`
      UPDATE dbo.notifications
      SET is_read = 1, read_at = SYSDATETIMEOFFSET()
      WHERE recipient_user_id = @userId AND is_read = 0
    `);
  return Number(result.rowsAffected[0] ?? 0);
}

export async function listActiveAdminUserIds(): Promise<number[]> {
  await getPool();
  const result = await request().query(`
    SELECT id FROM dbo.users
    WHERE is_active = 1
      AND role IN (N'super_admin', N'medical_records')
  `);
  return (result.recordset as Array<{ id: number }>).map((r) => Number(r.id));
}

export async function listActiveStaffUserIds(): Promise<number[]> {
  await getPool();
  const result = await request().query(`
    SELECT id FROM dbo.users
    WHERE is_active = 1
      AND role NOT IN (N'physician', N'patient', N'super_admin')
  `);
  return (result.recordset as Array<{ id: number }>).map((r) => Number(r.id));
}

export async function listActivePhysicianUserIds(): Promise<number[]> {
  await getPool();
  const result = await request().query(`
    SELECT id FROM dbo.users WHERE is_active = 1 AND role = N'physician'
  `);
  return (result.recordset as Array<{ id: number }>).map((r) => Number(r.id));
}

/**
 * Active Patient Portal users: users.role=patient, is_active=1,
 * and linked via patients.portal_user_id (hospital-only rows excluded).
 */
export async function listActivePortalPatientUserIds(): Promise<number[]> {
  await getPool();
  const result = await request().query(`
    SELECT DISTINCT u.id
    FROM dbo.users u
    INNER JOIN dbo.patients p ON p.portal_user_id = u.id
    WHERE u.is_active = 1
      AND u.role = N'patient'
      AND p.portal_user_id IS NOT NULL
  `);
  return (result.recordset as Array<{ id: number }>).map((r) => Number(r.id));
}

export async function listActiveDepartmentUserIds(departmentCode: string): Promise<number[]> {
  await getPool();
  const result = await request()
    .input("role", sql.NVarChar(32), departmentCode)
    .query(`SELECT id FROM dbo.users WHERE is_active = 1 AND role = @role`);
  return (result.recordset as Array<{ id: number }>).map((r) => Number(r.id));
}

export async function listActiveAssignedPhysicianIds(patientId: number): Promise<number[]> {
  await getPool();
  const result = await request()
    .input("patientId", sql.Int, patientId)
    .query(`
      SELECT u.id
      FROM dbo.patient_physicians pp
      INNER JOIN dbo.users u ON u.id = pp.physician_id
      WHERE pp.patient_id = @patientId
        AND u.is_active = 1
        AND u.role = N'physician'
    `);
  return (result.recordset as Array<{ id: number }>).map((r) => Number(r.id));
}

export async function listUsersByIdsSafe(ids: number[]): Promise<Array<{ id: number; role: string; isActive: boolean }>> {
  if (ids.length === 0) return [];
  await getPool();
  const req = request();
  const list = bindInInts(req, "uid", ids);
  const result = await req.query(`SELECT id, role, is_active FROM dbo.users WHERE id IN (${list})`);
  return (result.recordset as Record<string, unknown>[]).map((row) => ({
    id: Number(row.id),
    role: String(row.role),
    isActive: Boolean(row.is_active),
  }));
}
