import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";

const JWT_SECRET = process.env.JWT_SECRET ?? process.env.SESSION_SECRET ?? "ace-medical-secret-change-in-prod";
const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY = "7d";
const PORTAL_TOKEN_EXPIRY = "4h";

export interface StaffTokenPayload {
  userId: number;
  username: string;
  role: string;
  type: "access" | "refresh";
}

export interface PortalTokenPayload {
  patientId: number;
  patientHisId: string;
  type: "portal";
}

export function signAccessToken(payload: Omit<StaffTokenPayload, "type">): string {
  return jwt.sign({ ...payload, type: "access" }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

export function signRefreshToken(payload: Omit<StaffTokenPayload, "type">): string {
  return jwt.sign({ ...payload, type: "refresh" }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
}

export function signPortalToken(payload: Omit<PortalTokenPayload, "type">): string {
  return jwt.sign({ ...payload, type: "portal" }, JWT_SECRET, { expiresIn: PORTAL_TOKEN_EXPIRY });
}

export function signDownloadToken(
  resultId: number,
  forType: "staff" | "portal" | "physician",
  subjectId?: number,
): string {
  return jwt.sign({ resultId, forType, subjectId, type: "download" }, JWT_SECRET, { expiresIn: "5m" });
}

export function verifyToken(token: string): jwt.JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
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

export function generateAccessCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = (len: number) =>
    Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `ACE-${part(4)}-${part(4)}`;
}

export function generateUniqueId(): string {
  return uuidv4();
}
