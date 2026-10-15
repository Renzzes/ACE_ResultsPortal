import {
  patientsRepo,
  usersRepo,
  type Patient,
  type User,
} from "@workspace/db";
import { resolveActivePortalAccount } from "./portal-activation";

export const PORTAL_EMAIL_MAX = 255;
export const PORTAL_MOBILE_MAX = 32;

export type PortalProfileView = {
  patientHisId: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  dateOfBirth: string;
  email: string | null;
  mobileNumber: string | null;
  accountStatus: "active";
  accountEmail: string | null;
  lastLoginAt: string | null;
};

export type PortalProfileContactPatch = {
  email?: string | null;
  mobileNumber?: string | null;
};

export type PortalProfileUpdateDeps = {
  findPatientById: (id: number) => Promise<Patient | undefined>;
  findPatientByEmail: (email: string) => Promise<Patient | undefined>;
  findUserById: (id: number) => Promise<User | undefined>;
  findUserByEmail: (email: string) => Promise<User | undefined>;
  updatePatientContact: (
    id: number,
    patch: { email?: string | null; mobileNumber?: string | null },
  ) => Promise<Patient | undefined>;
  updateUserEmail: (id: number, email: string | null) => Promise<User | undefined>;
};

const defaultDeps: PortalProfileUpdateDeps = {
  findPatientById: (id) => patientsRepo.findPatientById(id),
  findPatientByEmail: (email) => patientsRepo.findPatientByEmail(email),
  findUserById: (id) => usersRepo.findUserById(id),
  findUserByEmail: (email) => usersRepo.findUserByEmail(email),
  updatePatientContact: (id, patch) => patientsRepo.updatePatient(id, patch),
  updateUserEmail: (id, email) => usersRepo.updateUser(id, { email }),
};

/**
 * Resolve activated portal patient from JWT patientId only.
 * created_by_id is never consulted.
 */
export async function resolvePortalProfilePatient(
  patientId: number,
  deps: Pick<PortalProfileUpdateDeps, "findPatientById" | "findUserById"> = {
    findPatientById: defaultDeps.findPatientById,
    findUserById: defaultDeps.findUserById,
  },
): Promise<
  | { ok: true; patient: Patient; portalUser: User }
  | { ok: false; reason: "not_found" | "inactive" }
> {
  if (!Number.isFinite(patientId) || patientId <= 0) {
    return { ok: false, reason: "not_found" };
  }
  const patient = await deps.findPatientById(patientId);
  if (!patient) return { ok: false, reason: "not_found" };
  const account = await resolveActivePortalAccount(patient, {
    findUserById: deps.findUserById,
  });
  if (!account.ok) return { ok: false, reason: "inactive" };
  return { ok: true, patient, portalUser: account.user };
}

export function formatPortalProfile(patient: Patient, portalUser: User): PortalProfileView {
  return {
    patientHisId: patient.patientHisId,
    firstName: patient.firstName,
    middleName: patient.middleName ?? null,
    lastName: patient.lastName,
    dateOfBirth: patient.dateOfBirth,
    email: patient.email ?? null,
    mobileNumber: patient.mobileNumber ?? null,
    accountStatus: "active",
    accountEmail: portalUser.email ?? patient.email ?? null,
    lastLoginAt: portalUser.lastLoginAt ? portalUser.lastLoginAt.toISOString() : null,
  };
}

export function normalizePortalEmail(raw: unknown): string | null | { error: string } {
  if (raw === undefined) return null;
  if (raw === null) return { error: "Email is required." };
  if (typeof raw !== "string") return { error: "Invalid email." };
  const email = raw.trim().toLowerCase();
  if (!email) return { error: "Email is required." };
  if (email.length > PORTAL_EMAIL_MAX) return { error: "Invalid email." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Invalid email." };
  return email;
}

export function normalizePortalMobile(raw: unknown): string | null | { error: string } {
  if (raw === undefined) return null;
  if (raw === null) return null;
  if (typeof raw !== "string") return { error: "Invalid mobile number." };
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > PORTAL_MOBILE_MAX) return { error: "Invalid mobile number." };
  if (!/^[0-9+\-()\s]+$/.test(trimmed)) return { error: "Invalid mobile number." };
  return trimmed;
}

/**
 * Extract only contact fields from a client body.
 * Protected identity/security fields are ignored (never written).
 */
export function extractPortalContactPatch(body: unknown): {
  patch: PortalProfileContactPatch;
  ignoredProtectedFields: string[];
} {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const protectedKeys = [
    "patientId",
    "id",
    "patientHisId",
    "firstName",
    "middleName",
    "lastName",
    "dateOfBirth",
    "portalUserId",
    "createdById",
    "accessCodeHash",
    "passwordHash",
  ] as const;
  const ignoredProtectedFields = protectedKeys.filter((key) => key in raw);

  const patch: PortalProfileContactPatch = {};
  if ("email" in raw) patch.email = raw.email as string | null;
  if ("mobileNumber" in raw) patch.mobileNumber = raw.mobileNumber as string | null;
  return { patch, ignoredProtectedFields };
}

export type PortalProfileUpdateResult =
  | {
      ok: true;
      patient: Patient;
      portalUser: User;
      emailChanged: boolean;
      mobileChanged: boolean;
    }
  | { ok: false; status: 400 | 409 | 404 | 401; error: string };

/**
 * Update contact fields for the JWT patient only.
 * Never writes HIS demographics, portal_user_id, created_by_id, or access_code_hash.
 */
export async function updatePortalProfileContact(
  patientId: number,
  body: unknown,
  deps: PortalProfileUpdateDeps = defaultDeps,
): Promise<PortalProfileUpdateResult> {
  const resolved = await resolvePortalProfilePatient(patientId, deps);
  if (!resolved.ok) {
    return {
      ok: false,
      status: resolved.reason === "inactive" ? 401 : 404,
      error:
        resolved.reason === "inactive"
          ? "Invalid or expired portal session"
          : "Patient not found",
    };
  }

  const { patch } = extractPortalContactPatch(body);
  if (!("email" in patch) && !("mobileNumber" in patch)) {
    return { ok: false, status: 400, error: "No contact fields to update." };
  }

  let nextEmail = resolved.patient.email ?? null;
  let nextMobile = resolved.patient.mobileNumber ?? null;
  let emailChanged = false;
  let mobileChanged = false;

  if ("email" in patch) {
    const normalized = normalizePortalEmail(patch.email);
    if (normalized && typeof normalized === "object" && "error" in normalized) {
      return { ok: false, status: 400, error: normalized.error };
    }
    const email = normalized as string;
    const existingPatient = await deps.findPatientByEmail(email);
    if (existingPatient && existingPatient.id !== resolved.patient.id) {
      return { ok: false, status: 409, error: "That email address is not available." };
    }
    const existingUser = await deps.findUserByEmail(email);
    if (existingUser && existingUser.id !== resolved.portalUser.id) {
      return { ok: false, status: 409, error: "That email address is not available." };
    }
    nextEmail = email;
    emailChanged = (resolved.patient.email ?? "").toLowerCase() !== email;
  }

  if ("mobileNumber" in patch) {
    const normalized = normalizePortalMobile(patch.mobileNumber);
    if (normalized && typeof normalized === "object" && "error" in normalized) {
      return { ok: false, status: 400, error: normalized.error };
    }
    nextMobile = normalized as string | null;
    mobileChanged = (resolved.patient.mobileNumber ?? null) !== nextMobile;
  }

  if (!emailChanged && !mobileChanged) {
    return {
      ok: true,
      patient: resolved.patient,
      portalUser: resolved.portalUser,
      emailChanged: false,
      mobileChanged: false,
    };
  }

  const contactPatch: { email?: string | null; mobileNumber?: string | null } = {};
  if (emailChanged) contactPatch.email = nextEmail;
  if (mobileChanged) contactPatch.mobileNumber = nextMobile;

  const updatedPatient = await deps.updatePatientContact(resolved.patient.id, contactPatch);
  if (!updatedPatient) {
    return { ok: false, status: 404, error: "Patient not found" };
  }

  let portalUser = resolved.portalUser;
  if (emailChanged) {
    const updatedUser = await deps.updateUserEmail(resolved.portalUser.id, nextEmail);
    if (updatedUser) portalUser = updatedUser;
  }

  return {
    ok: true,
    patient: updatedPatient,
    portalUser,
    emailChanged,
    mobileChanged,
  };
}

export function profileAuditDetails(emailChanged: boolean, mobileChanged: boolean): string {
  const tags: string[] = ["profile_updated"];
  if (emailChanged) tags.push("email_changed");
  if (mobileChanged) tags.push("mobile_changed");
  return tags.join(" ");
}
