import type { Transaction } from "mssql";
import type { MessageParticipantRow, MessageRow, MessageThreadRow } from "../types";
import { mapMessage, mapMessageParticipant, mapMessageThread } from "../mappers";
import { getPool, request, sql } from "../pool";

/** Stable lock name for one unordered pair. Concurrent opens serialize on this resource. */
export function directPairLockResource(userIdA: number, userIdB: number): string {
  const low = Math.min(userIdA, userIdB);
  const high = Math.max(userIdA, userIdB);
  return `ace-direct-thread:${low}:${high}`;
}

/**
 * Exclusive transaction lock so two requests cannot create two open 1-to-1 threads
 * for the same pair. Released when the transaction commits or rolls back.
 */
export async function acquireDirectPairLock(
  userIdA: number,
  userIdB: number,
  tx: Transaction,
): Promise<void> {
  const result = await request(tx)
    .input("resource", sql.NVarChar(255), directPairLockResource(userIdA, userIdB))
    .query(`
      DECLARE @lockResult INT;
      EXEC @lockResult = sp_getapplock
        @Resource = @resource,
        @LockMode = 'Exclusive',
        @LockOwner = 'Transaction',
        @LockTimeout = 15000;
      SELECT @lockResult AS lock_result;
    `);
  const code = Number((result.recordset[0] as { lock_result: number } | undefined)?.lock_result);
  if (!Number.isFinite(code) || code < 0) {
    throw new Error(`Could not lock direct conversation (${code})`);
  }
}

/** Newest open thread whose participants are exactly this pair. Closed threads are ignored. */
export async function findOpenDirectThread(
  userIdA: number,
  userIdB: number,
  tx?: Transaction,
): Promise<MessageThreadRow | undefined> {
  if (!tx) await getPool();
  const result = await request(tx)
    .input("userA", sql.Int, userIdA)
    .input("userB", sql.Int, userIdB)
    .query(`
      SELECT TOP 1 t.*
      FROM dbo.message_threads t
      INNER JOIN dbo.message_participants a
        ON a.thread_id = t.id AND a.user_id = @userA
      INNER JOIN dbo.message_participants b
        ON b.thread_id = t.id AND b.user_id = @userB
      WHERE t.is_closed = 0
        AND (
          SELECT COUNT(*)
          FROM dbo.message_participants c
          WHERE c.thread_id = t.id
        ) = 2
      ORDER BY t.updated_at DESC, t.id DESC
    `);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapMessageThread(row) : undefined;
}

export async function touchThread(threadId: number, tx?: Transaction): Promise<void> {
  if (!tx) await getPool();
  await request(tx)
    .input("threadId", sql.Int, threadId)
    .query(`UPDATE dbo.message_threads SET updated_at = SYSDATETIMEOFFSET() WHERE id = @threadId`);
}

export async function createThread(
  input: {
    subject: string;
    patientId?: number | null;
    createdById: number;
    participantUserIds: number[];
    firstMessageBody?: string;
  },
  tx?: Transaction,
): Promise<{ thread: MessageThreadRow; firstMessage: MessageRow | null }> {
  if (!tx) await getPool();
  const threadResult = await request(tx)
    .input("subject", sql.NVarChar(255), input.subject)
    .input("patientId", sql.Int, input.patientId ?? null)
    .input("createdById", sql.Int, input.createdById)
    .query(`
      INSERT INTO dbo.message_threads (subject, patient_id, created_by_id)
      OUTPUT INSERTED.*
      VALUES (@subject, @patientId, @createdById)
    `);
  const thread = mapMessageThread(threadResult.recordset[0] as Record<string, unknown>);

  const participants = new Set([input.createdById, ...input.participantUserIds]);
  for (const userId of participants) {
    await request(tx)
      .input("threadId", sql.Int, thread.id)
      .input("userId", sql.Int, userId)
      .input("creatorId", sql.Int, input.createdById)
      .query(`
        INSERT INTO dbo.message_participants (thread_id, user_id, last_read_at)
        VALUES (
          @threadId,
          @userId,
          CASE WHEN @userId = @creatorId THEN SYSDATETIMEOFFSET() ELSE NULL END
        )
      `);
  }

  let firstMessage: MessageRow | null = null;
  if (input.firstMessageBody?.trim()) {
    firstMessage = await insertMessage(
      { threadId: thread.id, senderUserId: input.createdById, body: input.firstMessageBody.trim() },
      tx,
    );
  }
  return { thread, firstMessage };
}

export async function insertMessage(
  input: { threadId: number; senderUserId: number; body: string },
  tx?: Transaction,
): Promise<MessageRow> {
  if (!tx) await getPool();
  const result = await request(tx)
    .input("threadId", sql.Int, input.threadId)
    .input("senderUserId", sql.Int, input.senderUserId)
    .input("body", sql.NVarChar(sql.MAX), input.body)
    .query(`
      INSERT INTO dbo.messages (thread_id, sender_user_id, body)
      OUTPUT INSERTED.*
      VALUES (@threadId, @senderUserId, @body)
    `);
  await request(tx)
    .input("threadId", sql.Int, input.threadId)
    .query(`UPDATE dbo.message_threads SET updated_at = SYSDATETIMEOFFSET() WHERE id = @threadId`);
  return mapMessage(result.recordset[0] as Record<string, unknown>);
}

export async function findThreadById(id: number): Promise<MessageThreadRow | undefined> {
  await getPool();
  const result = await request().input("id", sql.Int, id).query(`SELECT * FROM dbo.message_threads WHERE id = @id`);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapMessageThread(row) : undefined;
}

export async function findParticipant(
  threadId: number,
  userId: number,
): Promise<MessageParticipantRow | undefined> {
  await getPool();
  const result = await request()
    .input("threadId", sql.Int, threadId)
    .input("userId", sql.Int, userId)
    .query(`SELECT * FROM dbo.message_participants WHERE thread_id = @threadId AND user_id = @userId`);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapMessageParticipant(row) : undefined;
}

export async function listParticipants(threadId: number): Promise<MessageParticipantRow[]> {
  await getPool();
  const result = await request()
    .input("threadId", sql.Int, threadId)
    .query(`SELECT * FROM dbo.message_participants WHERE thread_id = @threadId`);
  return (result.recordset as Record<string, unknown>[]).map(mapMessageParticipant);
}

export async function listThreadsForUser(
  userId: number,
  opts: { page?: number; limit?: number } = {},
): Promise<{
  data: Array<
    MessageThreadRow & {
      unreadCount: number;
      lastMessagePreview: string | null;
      lastMessageAt: Date | null;
    }
  >;
  total: number;
}> {
  await getPool();
  const page = opts.page ?? 1;
  const limit = Math.min(opts.limit ?? 20, 50);
  const offset = (page - 1) * limit;

  const countResult = await request()
    .input("userId", sql.Int, userId)
    .query(`
      SELECT COUNT(*) AS total
      FROM dbo.message_threads t
      INNER JOIN dbo.message_participants p ON p.thread_id = t.id
      WHERE p.user_id = @userId
    `);
  const total = Number((countResult.recordset[0] as { total: number }).total ?? 0);

  const result = await request()
    .input("userId", sql.Int, userId)
    .input("offset", sql.Int, offset)
    .input("limit", sql.Int, limit)
    .query(`
      SELECT
        t.*,
        (
          SELECT COUNT(*)
          FROM dbo.messages m
          WHERE m.thread_id = t.id
            AND m.is_deleted = 0
            AND m.sender_user_id <> @userId
            AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)
        ) AS unread_count,
        (
          SELECT TOP 1 CASE WHEN m2.is_deleted = 1 THEN N'Message deleted' ELSE LEFT(m2.body, 160) END
          FROM dbo.messages m2
          WHERE m2.thread_id = t.id
          ORDER BY m2.created_at DESC
        ) AS last_preview,
        (
          SELECT TOP 1 m3.created_at
          FROM dbo.messages m3
          WHERE m3.thread_id = t.id
          ORDER BY m3.created_at DESC
        ) AS last_message_at
      FROM dbo.message_threads t
      INNER JOIN dbo.message_participants p ON p.thread_id = t.id AND p.user_id = @userId
      ORDER BY t.updated_at DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

  return {
    data: (result.recordset as Record<string, unknown>[]).map((row) => ({
      ...mapMessageThread(row),
      unreadCount: Number(row.unread_count ?? 0),
      lastMessagePreview: row.last_preview == null ? null : String(row.last_preview),
      lastMessageAt: row.last_message_at ? new Date(String(row.last_message_at)) : null,
    })),
    total,
  };
}

export async function listMessages(
  threadId: number,
  opts: { page?: number; limit?: number } = {},
): Promise<{ data: MessageRow[]; total: number }> {
  await getPool();
  const page = opts.page ?? 1;
  const limit = Math.min(opts.limit ?? 50, 100);
  const offset = (page - 1) * limit;
  const countResult = await request()
    .input("threadId", sql.Int, threadId)
    .query(`SELECT COUNT(*) AS total FROM dbo.messages WHERE thread_id = @threadId`);
  const total = Number((countResult.recordset[0] as { total: number }).total ?? 0);
  const result = await request()
    .input("threadId", sql.Int, threadId)
    .input("offset", sql.Int, offset)
    .input("limit", sql.Int, limit)
    .query(`
      SELECT * FROM dbo.messages
      WHERE thread_id = @threadId
      ORDER BY created_at ASC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);
  return {
    data: (result.recordset as Record<string, unknown>[]).map(mapMessage),
    total,
  };
}

export async function markThreadRead(threadId: number, userId: number): Promise<void> {
  await getPool();
  await request()
    .input("threadId", sql.Int, threadId)
    .input("userId", sql.Int, userId)
    .query(`
      UPDATE dbo.message_participants
      SET last_read_at = SYSDATETIMEOFFSET()
      WHERE thread_id = @threadId AND user_id = @userId
    `);
}

/** Hard-delete one thread. Participants and messages cascade from the foreign keys. */
export async function deleteThread(threadId: number, tx?: Transaction): Promise<boolean> {
  if (!tx) await getPool();
  const result = await request(tx)
    .input("threadId", sql.Int, threadId)
    .query(`
      DELETE FROM dbo.message_threads
      OUTPUT DELETED.id
      WHERE id = @threadId
    `);
  return result.recordset.length > 0;
}

export async function closeThread(threadId: number): Promise<MessageThreadRow | undefined> {
  await getPool();
  const result = await request()
    .input("threadId", sql.Int, threadId)
    .query(`
      UPDATE dbo.message_threads
      SET is_closed = 1, updated_at = SYSDATETIMEOFFSET()
      OUTPUT INSERTED.*
      WHERE id = @threadId
    `);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapMessageThread(row) : undefined;
}

export async function countUnreadThreads(userId: number): Promise<number> {
  await getPool();
  const result = await request()
    .input("userId", sql.Int, userId)
    .query(`
      SELECT COUNT(*) AS total
      FROM dbo.message_threads t
      INNER JOIN dbo.message_participants p ON p.thread_id = t.id
      WHERE p.user_id = @userId
        AND EXISTS (
          SELECT 1 FROM dbo.messages m
          WHERE m.thread_id = t.id
            AND m.is_deleted = 0
            AND m.sender_user_id <> @userId
            AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)
        )
    `);
  return Number((result.recordset[0] as { total: number }).total ?? 0);
}
