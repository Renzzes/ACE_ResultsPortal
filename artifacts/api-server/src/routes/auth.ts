import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authSessionsRepo, patientsRepo, PORTAL_USER_ROLE, usersRepo } from "@workspace/db";
import {
  LoginBody,
  ChangePasswordBody,
} from "@workspace/api-zod";
import {
  signAccessToken,
  signPortalToken,
  comparePassword,
  hashPassword,
  verifyToken,
  hashRefreshToken,
  refreshSecretMatches,
  generateRefreshSecret,
  isSessionPublicId,
  parsePortalChannel,
  sessionRefreshCookieName,
  REFRESH_COOKIE_NAME,
} from "../lib/auth";
import type { Request } from "express";
import { requireAuth } from "../middlewares/auth";
import { logAudit, logAuditBestEffort } from "../lib/audit";
import { formatUser } from "../lib/formatters";
import { expireLegacyRefreshCookie, refreshCookieOptions } from "../lib/cookies";
import { issueAuthSession } from "../lib/issue-auth-session";
import {
  parseRegisterPatientBody,
  parseVerifyPatientBody,
  registerVerifiedPortalPatient,
  verifyHospitalIdentity,
} from "../lib/portal-registration";

const router = Router();

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

function routeSessionPublicId(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function sessionCookie(req: Request, publicId: string): string {
  const name = sessionRefreshCookieName(publicId);
  const value = req.cookies?.[name];
  return typeof value === "string" ? value : "";
}

function bearerPayload(req: Request): Record<string, unknown> | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const payload = verifyToken(header.slice(7));
  return payload ? (payload as Record<string, unknown>) : null;
}

/** Owner of the presented access or portal token. Does not accept another user's session id. */
async function authenticatedSessionOwnerId(req: Request): Promise<number | null> {
  const payload = bearerPayload(req);
  if (!payload) return null;
  let ownerId: number | null = null;
  if (payload["type"] === "access" && payload["role"] !== "patient") {
    const userId = Number(payload["userId"]);
    ownerId = Number.isFinite(userId) ? userId : null;
  } else if (payload["type"] === "portal") {
    const patientId = Number(payload["patientId"]);
    const patientHisId = typeof payload["patientHisId"] === "string" ? payload["patientHisId"] : "";
    if (!Number.isFinite(patientId) || !patientHisId) return null;
    const patient = await patientsRepo.findPatientById(patientId);
    if (!patient || patient.patientHisId !== patientHisId || patient.portalUserId == null) return null;
    ownerId = patient.portalUserId;
  }
  if (ownerId == null) return null;
  if (typeof payload["sid"] === "string") {
    if (!isSessionPublicId(payload["sid"])) return null;
    const current = await authSessionsRepo.findUsableByPublicId(payload["sid"]);
    if (!current || current.userId !== ownerId) return null;
  }
  return ownerId;
}

async function signRotatedAccessToken(session: {
  userId: number;
  publicId: string | null;
  portal: string | null;
}): Promise<string | null> {
  if (!session.publicId || !session.portal) return null;
  const user = await usersRepo.findUserById(session.userId);
  if (!user || !user.isActive) return null;
  if (session.portal === "patient") {
    if (user.role !== PORTAL_USER_ROLE) return null;
    const patient = await patientsRepo.findPatientByPortalUserId(user.id);
    if (!patient) return null;
    return signPortalToken({
      patientId: patient.id,
      patientHisId: patient.patientHisId,
      sid: session.publicId,
    });
  }
  if (user.role === PORTAL_USER_ROLE) return null;
  return signAccessToken({
    userId: user.id,
    username: user.username,
    role: user.role,
    sid: session.publicId,
  });
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again later.", reason: "RATE_LIMITED" },
});

const patientVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again later.", reason: "RATE_LIMITED" },
});

const HOSPITAL_UNAVAILABLE_MESSAGE =
  "We're temporarily unable to verify your information. Please try again later or contact ACE Medical Center Cebu.";

router.post("/auth/login", authLimiter, async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const portal = parsePortalChannel(req.body?.portal);
  if (!portal) {
    res.status(400).json({ error: "A valid portal channel is required" });
    return;
  }

  const { username, password } = parsed.data;
  const user = await usersRepo.findUserByUsername(username);

  if (!user || !user.isActive || user.role === PORTAL_USER_ROLE) {
    await logAuditBestEffort({ action: "access_denied", req, details: "Failed staff login" });
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    res.status(403).json({ error: `Account locked until ${user.lockedUntil.toISOString()}. Try again later.` });
    return;
  }

  const valid = await comparePassword(password, user.passwordHash);

  if (!valid) {
    const attempts = (user.failedLoginAttempts ?? 0) + 1;
    const lockedUntil =
      attempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null;
    await usersRepo.recordFailedLogin(user.id, attempts, lockedUntil);
    await logAuditBestEffort({
      action: "access_denied",
      req,
      userId: user.id,
      userName: user.username,
      details: `Failed login attempt ${attempts}`,
    });
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  await usersRepo.recordSuccessfulLogin(user.id);

  const issued = await issueAuthSession({ userId: user.id, portal });
  const accessToken = signAccessToken({
    userId: user.id,
    username: user.username,
    role: user.role,
    sid: issued.publicId,
  });

  await logAudit({
    action: "login",
    req,
    userId: user.id,
    userName: user.username,
    details: `portal=${portal}`,
  });

  expireLegacyRefreshCookie(res, req.cookies?.[REFRESH_COOKIE_NAME]);
  res.cookie(sessionRefreshCookieName(issued.publicId), issued.refreshSecret, refreshCookieOptions());
  res.json({
    accessToken,
    sessionPublicId: issued.publicId,
    user: formatUser(user),
  });
});

router.post("/auth/verify-patient", patientVerifyLimiter, async (req, res): Promise<void> => {
  const parsed = parseVerifyPatientBody(req.body);
  if (!parsed) {
    res.status(400).json({ verified: false, reason: "VALIDATION_ERROR", error: "Invalid information." });
    return;
  }

  const result = await verifyHospitalIdentity(parsed);
  if (!result.ok) {
    await logAuditBestEffort({
      action: "access_denied",
      req,
      details: `patient_verification_failed:${result.reason}`,
    });
    if (result.reason === "HOSPITAL_DATABASE_UNAVAILABLE") {
      res.status(503).json({
        verified: false,
        reason: result.reason,
        error: HOSPITAL_UNAVAILABLE_MESSAGE,
      });
      return;
    }
    res.status(200).json({ verified: false, reason: result.reason });
    return;
  }

  await logAuditBestEffort({
    action: "view",
    req,
    patientHisId: result.patid,
    details: "patient_verification_succeeded",
  });
  res.json({ verified: true });
});

router.post("/auth/register-patient", patientVerifyLimiter, async (req, res): Promise<void> => {
  const parsed = parseRegisterPatientBody(req.body);
  if (!parsed) {
    res.status(400).json({ created: false, reason: "VALIDATION_ERROR", error: "Invalid information." });
    return;
  }

  const result = await registerVerifiedPortalPatient({
    ...parsed,
    email: parsed.email,
    username: parsed.username,
    password: parsed.password,
  });

  if (!result.ok) {
    await logAuditBestEffort({
      action: "access_denied",
      req,
      details: `portal_account_create_failed:${result.reason}`,
    });
    if (result.reason === "HOSPITAL_DATABASE_UNAVAILABLE") {
      res.status(503).json({
        created: false,
        reason: result.reason,
        error: HOSPITAL_UNAVAILABLE_MESSAGE,
      });
      return;
    }
    if (result.reason === "DATABASE_UNAVAILABLE") {
      res.status(503).json({
        created: false,
        reason: result.reason,
        error: HOSPITAL_UNAVAILABLE_MESSAGE,
      });
      return;
    }
    if (result.reason === "USERNAME_TAKEN" || result.reason === "EMAIL_TAKEN") {
      res.status(409).json({
        created: false,
        reason: result.reason,
        error: "That username or email is not available.",
      });
      return;
    }
    if (result.reason === "PORTAL_ACCOUNT_EXISTS") {
      res.status(409).json({
        created: false,
        reason: result.reason,
        error: "An account already exists. Please log in.",
      });
      return;
    }
    res.status(200).json({ created: false, verified: false, reason: result.reason });
    return;
  }

  await logAuditBestEffort({
    action: "edit",
    req,
    patientHisId: result.patient.patientHisId,
    details: "portal_account_created",
  });
  res.status(201).json({ created: true, verified: true });
});

router.post("/auth/session/:sessionPublicId/logout", async (req, res): Promise<void> => {
  const publicId = routeSessionPublicId(req.params.sessionPublicId);
  if (!isSessionPublicId(publicId)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const ownerId = await authenticatedSessionOwnerId(req);
  if (ownerId == null) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const session = await authSessionsRepo.findByPublicId(publicId);
  if (!session || session.userId !== ownerId || session.portal == null) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  await authSessionsRepo.revokeByPublicId(publicId, ownerId);
  res.clearCookie(sessionRefreshCookieName(publicId), { ...refreshCookieOptions(), maxAge: 0 });
  await logAudit({
    action: "logout",
    req,
    userId: ownerId,
    details: `session_logout portal=${session.portal}`,
  });
  res.json({ message: "Logged out successfully" });
});

router.post("/auth/session/:sessionPublicId/refresh", authLimiter, async (req, res): Promise<void> => {
  const publicId = routeSessionPublicId(req.params.sessionPublicId);
  if (!isSessionPublicId(publicId)) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }

  const secret = sessionCookie(req, publicId);
  const session = await authSessionsRepo.findByPublicId(publicId);
  if (
    !secret ||
    !session ||
    session.portal == null ||
    session.revokedAt ||
    session.expiresAt.getTime() <= Date.now() ||
    !refreshSecretMatches(secret, session.refreshTokenHash)
  ) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }

  const account = await usersRepo.findUserById(session.userId);
  if (!account || !account.isActive) {
    await authSessionsRepo.revokeByPublicId(publicId, session.userId);
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }

  const nextSecret = generateRefreshSecret();
  const rotated = await authSessionsRepo.rotateRefreshSecret({
    publicId,
    currentHash: session.refreshTokenHash,
    nextHash: hashRefreshToken(nextSecret),
  });
  if (!rotated || rotated.publicId !== publicId) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }

  const accessToken = await signRotatedAccessToken(rotated);
  if (!accessToken) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }

  res.cookie(sessionRefreshCookieName(publicId), nextSecret, refreshCookieOptions());
  res.json({ accessToken, sessionPublicId: publicId });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const user = await usersRepo.findUserById(req.user!.userId);
  if (!user || !user.isActive) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  res.json(formatUser(user));
});

router.post("/auth/change-password", requireAuth, async (req, res): Promise<void> => {
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const user = await usersRepo.findUserById(req.user!.userId);
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  const valid = await comparePassword(parsed.data.currentPassword, user.passwordHash);
  if (!valid) {
    res.status(400).json({ error: "Current password is incorrect" });
    return;
  }

  const newHash = await hashPassword(parsed.data.newPassword);
  await usersRepo.setUserPassword(user.id, newHash, false);
  await logAudit({ action: "edit", req, userId: user.id, userName: user.username, details: "Changed password" });
  res.json({ message: "Password changed successfully" });
});

export default router;
