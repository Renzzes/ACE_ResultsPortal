import {
  authSessionsRepo,
  hospitalPatientsRepo,
  HospitalQueryError,
  patientsRepo,
  usersRepo,
  withTransaction,
  type Patient,
} from "@workspace/db";

import {

  createRecoveryJti,

  generateOtp,

  hashOtp,

  hashPassword,

  maskEmail,

  RECOVERY_TOKEN_TTL_MS,

  signRecoveryToken,

  verifyRecoveryToken,

} from "./auth";

import { EMAIL_UNAVAILABLE_MESSAGE, isPortalEmailConfigured, sendPortalEmail } from "./portal-email";
import { resolvePatientPortalEmail } from "./formatters";

import {

  GENERIC_VERIFY_MESSAGE,

  parseVerifyIdentityBody,

  type VerifyIdentityInput,

} from "./portal-his-verify";

import { resolveActivePortalAccount } from "./portal-activation";

import { isValidPortalPassword, PORTAL_PASSWORD_REQUIREMENTS_MSG } from "./portal-password-policy";

import {

  claimRecoveryTxn,

  createRecoveryTxn,

  finalizeRecoveryTxn,

  getRecoveryTxn,

  markRecoveryOtpVerified,

  releaseRecoveryTxnClaim,

} from "./recovery-state";

import { logger } from "./logger";



export { EMAIL_UNAVAILABLE_MESSAGE };



export const RECOVERY_REQUEST_MESSAGE =

  "Your hospital record was verified, but there is no Patient Portal login for this record yet. Register for the Patient Portal before resetting a password.";



export const ASSISTED_RECOVERY_MESSAGE =

  "Your hospital record is registered, but no portal recovery email is on file. Please visit ACE Medical Center Cebu Medical Records or contact the hospital for assisted recovery.";



export type RecoveryRequestOutcome =

  | { ok: true; kind: "otp_sent"; recoveryToken: string; maskedEmail: string }

  | { ok: true; kind: "assisted_recovery" }

  | { ok: true; kind: "no_portal_account" }

  | { ok: false; kind: "not_verified" | "his_unavailable" | "email_unavailable" };



export type RecoveryConfirmOutcome =

  | { ok: true }

  | {

      ok: false;

      kind:
        | "invalid_token"
        | "invalid_otp"
        | "otp_required"
        | "invalid_password"
        | "email_unavailable"
        | "patient_not_found"
        | "persist_failed";

    };



export type RecoveryConfirmHooks = {

  sendEmail?: typeof sendPortalEmail;

  findPatientById?: (id: number) => Promise<Patient | undefined>;

  setUserPassword?: (
    userId: number,
    passwordHash: string,
    resetLockout?: boolean,
    options?: { clearForcedChange?: boolean },
  ) => Promise<unknown>;

  /** When omitted with a custom setUserPassword hook, session revoke is skipped (unit tests). */
  revokeAllSessions?: (userId: number) => Promise<void>;

  isEmailConfigured?: () => boolean;

  resolvePortalAccount?: typeof resolveActivePortalAccount;

};



async function verifyHis(

  input: VerifyIdentityInput,

): Promise<

  | { ok: true; hospital: NonNullable<Awaited<ReturnType<typeof hospitalPatientsRepo.verifyHospitalPatientByHisIdentity>>> }

  | { ok: false; kind: "not_verified" | "his_unavailable" }

> {

  try {

    const hospital = await hospitalPatientsRepo.verifyHospitalPatientByHisIdentity(input);

    if (!hospital || hospital.isDeceased) {

      return { ok: false, kind: "not_verified" };

    }

    return { ok: true, hospital };

  } catch (err) {

    if (err instanceof HospitalQueryError) {

      logger.error({ err: err.cause ?? err }, "recovery_his_unavailable");

      return { ok: false, kind: "his_unavailable" };

    }

    logger.error({ err }, "recovery_his_error");

    return { ok: false, kind: "his_unavailable" };

  }

}



export async function requestPasswordRecovery(body: unknown): Promise<RecoveryRequestOutcome> {

  const input = parseVerifyIdentityBody(body);

  if (!input) {

    return { ok: false, kind: "not_verified" };

  }



  const verified = await verifyHis(input);

  if (!verified.ok) {

    return verified;

  }



  const patient = await patientsRepo.findPatientByHisId(verified.hospital.patientHisId);

  if (!patient) {

    return { ok: true, kind: "no_portal_account" };

  }



  const portalAccount = await resolveActivePortalAccount(patient);

  if (!portalAccount.ok) {

    return { ok: true, kind: "no_portal_account" };

  }



  const email = resolvePatientPortalEmail(patient.email);

  if (!email) {

    return { ok: true, kind: "assisted_recovery" };

  }



  if (!isPortalEmailConfigured()) {

    return { ok: false, kind: "email_unavailable" };

  }



  const otp = generateOtp();

  const otpHash = hashOtp(otp);

  const jti = createRecoveryJti();

  createRecoveryTxn({

    jti,

    patientId: patient.id,

    otpHash,

    ttlMs: RECOVERY_TOKEN_TTL_MS,

  });



  const recoveryToken = signRecoveryToken({ patientId: patient.id, otpHash, jti });



  const sent = await sendPortalEmail(

    email,

    "ACE Medical Center Cebu — Patient Portal password recovery",

    [

      "You requested to reset your Patient Portal password.",

      "",

      `Your one-time verification code is: ${otp}`,

      "",

      "This code expires in 15 minutes.",

      "",

      "If you did not request this, you can ignore this email.",

    ].join("\n"),

  );



  if (!sent) {

    finalizeRecoveryTxn(jti);

    return { ok: false, kind: "email_unavailable" };

  }



  return {

    ok: true,

    kind: "otp_sent",

    recoveryToken,

    maskedEmail: maskEmail(email),

  };

}



/** @deprecated Use requestPasswordRecovery */

export const requestAccessCodeRecovery = requestPasswordRecovery;



export function parseRecoveryOtpBody(body: unknown): { recoveryToken: string; otp: string } | null {
  if (!body || typeof body !== "object") return null;
  const data = body as Record<string, unknown>;
  const recoveryToken = typeof data.recoveryToken === "string" ? data.recoveryToken.trim() : "";
  const otp = typeof data.otp === "string" ? data.otp.trim() : "";
  if (!recoveryToken || !/^\d{6}$/.test(otp) || recoveryToken.length > 4096) return null;
  return { recoveryToken, otp };
}

/** Step 2. Marks the recovery transaction OTP-verified. Does not change the password. */
export function verifyPasswordRecoveryOtp(body: unknown): { ok: true } | { ok: false; kind: "invalid_token" | "invalid_otp" } {
  const parsed = parseRecoveryOtpBody(body);
  if (!parsed) return { ok: false, kind: "invalid_otp" };

  const payload = verifyRecoveryToken(parsed.recoveryToken);
  if (!payload) return { ok: false, kind: "invalid_token" };

  const submittedHash = hashOtp(parsed.otp);
  if (payload.otpHash !== submittedHash) {
    const rejected = markRecoveryOtpVerified(payload.jti, submittedHash);
    return { ok: false, kind: rejected === "invalid_token" ? "invalid_token" : "invalid_otp" };
  }

  const marked = markRecoveryOtpVerified(payload.jti, submittedHash);
  if (marked === "verified") return { ok: true };
  return { ok: false, kind: marked === "invalid_otp" ? "invalid_otp" : "invalid_token" };
}

export function parseRecoveryConfirmBody(

  body: unknown,

): { recoveryToken: string; otp: string; newPassword: string } | null {

  if (!body || typeof body !== "object") return null;

  const data = body as Record<string, unknown>;

  const recoveryToken = typeof data.recoveryToken === "string" ? data.recoveryToken.trim() : "";

  const otp = typeof data.otp === "string" ? data.otp.trim() : "";

  const newPassword = typeof data.newPassword === "string" ? data.newPassword : "";

  if (!recoveryToken || !/^\d{6}$/.test(otp) || !newPassword) return null;

  if (recoveryToken.length > 4096) return null;

  if (!isValidPortalPassword(newPassword)) return null;

  return { recoveryToken, otp, newPassword };

}



export async function confirmPasswordRecovery(

  body: unknown,

  hooks: RecoveryConfirmHooks = {},

): Promise<RecoveryConfirmOutcome> {

  const parsed = parseRecoveryConfirmBody(body);

  if (!parsed) {

    return { ok: false, kind: "invalid_password" };

  }



  const payload = verifyRecoveryToken(parsed.recoveryToken);

  if (!payload) {

    return { ok: false, kind: "invalid_token" };

  }



  const existing = getRecoveryTxn(payload.jti);
  if (existing?.status === "active") {
    return { ok: false, kind: "otp_required" };
  }

  const claimed = claimRecoveryTxn(payload.jti);

  if (!claimed) {

    return { ok: false, kind: "invalid_token" };

  }



  if (claimed.patientId !== payload.patientId || claimed.otpHash !== payload.otpHash) {

    finalizeRecoveryTxn(payload.jti);

    return { ok: false, kind: "invalid_token" };

  }



  if (hashOtp(parsed.otp) !== claimed.otpHash) {

    releaseRecoveryTxnClaim(payload.jti);

    return { ok: false, kind: "invalid_otp" };

  }



  const findPatient = hooks.findPatientById ?? patientsRepo.findPatientById;

  const patient = await findPatient(payload.patientId);

  if (!patient) {

    finalizeRecoveryTxn(payload.jti);

    return { ok: false, kind: "patient_not_found" };

  }



  const resolvePortal = hooks.resolvePortalAccount ?? resolveActivePortalAccount;

  const portalAccount = await resolvePortal(patient);

  if (!portalAccount.ok) {

    finalizeRecoveryTxn(payload.jti);

    return { ok: false, kind: "patient_not_found" };

  }



  const email = resolvePatientPortalEmail(patient.email);

  const emailConfigured = hooks.isEmailConfigured ?? isPortalEmailConfigured;

  if (!email || !emailConfigured()) {

    releaseRecoveryTxnClaim(payload.jti);

    return { ok: false, kind: "email_unavailable" };

  }



  const nextHash = await hashPassword(parsed.newPassword);

  const sendEmail = hooks.sendEmail ?? sendPortalEmail;



  const sent = await sendEmail(

    email,

    "ACE Medical Center Cebu — Patient Portal password reset",

    [

      "Your Patient Portal password has been reset successfully.",

      "",

      "You can now sign in with your Hospital Patient ID and your new password.",

      "",

      "If you did not request this change, contact ACE Medical Center Cebu immediately.",

    ].join("\n"),

  );



  if (!sent) {

    releaseRecoveryTxnClaim(payload.jti);

    logger.warn({ portalPatientId: patient.id }, "portal_password_recovery_email_delivery_failed");

    return { ok: false, kind: "email_unavailable" };

  }



  const userId = portalAccount.user.id;

  try {
    if (hooks.setUserPassword) {
      await hooks.setUserPassword(userId, nextHash, false, { clearForcedChange: true });
      if (hooks.revokeAllSessions) {
        await hooks.revokeAllSessions(userId);
      }
    } else {
      await withTransaction(async (tx) => {
        const updated = await usersRepo.setUserPassword(
          userId,
          nextHash,
          false,
          { clearForcedChange: true },
          tx,
        );
        if (!updated) {
          throw new Error("password_update_failed");
        }
        await authSessionsRepo.revokeAllForUser(userId, tx);
      });
    }
  } catch (err) {
    releaseRecoveryTxnClaim(payload.jti);
    logger.error({ err, portalPatientId: patient.id }, "portal_password_recovery_persist_failed");
    return { ok: false, kind: "persist_failed" };
  }

  finalizeRecoveryTxn(payload.jti);



  logger.info({ portalPatientId: patient.id }, "portal_password_recovered");

  return { ok: true };

}



/** @deprecated Use confirmPasswordRecovery */

export const confirmAccessCodeRecovery = confirmPasswordRecovery;



export { GENERIC_VERIFY_MESSAGE, PORTAL_PASSWORD_REQUIREMENTS_MSG };


