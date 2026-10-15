import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const ACCESS_TOKEN_EXPIRY = "15m";
const PORTAL_TOKEN_EXPIRY = "4h";
const REGISTRATION_TOKEN_EXPIRY = "15m";
const RECOVERY_TOKEN_EXPIRY = "15m";
const STAFF_PATIENT_REUSE_EXPIRY = "15m";
const DOWNLOAD_TOKEN_EXPIRY = "5m";
const MIN_SECRET_LENGTH = 32;

let cachedSecret: string | null = null;

export function getJwtSecret(): string {
  if (cachedSecret) return cachedSecret;
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim().length < MIN_SECRET_LENGTH) {
    throw new Error(
      "JWT_SECRET is required and must be at least 32 characters. The application will not start without it.",
    );
  }
  cachedSecret = secret;
  return cachedSecret;
}

export interface StaffTokenPayload {
  userId: number;
  username: string;
  role: string;
  type: "access" | "refresh";
  /** Public auth_sessions id. Present on sessions created in H.5.2 and later. */
  sid?: string;
}

export interface PortalTokenPayload {
  patientId: number;
  patientHisId: string;
  type: "portal";
  /** Public auth_sessions id. Present on patient sessions created in H.5.2 and later. */
  sid?: string;
}

export interface RegistrationTokenPayload {
  patientHisId: string;
  type: "registration";
}

export interface RecoveryTokenPayload {
  patientId: number;
  otpHash: string;
  jti: string;
  type: "recovery";
}

export interface DownloadTokenPayload {
  resultId: number;
  forType: "staff" | "portal" | "physician";
  subjectId: number;
  type: "download";
}

/** Binds a staff "use existing patient" action to the hospital id from lookup. */
export interface StaffPatientReuseTokenPayload {
  patientHisId: string;
  staffUserId: number;
  departmentId: number | null;
  type: "staff_patient_reuse";
}

export function signAccessToken(payload: Omit<StaffTokenPayload, "type">): string {
  const claims: Record<string, unknown> = {
    userId: payload.userId,
    username: payload.username,
    role: payload.role,
    type: "access",
  };
  if (payload.sid) claims.sid = payload.sid;
  return jwt.sign(claims, getJwtSecret(), { expiresIn: ACCESS_TOKEN_EXPIRY });
}

export function signPortalToken(payload: Omit<PortalTokenPayload, "type">): string {
  const claims: Record<string, unknown> = {
    patientId: payload.patientId,
    patientHisId: payload.patientHisId,
    type: "portal",
  };
  if (payload.sid) claims.sid = payload.sid;
  return jwt.sign(claims, getJwtSecret(), { expiresIn: PORTAL_TOKEN_EXPIRY });
}

export function signRegistrationToken(payload: Omit<RegistrationTokenPayload, "type">): string {
  return jwt.sign({ ...payload, type: "registration" }, getJwtSecret(), {
    expiresIn: REGISTRATION_TOKEN_EXPIRY,
  });
}

export function verifyRegistrationToken(token: string): RegistrationTokenPayload | null {
  const payload = verifyToken(token);
  if (!payload || payload["type"] !== "registration") return null;
  const patientHisId = payload["patientHisId"];
  if (typeof patientHisId !== "string" || !patientHisId.trim()) return null;
  return { patientHisId, type: "registration" };
}

export function signRecoveryToken(payload: Omit<RecoveryTokenPayload, "type">): string {
  return jwt.sign({ ...payload, type: "recovery" }, getJwtSecret(), { expiresIn: RECOVERY_TOKEN_EXPIRY });
}

export function verifyRecoveryToken(token: string): RecoveryTokenPayload | null {
  const payload = verifyToken(token);
  if (!payload || payload["type"] !== "recovery") return null;
  const patientId = Number(payload["patientId"]);
  const otpHash = payload["otpHash"];
  const jti = payload["jti"];
  if (!Number.isFinite(patientId) || typeof otpHash !== "string" || !otpHash) return null;
  if (typeof jti !== "string" || !jti.trim()) return null;
  return { patientId, otpHash, jti, type: "recovery" };
}

/** Unbiased cryptographically secure 6-digit OTP (leading zeros allowed). */
export function generateOtp(): string {
  const max = 1_000_000;
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  let value = 0;
  do {
    value = randomBytes(4).readUInt32BE(0);
  } while (value >= limit);
  return (value % max).toString().padStart(6, "0");
}

export function createRecoveryJti(): string {
  return randomBytes(16).toString("hex");
}

export const RECOVERY_TOKEN_TTL_MS = 15 * 60 * 1000;

export function hashOtp(otp: string): string {
  return createHash("sha256").update(otp, "utf8").digest("hex");
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  const visible = local.slice(0, 1);
  return `${visible}***@${domain}`;
}

export function signDownloadToken(payload: Omit<DownloadTokenPayload, "type">): string {
  return jwt.sign({ ...payload, type: "download" }, getJwtSecret(), { expiresIn: DOWNLOAD_TOKEN_EXPIRY });
}

export function signStaffPatientReuseToken(
  payload: Omit<StaffPatientReuseTokenPayload, "type">,
): string {
  return jwt.sign({ ...payload, type: "staff_patient_reuse" }, getJwtSecret(), {
    expiresIn: STAFF_PATIENT_REUSE_EXPIRY,
  });
}

export function verifyStaffPatientReuseToken(token: string): StaffPatientReuseTokenPayload | null {
  const payload = verifyToken(token);
  if (!payload || payload["type"] !== "staff_patient_reuse") return null;
  const patientHisId = payload["patientHisId"];
  const staffUserId = Number(payload["staffUserId"]);
  const rawDepartment = payload["departmentId"];
  const departmentId = rawDepartment == null ? null : Number(rawDepartment);
  if (typeof patientHisId !== "string" || !patientHisId.trim()) return null;
  if (!Number.isFinite(staffUserId) || staffUserId <= 0) return null;
  if (departmentId !== null && (!Number.isFinite(departmentId) || departmentId <= 0)) return null;
  return {
    patientHisId: patientHisId.trim(),
    staffUserId,
    departmentId,
    type: "staff_patient_reuse",
  };
}

export function verifyToken(token: string): jwt.JwtPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as jwt.JwtPayload;
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function hashAccessCode(code: string): Promise<string> {
  return bcrypt.hash(code, 12);
}

export async function compareAccessCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}

export function generateAccessCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = (len: number) => {
    const bytes = randomBytes(len);
    return Array.from({ length: len }, (_, i) => chars[bytes[i]! % chars.length]!).join("");
  };
  return `ACE-${part(4)}-${part(4)}`;
}

export const REFRESH_COOKIE_NAME = "ace_refresh_token";
export const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Login channel stored on auth_sessions.portal. This is not an authorization role. */
export const PORTAL_CHANNELS = ["admin", "staff", "doctor", "patient"] as const;
export type PortalChannel = (typeof PORTAL_CHANNELS)[number];

const SESSION_PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function parsePortalChannel(value: unknown): PortalChannel | null {
  if (typeof value !== "string") return null;
  const channel = value.trim();
  return (PORTAL_CHANNELS as readonly string[]).includes(channel) ? (channel as PortalChannel) : null;
}

/** 16 random bytes, base64url, exactly 22 characters. Not the refresh secret. */
export function generateSessionPublicId(): string {
  return randomBytes(16).toString("base64url");
}

export function isSessionPublicId(value: string): boolean {
  return SESSION_PUBLIC_ID_PATTERN.test(value);
}

/** Opaque refresh secret. Stored only as a SHA-256 hash. */
export function generateRefreshSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function sessionRefreshCookieName(publicId: string): string {
  return `ace_rt_${publicId}`;
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function refreshSecretMatches(secret: string, storedHash: string): boolean {
  const presented = Buffer.from(hashRefreshToken(secret), "utf8");
  const stored = Buffer.from(storedHash.trim(), "utf8");
  if (presented.length !== stored.length) return false;
  return timingSafeEqual(presented, stored);
}

export function getRefreshTokenExpiry(token: string): Date {
  const decoded = jwt.decode(token);
  if (decoded && typeof decoded === "object" && typeof decoded.exp === "number") {
    return new Date(decoded.exp * 1000);
  }
  return new Date(Date.now() + REFRESH_COOKIE_MAX_AGE_MS);
}
