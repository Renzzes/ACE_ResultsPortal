import {
  PORTAL_USER_ROLE,
  patientsRepo,
  usersRepo,
  withTransaction,
  type Patient,
  type User,
} from "@workspace/db";
import { hashPassword } from "./auth";
import { isValidPortalPassword } from "./portal-password-policy";
import { portalUsernameForHisId } from "./portal-user-identity";
import { logger } from "./logger";

export type PortalActivationDeps = {
  findUserById: (id: number) => Promise<User | undefined>;
};

/**
 * Patient Portal accounts require patients.portal_user_id → users.id
 * with role=patient and is_active=1.
 */
export async function resolveActivePortalAccount(
  patient: Pick<Patient, "portalUserId">,
  deps: PortalActivationDeps = { findUserById: (id) => usersRepo.findUserById(id) },
): Promise<{ ok: true; user: User } | { ok: false }> {
  const portalUserId = patient.portalUserId;
  if (portalUserId == null || !Number.isFinite(portalUserId) || portalUserId <= 0) {
    return { ok: false };
  }

  const user = await deps.findUserById(portalUserId);
  if (!user) return { ok: false };
  if (!user.isActive) return { ok: false };
  if (user.role !== PORTAL_USER_ROLE) return { ok: false };

  return { ok: true, user };
}

export type ActivatePortalUserOutcome =
  | { ok: true; user: User; patient: Patient }
  | { ok: false; kind: "already_active" | "email_taken" | "username_taken" | "validation" | "database_unavailable" };

/**
 * Links an existing hospital patient row to a new portal users record.
 * Used when staff created the patient with an access code but no portal login yet.
 */
export async function activatePortalUserForPatient(
  patient: Patient,
  password: string,
  email?: string | null,
): Promise<ActivatePortalUserOutcome> {
  if (patient.portalUserId != null) {
    return { ok: false, kind: "already_active" };
  }
  if (!isValidPortalPassword(password)) {
    return { ok: false, kind: "validation" };
  }

  const username = portalUsernameForHisId(patient.patientHisId);
  const normalizedEmail = (email ?? patient.email)?.trim().toLowerCase() || null;

  const [existingUsername, existingEmailUser, existingEmailPatient] = await Promise.all([
    usersRepo.findUserByUsername(username),
    normalizedEmail ? usersRepo.findUserByEmail(normalizedEmail) : Promise.resolve(undefined),
    normalizedEmail ? patientsRepo.findPatientByEmail(normalizedEmail) : Promise.resolve(undefined),
  ]);

  if (existingUsername) {
    return { ok: false, kind: "username_taken" };
  }
  if (existingEmailUser) {
    return { ok: false, kind: "email_taken" };
  }
  if (existingEmailPatient && existingEmailPatient.id !== patient.id) {
    return { ok: false, kind: "email_taken" };
  }

  const passwordHash = await hashPassword(password);

  try {
    const result = await withTransaction(async (tx) => {
      const current = await patientsRepo.findPatientById(patient.id, tx);
      if (!current || current.portalUserId != null) {
        return { kind: "already_active" as const };
      }

      const portalUser = await usersRepo.insertUser(
        {
          username,
          passwordHash,
          firstName: current.firstName,
          lastName: current.lastName,
          email: normalizedEmail,
          role: PORTAL_USER_ROLE,
        },
        tx,
      );

      const linked = await patientsRepo.updatePortalUserId(current.id, portalUser.id, tx);
      if (!linked) return { kind: "database_unavailable" as const };

      if (normalizedEmail && normalizedEmail !== (current.email?.trim().toLowerCase() ?? "")) {
        await patientsRepo.updatePatient(current.id, { email: normalizedEmail });
      }

      return { kind: "activated" as const, user: portalUser, patient: linked };
    });

    if (result.kind === "already_active") return { ok: false, kind: "already_active" };
    if (result.kind === "database_unavailable") return { ok: false, kind: "database_unavailable" };

    logger.info(
      { portalPatientId: result.patient.id, portalUserId: result.user.id },
      "portal_account_activated",
    );
    return { ok: true, user: result.user, patient: result.patient };
  } catch (err) {
    logger.error({ err, portalPatientId: patient.id }, "portal_account_activation_failed");
    return { ok: false, kind: "database_unavailable" };
  }
}

export async function resolveOrActivatePortalPatientForLogin(input: {
  identifier: string;
  lastName: string;
  password: string;
}): Promise<
  | {
      patient: Patient;
      passwordHash: string;
      portalUserId: number;
      activated: boolean;
    }
  | undefined
> {
  const trimmedId = input.identifier.trim();
  if (!trimmedId) return undefined;

  const patient = await patientsRepo.findPatientByHisId(trimmedId);
  if (!patient) return undefined;
  if (patient.lastName.toLowerCase() !== input.lastName.trim().toLowerCase()) return undefined;

  if (patient.portalUserId != null) return undefined;

  // The diagnostic access code is not a portal password and must not create an account.
  if (!isValidPortalPassword(input.password)) return undefined;

  const activated = await activatePortalUserForPatient(patient, input.password, patient.email);
  if (!activated.ok) return undefined;

  return {
    patient: activated.patient,
    passwordHash: activated.user.passwordHash,
    portalUserId: activated.user.id,
    activated: true,
  };
}
