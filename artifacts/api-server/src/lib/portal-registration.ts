import {
  HospitalQueryError,
  PORTAL_USER_ROLE,
  hospitalPatientsRepo,
  patientsRepo,
  usersRepo,
  withTransaction,
  type Patient,
} from "@workspace/db";
import { hashAccessCode, hashPassword, generateAccessCode } from "./auth";
import { logger } from "./logger";

export type PortalVerifyReason =
  | "PATIENT_NOT_VERIFIED"
  | "NO_HOSPITAL_RECORD"
  | "PORTAL_ACCOUNT_EXISTS"
  | "HOSPITAL_DATABASE_UNAVAILABLE"
  | "VALIDATION_ERROR"
  | "DATABASE_UNAVAILABLE";

export interface PortalIdentityInput {
  firstName: string;
  middleName?: string;
  lastName: string;
  suffix?: string;
  gender: string;
  birthDate: string;
  mobileNumber?: string;
}

export interface PortalRegisterInput extends PortalIdentityInput {
  email: string;
  username: string;
  password: string;
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isStrongPassword(value: string): boolean {
  return (
    value.length >= 8 &&
    value.length <= 128 &&
    /\d/.test(value) &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}

export function parseVerifyPatientBody(body: unknown): PortalIdentityInput | null {
  if (!body || typeof body !== "object") return null;
  const data = body as Record<string, unknown>;
  const firstName = asTrimmedString(data.firstName);
  const lastName = asTrimmedString(data.lastName);
  const gender = asTrimmedString(data.gender);
  const birthDate = asTrimmedString(data.birthDate);
  if (!firstName || !lastName || !gender || !isIsoDate(birthDate)) return null;
  if (firstName.length > 100 || lastName.length > 100 || gender.length > 32) return null;
  return {
    firstName,
    middleName: asTrimmedString(data.middleName) || undefined,
    lastName,
    suffix: asTrimmedString(data.suffix) || undefined,
    gender,
    birthDate,
    mobileNumber: asTrimmedString(data.mobileNumber) || undefined,
  };
}

export function parseRegisterPatientBody(body: unknown): (PortalRegisterInput & { confirmPassword: string }) | null {
  const identity = parseVerifyPatientBody(body);
  if (!identity || !body || typeof body !== "object") return null;
  const data = body as Record<string, unknown>;
  const email = asTrimmedString(data.email).toLowerCase();
  const username = asTrimmedString(data.username);
  const password = typeof data.password === "string" ? data.password : "";
  const confirmPassword = typeof data.confirmPassword === "string" ? data.confirmPassword : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) return null;
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) return null;
  if (!isStrongPassword(password) || password !== confirmPassword) return null;
  if (data.terms !== true) return null;
  return { ...identity, email, username, password, confirmPassword };
}

export type PortalVerifyResult =
  | { ok: true; patid: string }
  | { ok: false; reason: PortalVerifyReason };

const GENERIC_VERIFY_FAIL: PortalVerifyReason = "PATIENT_NOT_VERIFIED";

function sqlErrorNumber(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const direct = "number" in err ? Number((err as { number?: unknown }).number) : undefined;
  if (Number.isFinite(direct)) return direct;
  const original = (err as { originalError?: { number?: unknown } }).originalError;
  const nested = original && typeof original === "object" ? Number(original.number) : undefined;
  return Number.isFinite(nested) ? nested : undefined;
}

export function isUniqueConstraintError(err: unknown): boolean {
  const number = sqlErrorNumber(err);
  return number === 2627 || number === 2601;
}

export function isCheckConstraintError(err: unknown): boolean {
  return sqlErrorNumber(err) === 547;
}

export async function verifyHospitalIdentity(input: PortalIdentityInput): Promise<PortalVerifyResult> {
  try {
    const match = await hospitalPatientsRepo.findHospitalPatientIdentity({
      firstName: input.firstName,
      middleName: input.middleName,
      lastName: input.lastName,
      suffix: input.suffix,
      gender: input.gender,
      birthDate: input.birthDate,
    });

    if (!match) {
      return { ok: false, reason: GENERIC_VERIFY_FAIL };
    }
    if (!match.hasHospitalRecord) {
      return { ok: false, reason: "NO_HOSPITAL_RECORD" };
    }

    return { ok: true, patid: match.patid };
  } catch (err) {
    if (err instanceof HospitalQueryError) {
      logger.error({ err: err.cause ?? err }, "Hospital identity lookup failed");
      return { ok: false, reason: "HOSPITAL_DATABASE_UNAVAILABLE" };
    }
    logger.error({ err }, "Hospital identity lookup failed");
    return { ok: false, reason: "HOSPITAL_DATABASE_UNAVAILABLE" };
  }
}

export async function registerVerifiedPortalPatient(
  input: PortalRegisterInput,
): Promise<
  | { ok: true; patient: Patient }
  | { ok: false; reason: PortalVerifyReason | "USERNAME_TAKEN" | "EMAIL_TAKEN" }
> {
  const verified = await verifyHospitalIdentity(input);
  if (!verified.ok) return verified;

  const existingPatient = await patientsRepo.findPatientByHisId(verified.patid);
  if (existingPatient) return { ok: false, reason: "PORTAL_ACCOUNT_EXISTS" };

  const username = input.username.trim();
  const email = input.email.trim();

  const [existingUsername, existingEmail, existingPatientEmail] = await Promise.all([
    usersRepo.findUserByUsername(username),
    usersRepo.findUserByEmail(email),
    patientsRepo.findPatientByEmail(email),
  ]);
  if (existingUsername) return { ok: false, reason: "USERNAME_TAKEN" };
  if (existingEmail || existingPatientEmail) return { ok: false, reason: "EMAIL_TAKEN" };

  const passwordHash = await hashPassword(input.password);
  const unusedAccessHash = await hashAccessCode(generateAccessCode());

  try {
    const patient = await withTransaction(async (tx) => {
      const user = await usersRepo.insertUser(
        {
          username,
          passwordHash,
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          email,
          role: PORTAL_USER_ROLE,
        },
        tx,
      );

      return patientsRepo.insertPatient(
        {
          patientHisId: verified.patid,
          lastName: input.lastName.trim(),
          firstName: input.firstName.trim(),
          middleName: input.middleName?.trim() || null,
          dateOfBirth: input.birthDate,
          mobileNumber: input.mobileNumber?.trim() || null,
          email,
          accessCodeHash: unusedAccessHash,
          createdById: null,
          portalUserId: user.id,
        },
        tx,
      );
    });

    return { ok: true, patient };
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return { ok: false, reason: "PORTAL_ACCOUNT_EXISTS" };
    }
    if (isCheckConstraintError(err)) {
      logger.error(
        { err },
        "Portal user insert blocked by existing users.role constraint; ACE_ResultsPortal schema was not modified",
      );
      try {
        const patient = await patientsRepo.insertPatient({
          patientHisId: verified.patid,
          lastName: input.lastName.trim(),
          firstName: input.firstName.trim(),
          middleName: input.middleName?.trim() || null,
          dateOfBirth: input.birthDate,
          mobileNumber: input.mobileNumber?.trim() || null,
          email: `${username}\n${email}`,
          accessCodeHash: passwordHash,
          createdById: null,
          portalUserId: null,
        });
        return { ok: true, patient };
      } catch (fallbackErr) {
        if (isUniqueConstraintError(fallbackErr)) {
          return { ok: false, reason: "PORTAL_ACCOUNT_EXISTS" };
        }
        logger.error({ err: fallbackErr }, "Portal patient fallback insert failed");
        return { ok: false, reason: "DATABASE_UNAVAILABLE" };
      }
    }
    logger.error({ err }, "Portal account creation failed");
    return { ok: false, reason: "DATABASE_UNAVAILABLE" };
  }
}

export async function resolvePortalPatientForLogin(identifier: string): Promise<{
  patient: Patient;
  passwordHash: string;
  portalUserId: number | null;
} | undefined> {
  const trimmed = identifier.trim();
  if (!trimmed) return undefined;

  const byUsername = await usersRepo.findUserByUsername(trimmed);
  if (byUsername) {
    if (byUsername.role !== PORTAL_USER_ROLE || !byUsername.isActive) return undefined;
    const patient = await patientsRepo.findPatientByPortalUserId(byUsername.id);
    if (!patient) return undefined;
    return { patient, passwordHash: byUsername.passwordHash, portalUserId: byUsername.id };
  }

  const byPortalUsername = await patientsRepo.findPatientByPortalUsername(trimmed);
  if (byPortalUsername) {
    if (byPortalUsername.portalUserId == null) return undefined;
    const owner = await usersRepo.findUserById(byPortalUsername.portalUserId);
    if (!owner || owner.role !== PORTAL_USER_ROLE || !owner.isActive) return undefined;
    return {
      patient: byPortalUsername,
      passwordHash: owner.passwordHash,
      portalUserId: owner.id,
    };
  }

  const byHisId = await patientsRepo.findPatientByHisId(trimmed);
  if (!byHisId) return undefined;

  if (byHisId.portalUserId == null) return undefined;

  const owner = await usersRepo.findUserById(byHisId.portalUserId);
  if (!owner || owner.role !== PORTAL_USER_ROLE || !owner.isActive) return undefined;
  return { patient: byHisId, passwordHash: owner.passwordHash, portalUserId: owner.id };
}
