/**
 * Shared diagnostic access-code issue + email sequence.
 * Does not replace the persisted hash until SMTP accepts the message.
 * SMTP acceptance is not proof of inbox delivery.
 */
import { patientsRepo, type Patient } from "@workspace/db";
import { generateAccessCode, hashAccessCode, maskEmail } from "./auth";
import { isPortalEmailConfigured, sendPortalEmailDetailed } from "./portal-email";

export type AccessCodeEmailResult =
  | {
      ok: true;
      credentialIssued: true;
      emailAccepted: true;
      accessCode: string;
      emailedToMasked: string;
      patient: Patient;
    }
  | {
      ok: false;
      status: number;
      error: string;
      credentialIssued: false;
      emailAccepted: false;
      hashUnchanged: true;
      deliveryUncertain?: boolean;
    }
  | {
      ok: false;
      status: number;
      error: string;
      /** Email transport accepted, but DB activation failed — delivery outcome uncertain. */
      credentialIssued: false;
      emailAccepted: true;
      activationUncertain: true;
      hashUnchanged: boolean;
    };

const SUBJECT = "ACE Medical Center Cebu — Your diagnostic results access code";

function bodyForCode(accessCode: string): string {
  return [
    "A new diagnostic results access code was issued for your hospital patient record.",
    "",
    `Access code: ${accessCode}`,
    "",
    "Use this code to unlock Results in the Patient Portal. It is separate from your sign-in password.",
    "Any previous access code no longer works.",
    "",
    "If you did not request this, contact ACE Medical Center Cebu Medical Records.",
  ].join("\n");
}

/**
 * Generate a replacement code, email it, then activate the hash only after SMTP acceptance.
 * Concurrent replacements race on the expected current hash.
 */
export async function issueAccessCodeAndEmail(input: {
  patient: Patient;
  email: string;
  /** Optional alternate subject/body for staff portal copy. */
  subject?: string;
  text?: (accessCode: string) => string;
}): Promise<AccessCodeEmailResult> {
  if (!isPortalEmailConfigured()) {
    return {
      ok: false,
      status: 503,
      error: "Email delivery is not configured.",
      credentialIssued: false,
      emailAccepted: false,
      hashUnchanged: true,
    };
  }

  const expectedHash = input.patient.accessCodeHash;
  if (!expectedHash) {
    return {
      ok: false,
      status: 409,
      error:
        "No patient-level access code is active. Issue a document access code for the specific result instead.",
      credentialIssued: false,
      emailAccepted: false,
      hashUnchanged: true,
    };
  }

  const accessCode = generateAccessCode();
  const accessCodeHash = await hashAccessCode(accessCode);

  const emailResult = await sendPortalEmailDetailed(
    input.email,
    input.subject ?? SUBJECT,
    input.text ? input.text(accessCode) : bodyForCode(accessCode),
  );

  if (!emailResult.accepted) {
    if (emailResult.uncertain) {
      return {
        ok: false,
        status: 503,
        error:
          "Email delivery outcome is uncertain (transport timeout). The existing access code was not changed. Confirm with the patient before reissuing.",
        credentialIssued: false,
        emailAccepted: false,
        hashUnchanged: true,
        deliveryUncertain: true,
      };
    }
    return {
      ok: false,
      status: 503,
      error: "Email delivery failed. The existing access code was not changed.",
      credentialIssued: false,
      emailAccepted: false,
      hashUnchanged: true,
    };
  }

  const patient = await patientsRepo.updateAccessCodeHashIfMatch(
    input.patient.id,
    accessCodeHash,
    expectedHash,
  );

  if (!patient) {
    // Another concurrent reissue won, or the patient row disappeared.
    const current = await patientsRepo.findPatientById(input.patient.id);
    return {
      ok: false,
      status: 409,
      error:
        "Email was accepted for sending, but the access code could not be activated because the patient record changed concurrently. Contact support if the patient reports an invalid code.",
      credentialIssued: false,
      emailAccepted: true,
      activationUncertain: true,
      hashUnchanged: current ? current.accessCodeHash === expectedHash : true,
    };
  }

  return {
    ok: true,
    credentialIssued: true,
    emailAccepted: true,
    accessCode,
    emailedToMasked: maskEmail(input.email),
    patient,
  };
}
