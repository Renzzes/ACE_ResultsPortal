import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/auth";

export interface AuthUser {
  userId: number;
  username: string;
  role: string;
}

export interface PortalUser {
  patientId: number;
  patientHisId: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      portalUser?: PortalUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
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

  req.user = {
    userId: payload["userId"] as number,
    username: payload["username"] as string,
    role: payload["role"] as string,
  };

  next();
}

export function requirePortalAuth(req: Request, res: Response, next: NextFunction): void {
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

  req.portalUser = {
    patientId: payload["patientId"] as number,
    patientHisId: payload["patientHisId"] as string,
  };

  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}
