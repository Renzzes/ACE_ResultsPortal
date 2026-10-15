import {
  HospitalQueryError,
  PORTAL_USER_ROLE,
  hospitalPatientsRepo,
  patientsRepo,
  usersRepo,
  withTransaction,
  type HospitalPatientRecord,
  type Patient,
} from "@workspace/db";
import {
  generateAccessCode,
  hashAccessCode,
  hashPassword,
  signRegistrationToken,
  verifyRegistrationToken,
} from "./auth";
import { logger } from "./logger";
import { isUniqueConstraintError } from "./portal-registration";
import { portalUsernameForHisId } from "./portal-user-identity";
import { isValidPortalPassword, PORTAL_PASSWORD_REQUIREMENTS_MSG } from "./portal-password-policy";
import { activatePortalUserForPatient } from "./portal-activation";

export interface VerifyIdentityInput {
  patientHisId: string;
  lastName: string;
  dateOfBirth: string;
}

export interface RegisterPortalAccountInput {
  registrationToken: string;
  email: string;
  confirmEmail: string;
  password: string;
  confirmPassword: string;
}

export const GENERIC_VERIFY_MESSAGE = "Patient information could not be verified.";
export const HIS_UNAVAILABLE_MESSAGE =
  "Patient verification is temporarily unavailable. Please try again later.";

export type VerifyIdentityOutcome =
  | {
      ok: true;
      isNewPortalAccount: true;
      registrationToken: string;
      hospital: HospitalPatientRecord;
    }
  | {
      ok: true;
      isNewPortalAccount: false;
      needsPortalActivation?: true;
      registrationToken?: string;
    }
  | { ok: false; kind: "not_verified" }
  | { ok: false; kind: "his_unavailable" };

export type RegisterPortalAccountOutcome =
  | {
      ok: true;
      patient: Patient;
      accessCode?: string;
      activated?: boolean;
    }
  | { ok: false; kind: "invalid_token" | "email_taken" | "account_exists" | "his_unavailable" | "validation" };

export function parseVerifyIdentityBody(body: unknown): VerifyIdentityInput | null {
  if (!body || typeof body !== "object") return null;
  const data = body as Record<string, unknown>;
  const patientHisId = typeof data.patientHisId === "string" ? data.patientHisId.trim() : "";
  const lastName = typeof data.lastName === "string" ? data.lastName.trim() : "";
  const dateOfBirth = typeof data.dateOfBirth === "string" ? data.dateOfBirth.trim() : "";
  if (!patientHisId || !lastName || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  if (patientHisId.length > 64 || lastName.length > 100) return null;
  return { patientHisId, lastName, dateOfBirth };
}

export function parseRegisterPortalAccountBody(body: unknown): RegisterPortalAccountInput | null {
  if (!body || typeof body !== "object") return null;
  const data = body as Record<string, unknown>;
  const registrationToken =
    typeof data.registrationToken === "string" ? data.registrationToken.trim() : "";
  const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  const confirmEmail =
    typeof data.confirmEmail === "string" ? data.confirmEmail.trim().toLowerCase() : "";
  const password = typeof data.password === "string" ? data.password : "";
  const confirmPassword = typeof data.confirmPassword === "string" ? data.confirmPassword : "";
  if (!registrationToken || !email || !confirmEmail || !password || !confirmPassword) return null;
  if (email.length > 255 || registrationToken.length > 4096) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (email !== confirmEmail) return null;
  if (password !== confirmPassword) return null;
  if (!isValidPortalPassword(password)) return null;
  return { registrationToken, email, confirmEmail, password, confirmPassword };
}

async function verifyHospitalRecord(
  input: VerifyIdentityInput,
): Promise<
  | { ok: true; hospital: HospitalPatientRecord }
  | { ok: false; kind: "not_verified" | "his_unavailable" }
> {
  const started = Date.now();
  let hospital: HospitalPatientRecord | undefined;

  try {
    hospital = await hospitalPatientsRepo.verifyHospitalPatientByHisIdentity({
      patientHisId: input.patientHisId,
      lastName: input.lastName,
      dateOfBirth: input.dateOfBirth,
    });
  } catch (err) {
    if (err instanceof HospitalQueryError) {
      logger.error(
        { err: err.cause ?? err, durationMs: Date.now() - started },
        "his_identity_verification_unavailable",
      );
      return { ok: false, kind: "his_unavailable" };
    }
    logger.error({ err, durationMs: Date.now() - started }, "his_identity_verification_error");
    return { ok: false, kind: "his_unavailable" };
  }

  if (!hospital || hospital.isDeceased) {
    logger.info({ durationMs: Date.now() - started, result: "failed" }, "his_identity_verification");
    return { ok: false, kind: "not_verified" };
  }

  logger.info(
    { durationMs: Date.now() - started, result: "success", patientHisId: hospital.patientHisId },
    "his_identity_verification",
  );
  return { ok: true, hospital };
}

/**
 * Step 1: HIS verify only. Returns a short-lived registration token for new accounts.
 */
export async function verifyIdentityForRegistration(
  input: VerifyIdentityInput,
): Promise<VerifyIdentityOutcome> {
  const verified = await verifyHospitalRecord(input);
  if (!verified.ok) return verified;

  const existing = await patientsRepo.findPatientByHisId(verified.hospital.patientHisId);
  if (existing) {
    if (existing.portalUserId == null) {
      const registrationToken = signRegistrationToken({
        patientHisId: verified.hospital.patientHisId,
      });
      return {
        ok: true,
        isNewPortalAccount: false,
        needsPortalActivation: true,
        registrationToken,
      };
    }
    return { ok: true, isNewPortalAccount: false };
  }

  const registrationToken = signRegistrationToken({
    patientHisId: verified.hospital.patientHisId,
  });

  return {
    ok: true,
    isNewPortalAccount: true,
    registrationToken,
    hospital: verified.hospital,
  };
}

/**
 * Step 2: Create portal account using verified registration token + patient-supplied email.
 * Creates users(role=patient) + patients + patients.portal_user_id in one transaction.
 * Does NOT set patients.created_by_id (staff creator metadata stays null for self-registration).
 */
export async function registerPortalAccount(
  input: RegisterPortalAccountInput,
): Promise<RegisterPortalAccountOutcome> {
  const tokenPayload = verifyRegistrationToken(input.registrationToken);
  if (!tokenPayload) {
    return { ok: false, kind: "invalid_token" };
  }

  const username = portalUsernameForHisId(tokenPayload.patientHisId);

  const [existingPatient, existingEmailPatient, existingUserEmail, existingUsername] = await Promise.all([
    patientsRepo.findPatientByHisId(tokenPayload.patientHisId),
    patientsRepo.findPatientByEmail(input.email),
    usersRepo.findUserByEmail(input.email),
    usersRepo.findUserByUsername(username),
  ]);

  if (existingPatient) {
    if (existingPatient.portalUserId == null) {
      const activated = await activatePortalUserForPatient(
        existingPatient,
        input.password,
        input.email,
      );
      if (!activated.ok) {
        if (activated.kind === "email_taken") return { ok: false, kind: "email_taken" };
        if (activated.kind === "validation") return { ok: false, kind: "validation" };
        return { ok: false, kind: "account_exists" };
      }
      return { ok: true, patient: activated.patient, activated: true };
    }
    return { ok: false, kind: "account_exists" };
  }
  if (existingEmailPatient || existingUserEmail) {
    return { ok: false, kind: "email_taken" };
  }
  if (existingUsername) {
    // Deterministic username collision implies a prior portal user for this HIS ID.
    return { ok: false, kind: "account_exists" };
  }

  let hospital: HospitalPatientRecord | undefined;
  try {
    hospital = await hospitalPatientsRepo.getHospitalPatientByHisId(tokenPayload.patientHisId);
  } catch (err) {
    if (err instanceof HospitalQueryError) {
      logger.error({ err: err.cause ?? err }, "his_lookup_during_portal_register_unavailable");
      return { ok: false, kind: "his_unavailable" };
    }
    logger.error({ err }, "his_lookup_during_portal_register_failed");
    return { ok: false, kind: "his_unavailable" };
  }

  if (!hospital || hospital.isDeceased) {
    return { ok: false, kind: "invalid_token" };
  }

  if (!isValidPortalPassword(input.password)) {
    return { ok: false, kind: "validation" };
  }

  const plaintextCode = generateAccessCode();
  const accessCodeHash = await hashAccessCode(plaintextCode);
  const passwordHash = await hashPassword(input.password);

  try {
    const created = await withTransaction(async (tx) => {
      const raced = await patientsRepo.findPatientByHisId(hospital.patientHisId, tx);
      if (raced) return { kind: "existing" as const };

      const emailTaken = await patientsRepo.findPatientByEmail(input.email, tx);
      if (emailTaken) return { kind: "email_taken" as const };

      const usernameTaken = await usersRepo.findUserByUsername(username, tx);
      if (usernameTaken) return { kind: "existing" as const };

      const portalUser = await usersRepo.insertUser(
        {
          username,
          passwordHash,
          firstName: hospital.firstName,
          lastName: hospital.lastName,
          email: input.email,
          role: PORTAL_USER_ROLE,
        },
        tx,
      );

      const patient = await patientsRepo.insertPatient(
        {
          patientHisId: hospital.patientHisId,
          lastName: hospital.lastName,
          firstName: hospital.firstName,
          middleName: hospital.middleName,
          dateOfBirth: hospital.dateOfBirth,
          mobileNumber: null,
          email: input.email,
          accessCodeHash,
          createdById: null,
          portalUserId: portalUser.id,
        },
        tx,
      );
      return { kind: "created" as const, patient };
    });

    if (created.kind === "existing") {
      return { ok: false, kind: "account_exists" };
    }
    if (created.kind === "email_taken") {
      return { ok: false, kind: "email_taken" };
    }

    logger.info(
      { portalPatientId: created.patient.id, portalUserId: created.patient.portalUserId },
      "portal_account_created",
    );
    return { ok: true, patient: created.patient, accessCode: plaintextCode };
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      const again = await patientsRepo.findPatientByHisId(hospital.patientHisId);
      if (again) return { ok: false, kind: "account_exists" };
    }
    logger.error({ err }, "portal_patient_create_failed");
    return { ok: false, kind: "his_unavailable" };
  }
}

/** @deprecated Use verifyIdentityForRegistration — kept for internal HIS lookup reuse. */
export async function verifyIdentityAndEnsurePortalPatient(
  input: VerifyIdentityInput,
): Promise<VerifyIdentityOutcome> {
  return verifyIdentityForRegistration(input);
}
