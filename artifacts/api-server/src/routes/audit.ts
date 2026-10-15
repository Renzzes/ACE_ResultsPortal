import { Router } from "express";
import { auditLogsRepo } from "@workspace/db";
import { ListAuditLogsQueryParams } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { denyAccess } from "../lib/audit";
import { canViewAuditLogs } from "../lib/rbac";

const router = Router();

router.get("/audit-logs", requireAuth, async (req, res): Promise<void> => {
  if (!canViewAuditLogs(req.user!.role)) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to view audit logs",
    });
    return;
  }

  const params = ListAuditLogsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { userId, patientId, action, dateFrom, dateTo, page = 1, limit = 50 } = params.data;
  const result = await auditLogsRepo.listAuditLogs({
    userId,
    patientHisId: patientId,
    action,
    dateFrom: dateFrom ? new Date(dateFrom) : undefined,
    dateTo: dateTo ? new Date(dateTo) : undefined,
    page,
    limit,
  });

  res.json({
    data: result.data.map((l) => ({
      id: l.id,
      action: l.action,
      userId: l.userId ?? null,
      userName: l.userName ?? null,
      patientHisId: l.patientHisId ?? null,
      resultId: l.resultId ?? null,
      ipAddress: l.ipAddress,
      details: l.details ?? null,
      createdAt: l.createdAt.toISOString(),
    })),
    total: result.total,
    page,
    limit,
  });
});

export default router;
