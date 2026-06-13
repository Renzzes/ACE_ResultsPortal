import { Router } from "express";
import { sql, and, gte, lte, eq, desc } from "drizzle-orm";
import { db, auditLogsTable } from "@workspace/db";
import { ListAuditLogsQueryParams } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";

const router = Router();

router.get("/audit-logs", requireAuth, requireRole("super_admin", "medical_records"), async (req, res): Promise<void> => {
  const params = ListAuditLogsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { userId, patientId, action, dateFrom, dateTo, page = 1, limit = 50 } = params.data;

  const conditions = [];
  if (userId) conditions.push(eq(auditLogsTable.userId, userId));
  if (patientId) conditions.push(eq(auditLogsTable.patientHisId, patientId));
  if (action) conditions.push(eq(auditLogsTable.action, action as typeof auditLogsTable.$inferSelect["action"]));
  if (dateFrom) conditions.push(gte(auditLogsTable.createdAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(auditLogsTable.createdAt, new Date(dateTo)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogsTable)
    .where(where);

  const logs = await db
    .select()
    .from(auditLogsTable)
    .where(where)
    .limit(limit)
    .offset((page - 1) * limit)
    .orderBy(desc(auditLogsTable.createdAt));

  const formatted = logs.map((l) => ({
    id: l.id,
    action: l.action,
    userId: l.userId ?? null,
    userName: l.userName ?? null,
    patientHisId: l.patientHisId ?? null,
    resultId: l.resultId ?? null,
    ipAddress: l.ipAddress,
    details: l.details ?? null,
    createdAt: l.createdAt.toISOString(),
  }));

  res.json({
    data: formatted,
    total: countResult?.count ?? 0,
    page,
    limit,
  });
});

export default router;
