import type { Request, Response, NextFunction } from "express";
import { authSessionsRepo, patientsRepo, usersRepo } from "@workspace/db";
import { isAccountStatusRole } from "../lib/account-status";
import { isSessionPublicId, verifyToken } from "../lib/auth";
import { denyAccess } from "../lib/audit";
import { isForcedPasswordChangeRequired } from "../lib/patient-support";

export interface AuthUser {
  userId: number;
  username: string;
  role: string;
  /** Set only when the access token carries a validated sid. */
  sessionPublicId?: string;
}

export interface PortalUser {
  patientId: number;
  patientHisId: string;
  /** Set only when the portal token carries a validated sid. */
  sessionPublicId?: string;
  userId?: number;
  mustChangePassword?: boolean;
}

const PORTAL_FORCED_CHANGE_ALLOWLIST = new Set([
  "POST /portal/change-password",
  "POST /portal/logout",
  "GET /portal/profile",
]);

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      portalUser?: PortalUser;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = authHeader.slice(7);
  const payload = verifyToken(token);

  if (!payload || payload["type"] !== "access") {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const userId = Number(payload["userId"]);
  const sid = payload["sid"];
  let sessionPublicId: string | undefined;
  if (sid !== undefined) {
    if (typeof sid !== "string" || !isSessionPublicId(sid) || !Number.isFinite(userId)) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    try {
      const session = await authSessionsRepo.findUsableByPublicId(sid);
      if (!session || session.userId !== userId || session.portal == null) {
        res.status(401).json({ error: "Invalid or expired token" });
        return;
      }
    } catch (err) {
      next(err);
      return;
    }
    sessionPublicId = sid;
  }

  if (isAccountStatusRole(typeof payload["role"] === "string" ? payload["role"] : "")) {
    try {
      const account = Number.isFinite(userId) ? await usersRepo.findUserById(userId) : undefined;
      if (!account || !account.isActive || !isAccountStatusRole(account.role)) {
        if (sessionPublicId && Number.isFinite(userId)) {
          await authSessionsRepo.revokeByPublicId(sessionPublicId, userId);
        }
        res.status(401).json({ error: "Invalid or expired token" });
        return;
      }
    } catch (err) {
      next(err);
      return;
    }
  }

  if (payload["role"] === "patient") {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to access staff API with portal identity",
      userId: typeof payload["userId"] === "number" ? payload["userId"] : null,
      userName: typeof payload["username"] === "string" ? payload["username"] : null,
    });
    return;
  }

  req.user = {
    userId: payload["userId"] as number,
    username: payload["username"] as string,
    role: payload["role"] as string,
    ...(sessionPublicId ? { sessionPublicId } : {}),
  };

  next();
}

export async function requirePortalAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = authHeader.slice(7);
  const payload = verifyToken(token);

  if (!payload || payload["type"] !== "portal") {
    res.status(401).json({ error: "Invalid or expired portal session" });
    return;
  }

  const patientId = Number(payload["patientId"]);
  const patientHisId = typeof payload["patientHisId"] === "string" ? payload["patientHisId"] : "";
  const sid = payload["sid"];
  let sessionPublicId: string | undefined;
  let sessionUserId: number | undefined;
  if (sid !== undefined) {
    if (typeof sid !== "string" || !isSessionPublicId(sid)) {
      res.status(401).json({ error: "Invalid or expired portal session" });
      return;
    }
    try {
      const session = await authSessionsRepo.findUsableByPublicId(sid);
      if (!session || session.portal !== "patient") {
        res.status(401).json({ error: "Invalid or expired portal session" });
        return;
      }
      const patient = await patientsRepo.findPatientByPortalUserId(session.userId);
      if (!patient || patient.id !== patientId || patient.patientHisId !== patientHisId) {
        res.status(401).json({ error: "Invalid or expired portal session" });
        return;
      }
      sessionPublicId = sid;
      sessionUserId = session.userId;
    } catch (err) {
      next(err);
      return;
    }
  }

  let mustChangePassword = false;
  if (sessionUserId != null) {
    try {
      const portalAccount = await usersRepo.findUserById(sessionUserId);
      if (portalAccount && isForcedPasswordChangeRequired(portalAccount)) {
        mustChangePassword = true;
        const routeKey = `${req.method.toUpperCase()} ${req.path}`;
        const allowed =
          PORTAL_FORCED_CHANGE_ALLOWLIST.has(routeKey) ||
          req.path === "/portal/change-password" ||
          req.path === "/portal/logout" ||
          (req.method === "GET" && req.path === "/portal/profile");
        if (!allowed) {
          res.status(403).json({
            error: "Password change required",
            code: "MUST_CHANGE_PASSWORD",
          });
          return;
        }
      }
    } catch (err) {
      next(err);
      return;
    }
  }

  req.portalUser = {
    patientId,
    patientHisId,
    mustChangePassword,
    ...(sessionPublicId ? { sessionPublicId, userId: sessionUserId } : {}),
  };

  next();
}

export function requireRole(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      await denyAccess(req, res, {
        error: "Forbidden",
        details: `Unauthorized attempt: role=${req.user.role} not allowed for this endpoint`,
      });
      return;
    }
    next();
  };
}
