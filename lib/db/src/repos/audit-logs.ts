import type { Transaction } from "mssql";
import type { AuditAction, AuditLog } from "../types";
import { mapAuditLog } from "../mappers";
import { getPool, request, sql } from "../pool";

export async function insertAuditLog(
  input: {
    action: AuditAction;
    userId?: number | null;
    userName?: string | null;
    patientHisId?: string | null;
    resultId?: number | null;
    ipAddress: string;
    details?: string | null;
  },
  tx?: Transaction,
): Promise<void> {
  if (!tx) await getPool();
  await request(tx)
    .input("action", sql.NVarChar(32), input.action)
    .input("userId", sql.Int, input.userId ?? null)
    .input("userName", sql.NVarChar(200), input.userName ?? null)
    .input("patientHisId", sql.NVarChar(64), input.patientHisId ?? null)
    .input("resultId", sql.Int, input.resultId ?? null)
    .input("ipAddress", sql.NVarChar(64), input.ipAddress)
    .input("details", sql.NVarChar(sql.MAX), input.details ?? null)
    .query(
      `INSERT INTO dbo.audit_logs (action, user_id, user_name, patient_his_id, result_id, ip_address, details)
       VALUES (@action, @userId, @userName, @patientHisId, @resultId, @ipAddress, @details)`,
    );
}

export async function listAuditLogs(filters: {
  userId?: number;
  patientHisId?: string;
  action?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page: number;
  limit: number;
}): Promise<{ data: AuditLog[]; total: number }> {
  await getPool();
  const build = (req: ReturnType<typeof request>) => {
    const where: string[] = ["1 = 1"];
    if (filters.userId) {
      req.input("userId", sql.Int, filters.userId);
      where.push("user_id = @userId");
    }
    if (filters.patientHisId) {
      req.input("patientHisId", sql.NVarChar(64), filters.patientHisId);
      where.push("patient_his_id = @patientHisId");
    }
    if (filters.action) {
      req.input("action", sql.NVarChar(32), filters.action);
      where.push("action = @action");
    }
    if (filters.dateFrom) {
      req.input("dateFrom", sql.DateTimeOffset, filters.dateFrom);
      where.push("created_at >= @dateFrom");
    }
    if (filters.dateTo) {
      req.input("dateTo", sql.DateTimeOffset, filters.dateTo);
      where.push("created_at <= @dateTo");
    }
    req.input("offset", sql.Int, (filters.page - 1) * filters.limit);
    req.input("limit", sql.Int, filters.limit);
    return where.join(" AND ");
  };

  const countReq = request();
  const whereSql = build(countReq);
  const count = await countReq.query(`SELECT COUNT(*) AS total FROM dbo.audit_logs WHERE ${whereSql}`);
  const listReq = request();
  build(listReq);
  const rows = await listReq.query(
    `SELECT id, action, user_id, user_name, patient_his_id, result_id, ip_address, details, created_at
     FROM dbo.audit_logs
     WHERE ${whereSql}
     ORDER BY created_at DESC
     OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
  );
  return {
    data: (rows.recordset as Record<string, unknown>[]).map(mapAuditLog),
    total: Number((count.recordset[0] as { total: number }).total ?? 0),
  };
}

export async function countDownloads(): Promise<number> {
  await getPool();
  const result = await request().query(
    `SELECT COUNT(*) AS total FROM dbo.audit_logs WHERE action = N'download'`,
  );
  return Number((result.recordset[0] as { total: number }).total ?? 0);
}

export async function listRecentActivity(limit: number): Promise<AuditLog[]> {
  await getPool();
  const result = await request()
    .input("limit", sql.Int, limit)
    .query(`
      SELECT TOP (@limit) id, action, user_id, user_name, patient_his_id, result_id, ip_address, details, created_at
      FROM dbo.audit_logs
      ORDER BY created_at DESC
    `);
  return (result.recordset as Record<string, unknown>[]).map(mapAuditLog);
}
