import { db, auditLogsTable } from "@workspace/db";
import type { Request } from "express";

type AuditAction =
  | "login"
  | "logout"
  | "upload"
  | "edit"
  | "delete"
  | "view"
  | "download"
  | "access_denied"
  | "access_code_regen";

interface LogAuditParams {
  action: AuditAction;
  req: Request;
  userId?: number | null;
  userName?: string | null;
  patientHisId?: string | null;
  resultId?: number | null;
  details?: string | null;
}

export async function logAudit(params: LogAuditParams): Promise<void> {
  const ip =
    (req: Request) =>
      String(req.headers["x-forwarded-for"] ?? req.socket?.remoteAddress ?? "unknown");

  try {
    await db.insert(auditLogsTable).values({
      action: params.action,
      userId: params.userId ?? null,
      userName: params.userName ?? null,
      patientHisId: params.patientHisId ?? null,
      resultId: params.resultId ?? null,
      ipAddress: ip(params.req),
      details: params.details ?? null,
    });
  } catch {
    // Never let audit log failures break the main flow
  }
}
