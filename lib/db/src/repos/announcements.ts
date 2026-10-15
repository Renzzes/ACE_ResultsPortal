import type { Transaction } from "mssql";
import type {
  AnnouncementRow,
  AnnouncementTargetRow,
  AnnouncementTargetType,
  NotificationPriority,
} from "../types";
import { mapAnnouncement, mapAnnouncementTarget } from "../mappers";
import { getPool, request, sql } from "../pool";

export async function insertAnnouncement(
  input: {
    title: string;
    body: string;
    priority: NotificationPriority;
    createdById: number;
    expiresAt?: Date | null;
  },
  tx?: Transaction,
): Promise<AnnouncementRow> {
  if (!tx) await getPool();
  const result = await request(tx)
    .input("title", sql.NVarChar(255), input.title)
    .input("body", sql.NVarChar(sql.MAX), input.body)
    .input("priority", sql.NVarChar(32), input.priority)
    .input("createdById", sql.Int, input.createdById)
    .input("expiresAt", sql.DateTimeOffset, input.expiresAt ?? null)
    .query(`
      INSERT INTO dbo.announcements (title, body, priority, created_by_id, expires_at)
      OUTPUT INSERTED.*
      VALUES (@title, @body, @priority, @createdById, @expiresAt)
    `);
  return mapAnnouncement(result.recordset[0] as Record<string, unknown>);
}

export async function replaceTargets(
  announcementId: number,
  targets: Array<{ targetType: AnnouncementTargetType; targetValue?: string | null }>,
  tx?: Transaction,
): Promise<void> {
  if (!tx) await getPool();
  await request(tx)
    .input("announcementId", sql.Int, announcementId)
    .query(`DELETE FROM dbo.announcement_targets WHERE announcement_id = @announcementId`);
  for (const t of targets) {
    await request(tx)
      .input("announcementId", sql.Int, announcementId)
      .input("targetType", sql.NVarChar(32), t.targetType)
      .input("targetValue", sql.NVarChar(64), t.targetValue ?? null)
      .query(`
        INSERT INTO dbo.announcement_targets (announcement_id, target_type, target_value)
        VALUES (@announcementId, @targetType, @targetValue)
      `);
  }
}

export async function findAnnouncementById(id: number): Promise<AnnouncementRow | undefined> {
  await getPool();
  const result = await request()
    .input("id", sql.Int, id)
    .query(`SELECT * FROM dbo.announcements WHERE id = @id`);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapAnnouncement(row) : undefined;
}

export async function listTargets(announcementId: number): Promise<AnnouncementTargetRow[]> {
  await getPool();
  const result = await request()
    .input("announcementId", sql.Int, announcementId)
    .query(`SELECT * FROM dbo.announcement_targets WHERE announcement_id = @announcementId`);
  return (result.recordset as Record<string, unknown>[]).map(mapAnnouncementTarget);
}

export async function listAnnouncements(opts: {
  includeDrafts?: boolean;
  page?: number;
  limit?: number;
}): Promise<{ data: AnnouncementRow[]; total: number }> {
  await getPool();
  const page = opts.page ?? 1;
  const limit = Math.min(opts.limit ?? 20, 50);
  const offset = (page - 1) * limit;
  const draftClause = opts.includeDrafts ? "" : "WHERE is_published = 1";
  const countResult = await request().query(`SELECT COUNT(*) AS total FROM dbo.announcements ${draftClause}`);
  const total = Number((countResult.recordset[0] as { total: number }).total ?? 0);
  const result = await request()
    .input("offset", sql.Int, offset)
    .input("limit", sql.Int, limit)
    .query(`
      SELECT * FROM dbo.announcements
      ${draftClause}
      ORDER BY COALESCE(published_at, created_at) DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);
  return {
    data: (result.recordset as Record<string, unknown>[]).map(mapAnnouncement),
    total,
  };
}

export async function updateAnnouncement(
  id: number,
  patch: {
    title?: string;
    body?: string;
    priority?: NotificationPriority;
    expiresAt?: Date | null;
  },
  tx?: Transaction,
): Promise<AnnouncementRow | undefined> {
  if (!tx) await getPool();
  const existing = await findAnnouncementById(id);
  if (!existing) return undefined;
  if (existing.isPublished) return existing;

  const result = await request(tx)
    .input("id", sql.Int, id)
    .input("title", sql.NVarChar(255), patch.title ?? existing.title)
    .input("body", sql.NVarChar(sql.MAX), patch.body ?? existing.body)
    .input("priority", sql.NVarChar(32), patch.priority ?? existing.priority)
    .input(
      "expiresAt",
      sql.DateTimeOffset,
      patch.expiresAt === undefined ? existing.expiresAt : patch.expiresAt,
    )
    .query(`
      UPDATE dbo.announcements
      SET title = @title,
          body = @body,
          priority = @priority,
          expires_at = @expiresAt,
          updated_at = SYSDATETIMEOFFSET()
      OUTPUT INSERTED.*
      WHERE id = @id AND is_published = 0
    `);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapAnnouncement(row) : undefined;
}

export async function publishAnnouncement(
  id: number,
  tx?: Transaction,
): Promise<AnnouncementRow | undefined> {
  if (!tx) await getPool();
  const result = await request(tx)
    .input("id", sql.Int, id)
    .query(`
      UPDATE dbo.announcements
      SET is_published = 1,
          published_at = SYSDATETIMEOFFSET(),
          updated_at = SYSDATETIMEOFFSET()
      OUTPUT INSERTED.*
      WHERE id = @id AND is_published = 0
    `);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapAnnouncement(row) : undefined;
}
