import { auditLogsRepo, type AuditAction, type DbTransaction } from "@workspace/db";
import type { Request, Response } from "express";
import { logger } from "./logger";
import { clientIp } from "./errors";

interface LogAuditParams {
  action: AuditAction;
  req: Request;
  userId?: number | null;
  userName?: string | null;
  patientHisId?: string | null;
  resultId?: number | null;
  details?: string | null;
}

export async function logAudit(params: LogAuditParams, tx?: DbTransaction): Promise<void> {
  try {
    await auditLogsRepo.insertAuditLog(
      {
        action: params.action,
        userId: params.userId ?? null,
        userName: params.userName ?? null,
        patientHisId: params.patientHisId ?? null,
        resultId: params.resultId ?? null,
        ipAddress: clientIp(params.req),
        details: params.details ?? null,
      },
      tx,
    );
  } catch (err) {
    logger.error({ err, action: params.action }, "Audit log write failed");
    throw err;
  }
}

export async function logAuditBestEffort(params: LogAuditParams): Promise<void> {
  try {
    await logAudit(params);
  } catch {
    logger.error({ action: params.action }, "Audit log write failed; primary operation already completed");
  }
}

export type DenyAccessOptions = {
  /** Client-facing error message (no secrets). */
  error?: string;
  /** Safe audit description (no secrets). */
  details: string;
  patientHisId?: string | null;
  resultId?: number | null;
  userId?: number | null;
  userName?: string | null;
  status?: number;
};

/**
 * Authenticated authorization failure: write access_denied (best-effort) then 403.
 * Does not throw if audit insert fails.
 */
export async function denyAccess(
  req: Request,
  res: Response,
  opts: DenyAccessOptions,
): Promise<void> {
  if (res.headersSent) return;

  const userId = opts.userId ?? req.user?.userId ?? null;
  const userName = opts.userName ?? req.user?.username ?? null;
  const method = req.method;
  const path = req.originalUrl?.split("?")[0] ?? req.path;
  const detailBase = opts.details.trim();
  const details = `${detailBase} [${method} ${path}]`.slice(0, 500);

  await logAuditBestEffort({
    action: "access_denied",
    req,
    userId,
    userName,
    patientHisId: opts.patientHisId ?? null,
    resultId: opts.resultId ?? null,
    details,
  });

  res.status(opts.status ?? 403).json({
    error: opts.error ?? "You don't have permission to perform this action.",
  });
}
