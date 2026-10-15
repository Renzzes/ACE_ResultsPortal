import { createHash, randomBytes } from "node:crypto";
import {
  authSessionsRepo,
  patientsRepo,
  patientSupportRequestsRepo,
  usersRepo,
  PORTAL_USER_ROLE,
  type PatientSupportRequest,
  type SupportRequestCategory,
  type SupportRequestStatus,
} from "@workspace/db";
import { comparePassword, hashPassword, maskEmail } from "./auth";
import { sendPortalEmail, isPortalEmailConfigured } from "./portal-email";
import { isValidPortalPassword, PORTAL_PASSWORD_REQUIREMENTS_MSG } from "./portal-password-policy";
import { issueAccessCodeAndEmail } from "./access-code-email";

export const SUPPORT_ACK_MESSAGE =
  "If your request can be verified, the appropriate support team will process it using the contact information associated with your account.";

export const SUPPORT_SCHEMA_MESSAGE =
  "Patient support requests schema is not installed. Run docs/migration/sql/016_patient_support_and_must_change_password.sql against ACE_ResultsPortal.";

const CATEGORIES = new Set<SupportRequestCategory>(["temporary_password", "diagnostic_access_code"]);

export function tempPasswordTtlHours(): number {
  const raw = Number(process.env.TEMP_PASSWORD_TTL_HOURS ?? "24");
  if (!Number.isFinite(raw) || raw < 1 || raw > 168) return 24;
  return Math.floor(raw);
}

export function generateTemporaryPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$%&*";
  const all = upper + lower + digits + special;
  const pick = (alphabet: string) => alphabet[randomBytes(1)[0]! % alphabet.length]!;
  const chars = [pick(upper), pick(lower), pick(digits), pick(special)];
  for (let i = 0; i < 12; i++) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0]! % (i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

export function hashRequesterIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return createHash("sha256").update(ip.trim().toLowerCase(), "utf8").digest("hex").slice(0, 64);
}

export function parseSupportRequestBody(body: unknown):
  | { ok: true; category: SupportRequestCategory; patientHisId: string; lastName: string; contactEmail: string | null; details: string | null }
  | { ok: false; error: string } {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const categoryRaw = typeof record.category === "string" ? record.category.trim() : "";
  if (!CATEGORIES.has(categoryRaw as SupportRequestCategory)) {
    return { ok: false, error: "Select a valid request category." };
  }
  const patientHisId = typeof record.patientHisId === "string" ? record.patientHisId.trim() : "";
  const lastName = typeof record.lastName === "string" ? record.lastName.trim() : "";
  const contactEmailRaw = typeof record.contactEmail === "string" ? record.contactEmail.trim() : "";
  const detailsRaw = typeof record.details === "string" ? record.details.trim() : "";

  if (!patientHisId || patientHisId.length > 64) {
    return { ok: false, error: "Hospital Patient ID is required." };
  }
  if (!lastName || lastName.length > 100) {
    return { ok: false, error: "Last name is required." };
  }
  if (contactEmailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmailRaw)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (detailsRaw.length > 1000) {
    return { ok: false, error: "Details are too long." };
  }
  // Reject password-like fields if a client tries to send them.
  if (typeof record.password === "string" || typeof record.accessCode === "string") {
    return { ok: false, error: "Invalid request." };
  }

  return {
    ok: true,
    category: categoryRaw as SupportRequestCategory,
    patientHisId,
    lastName,
    contactEmail: contactEmailRaw || null,
    details: detailsRaw || null,
  };
}

export function formatSupportRequest(row: PatientSupportRequest) {
  return {
    id: row.id,
    category: row.category,
    patientHisId: row.patientHisId,
    lastName: row.lastName,
    contactEmail: row.contactEmail,
    details: row.details,
    status: row.status,
    matchedPatientId: row.matchedPatientId,
    processedById: row.processedById,
    processedAt: row.processedAt ? row.processedAt.toISOString() : null,
    adminNotes: row.adminNotes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function assertSupportRateLimits(input: {
  patientHisId: string;
  ipHash: string | null;
}): Promise<{ ok: true } | { ok: false; status: 429; error: string }> {
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const byHis = await patientSupportRequestsRepo.countRecentByHisId(input.patientHisId, since);
  if (byHis >= 3) {
    return { ok: false, status: 429, error: "Too many requests. Please wait before submitting again." };
  }
  if (input.ipHash) {
    const byIp = await patientSupportRequestsRepo.countRecentByIpHash(input.ipHash, since);
    if (byIp >= 8) {
      return { ok: false, status: 429, error: "Too many requests. Please wait before submitting again." };
    }
  }
  return { ok: true };
}

export async function issueTemporaryPortalPassword(input: {
  patientId: number;
  adminUserId: number;
}): Promise<
  | {
      ok: true;
      temporaryPassword: string;
      emailAccepted: boolean;
      emailedToMasked: string | null;
      portalUserId: number;
    }
  | { ok: false; status: number; error: string }
> {
  const patient = await patientsRepo.findPatientById(input.patientId);
  if (!patient) return { ok: false, status: 404, error: "Patient not found." };
  if (patient.portalUserId == null) {
    return { ok: false, status: 400, error: "This hospital patient has no Patient Portal account." };
  }

  const portalUser = await usersRepo.findUserById(patient.portalUserId);
  if (!portalUser || portalUser.role !== PORTAL_USER_ROLE) {
    return { ok: false, status: 400, error: "Linked Patient Portal account was not found." };
  }
  if (!portalUser.isActive) {
    return { ok: false, status: 409, error: "Portal account is inactive. Reactivate the account before issuing a temporary password." };
  }
  const email = (portalUser.email ?? patient.email ?? "").trim();
  if (!email) {
    return { ok: false, status: 400, error: "No verified email is associated with this portal account." };
  }
  if (!isPortalEmailConfigured()) {
    return { ok: false, status: 503, error: "Email delivery is not configured." };
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const expiresAt = new Date(Date.now() + tempPasswordTtlHours() * 60 * 60 * 1000);

  await usersRepo.setUserPassword(portalUser.id, passwordHash, true, {
    mustChangePassword: true,
    passwordExpiresAt: expiresAt,
  });
  await authSessionsRepo.revokeAllForUser(portalUser.id);

  const emailAccepted = await sendPortalEmail(
    email,
    "ACE Medical Center Cebu — Temporary Patient Portal password",
    [
      "A temporary Patient Portal password was issued for your account.",
      "",
      `Temporary password: ${temporaryPassword}`,
      "",
      `This password expires in ${tempPasswordTtlHours()} hour(s).`,
      "Sign in with your Hospital Patient ID, last name, and this temporary password.",
      "You must set a new password immediately after signing in.",
      "",
      "If you did not request this, contact ACE Medical Center Cebu Medical Records.",
    ].join("\n"),
  );

  return {
    ok: true,
    temporaryPassword,
    emailAccepted,
    emailedToMasked: maskEmail(email),
    portalUserId: portalUser.id,
  };
}

export async function issueDiagnosticAccessCodeForSupport(input: {
  patientId: number;
}): Promise<
  | {
      ok: true;
      accessCode: string;
      emailAccepted: true;
      emailedToMasked: string | null;
      credentialIssued: true;
    }
  | {
      ok: false;
      status: number;
      error: string;
      credentialIssued: false;
      emailAccepted: boolean;
      activationUncertain?: boolean;
      deliveryUncertain?: boolean;
    }
> {
  const patient = await patientsRepo.findPatientById(input.patientId);
  if (!patient) return { ok: false, status: 404, error: "Patient not found.", credentialIssued: false, emailAccepted: false };
  const email = (patient.email ?? "").trim();
  if (!email) {
    return {
      ok: false,
      status: 400,
      error: "No email is associated with this hospital patient record.",
      credentialIssued: false,
      emailAccepted: false,
    };
  }

  const issued = await issueAccessCodeAndEmail({ patient, email });
  if (!issued.ok) {
    return {
      ok: false,
      status: issued.status,
      error: issued.error,
      credentialIssued: false,
      emailAccepted: issued.emailAccepted,
      ...("activationUncertain" in issued ? { activationUncertain: true } : {}),
      ...("deliveryUncertain" in issued && issued.deliveryUncertain ? { deliveryUncertain: true } : {}),
    };
  }

  return {
    ok: true,
    accessCode: issued.accessCode,
    emailAccepted: true,
    emailedToMasked: issued.emailedToMasked,
    credentialIssued: true,
  };
}

export async function completeForcedPasswordChange(input: {
  portalUserId: number;
  currentPassword: string;
  newPassword: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!isValidPortalPassword(input.newPassword)) {
    return { ok: false, status: 400, error: PORTAL_PASSWORD_REQUIREMENTS_MSG };
  }
  const user = await usersRepo.findUserById(input.portalUserId);
  if (!user || user.role !== PORTAL_USER_ROLE || !user.isActive) {
    return { ok: false, status: 401, error: "Invalid or expired portal session" };
  }
  if (user.passwordExpiresAt && user.passwordExpiresAt.getTime() < Date.now()) {
    return { ok: false, status: 401, error: "Temporary password has expired. Contact Support for a new one." };
  }
  const valid = await comparePassword(input.currentPassword, user.passwordHash);
  if (!valid) {
    return { ok: false, status: 401, error: "Current password is incorrect." };
  }
  if (input.currentPassword === input.newPassword) {
    return { ok: false, status: 400, error: "Choose a new password that is different from the temporary password." };
  }
  const nextHash = await hashPassword(input.newPassword);
  await usersRepo.setUserPassword(user.id, nextHash, true, { clearForcedChange: true });
  await authSessionsRepo.revokeAllForUser(user.id);
  return { ok: true };
}

export function isForcedPasswordChangeRequired(user: {
  mustChangePassword: boolean;
  passwordExpiresAt: Date | null;
}): boolean {
  return user.mustChangePassword === true;
}

export function isTemporaryPasswordExpired(user: {
  passwordExpiresAt: Date | null;
}): boolean {
  return user.passwordExpiresAt != null && user.passwordExpiresAt.getTime() < Date.now();
}

export function parseSupportStatus(value: unknown): SupportRequestStatus | undefined {
  if (value === "pending" || value === "processing" || value === "completed" || value === "rejected") {
    return value;
  }
  return undefined;
}
