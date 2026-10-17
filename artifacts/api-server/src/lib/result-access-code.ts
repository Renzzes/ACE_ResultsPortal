/**
 * Document-level (per-result) access codes.
 * Plaintext is never persisted; bcrypt hash + AES-GCM envelope support verify / print / email-retry.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { resultsRepo, type Patient, type ResultRow } from "@workspace/db";
import {
  compareAccessCode,
  generateAccessCode,
  getJwtSecret,
  hashAccessCode,
  maskEmail,
} from "./auth";
import { isPortalEmailConfigured, sendPortalEmailDetailed } from "./portal-email";

const EMAIL_SUBJECT = "ACE Medical Center Cebu — Document access code";

const CATEGORY_LABELS: Record<ResultRow["category"], string> = {
  laboratory: "Laboratory",
  radiology: "Radiology",
  ultrasound: "Ultrasound",
  ct_scan: "CT Scan",
  mri: "MRI",
  ecg: "ECG",
  echo_2d: "2D Echo",
  rehabilitation: "Rehabilitation",
  other: "Diagnostic",
};

function resultCategoryLabel(category: ResultRow["category"]): string {
  return CATEGORY_LABELS[category] ?? "Diagnostic";
}

export type ResultAccessCodeIssueMode = "upload" | "regenerate" | "retry_email";

export type ResultAccessCodeIssueResult =
  | {
      ok: true;
      result: ResultRow;
      emailAccepted: true;
      emailedToMasked: string;
      /** Plaintext only for authorized print immediately after issue; never log. */
      accessCode: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
      emailAccepted: false;
      credentialIssued: false;
      deliveryUncertain?: boolean;
      result?: ResultRow;
    }
  | {
      ok: false;
      status: number;
      error: string;
      emailAccepted: true;
      credentialIssued: false;
      activationUncertain: true;
      result?: ResultRow;
    };

function accessCodeKey(): Buffer {
  return createHash("sha256").update(`result-access-code:${getJwtSecret()}`, "utf8").digest();
}

/** Encrypt plaintext access code for staff print / email-retry only. */
export function encryptAccessCode(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", accessCodeKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function decryptAccessCode(envelope: string): string | null {
  try {
    const buf = Buffer.from(envelope, "base64url");
    if (buf.length < 12 + 16 + 1) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", accessCodeKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function isValidRecipientEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 255) return false;
  // Practical RFC5322-lite; reject spaces and multiple @.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

export function normalizeRecipientEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function verifyResultAccessCode(
  result: Pick<ResultRow, "accessCodeHash">,
  accessCode: string,
): Promise<boolean> {
  const code = accessCode.trim();
  if (!code || !result.accessCodeHash) return false;
  return compareAccessCode(code, result.accessCodeHash);
}

function emailBodyForResult(input: {
  accessCode: string;
  category: ResultRow["category"];
  originalFileName: string;
}): string {
  const docLabel = resultCategoryLabel(input.category);
  return [
    "ACE Medical Center Cebu",
    "",
    `A document access code was issued for your ${docLabel} result.`,
    `Document: ${input.originalFileName}`,
    "",
    `Access code: ${input.accessCode}`,
    "",
    "Sign in to the ACE Results Portal, open Your Diagnostic Results, select this document,",
    "and enter the access code to unlock it. Each document requires its own code.",
    "This code is separate from your Patient Portal password.",
    "",
    "If you did not expect this message, contact ACE Medical Center Cebu Medical Records.",
  ].join("\n");
}

/**
 * Issue or regenerate a document access code and email it.
 * Activates hash+encrypted only after SMTP acceptance (except retry_email which never rotates).
 */
export async function issueResultAccessCode(input: {
  result: ResultRow;
  patient: Pick<Patient, "id" | "email" | "patientHisId" | "firstName" | "lastName">;
  email: string;
  mode: ResultAccessCodeIssueMode;
}): Promise<ResultAccessCodeIssueResult> {
  const email = normalizeRecipientEmail(input.email);
  if (!isValidRecipientEmail(email)) {
    return {
      ok: false,
      status: 400,
      error: "A valid patient email address is required to send the document access code.",
      emailAccepted: false,
      credentialIssued: false,
    };
  }

  if (!isPortalEmailConfigured()) {
    return {
      ok: false,
      status: 503,
      error: "Email delivery is not configured.",
      emailAccepted: false,
      credentialIssued: false,
      result: input.result,
    };
  }

  if (input.mode === "retry_email") {
    if (!input.result.accessCodeEncrypted || !input.result.accessCodeHash) {
      return {
        ok: false,
        status: 409,
        error: "No active document access code to resend. Regenerate a new code first.",
        emailAccepted: false,
        credentialIssued: false,
        result: input.result,
      };
    }
    const existing = decryptAccessCode(input.result.accessCodeEncrypted);
    if (!existing) {
      return {
        ok: false,
        status: 500,
        error: "Unable to prepare the current access code for resend. Regenerate a new code.",
        emailAccepted: false,
        credentialIssued: false,
        result: input.result,
      };
    }
    const emailResult = await sendPortalEmailDetailed(
      email,
      EMAIL_SUBJECT,
      emailBodyForResult({
        accessCode: existing,
        category: input.result.category,
        originalFileName: input.result.originalFileName,
      }),
    );
    if (!emailResult.accepted) {
      await resultsRepo.updateResultAccessCredential(input.result.id, {
        accessCodeHash: input.result.accessCodeHash,
        accessCodeEncrypted: input.result.accessCodeEncrypted,
        accessCodeIssuedAt: input.result.accessCodeIssuedAt,
        accessCodeEmailedAt: input.result.accessCodeEmailedAt,
        accessCodeEmailStatus: "failed",
      });
      return {
        ok: false,
        status: 503,
        error: emailResult.uncertain
          ? "Email delivery outcome is uncertain. The current access code was not changed."
          : "Email delivery failed. The current access code was not changed.",
        emailAccepted: false,
        credentialIssued: false,
        deliveryUncertain: emailResult.uncertain === true,
        result: input.result,
      };
    }
    const updated = await resultsRepo.updateResultAccessCredential(input.result.id, {
      accessCodeHash: input.result.accessCodeHash,
      accessCodeEncrypted: input.result.accessCodeEncrypted,
      accessCodeIssuedAt: input.result.accessCodeIssuedAt,
      accessCodeEmailedAt: new Date(),
      accessCodeEmailStatus: "accepted",
    });
    return {
      ok: true,
      result: updated ?? input.result,
      emailAccepted: true,
      emailedToMasked: maskEmail(email),
      accessCode: existing,
    };
  }

  const accessCode = generateAccessCode();
  const accessCodeHash = await hashAccessCode(accessCode);
  const accessCodeEncrypted = encryptAccessCode(accessCode);

  const emailResult = await sendPortalEmailDetailed(
    email,
    EMAIL_SUBJECT,
    emailBodyForResult({
      accessCode,
      category: input.result.category,
      originalFileName: input.result.originalFileName,
    }),
  );

  if (!emailResult.accepted) {
    // Keep result row; mark email failed. Do not activate a new hash on upload failure
    // so a retry can issue cleanly. On regenerate, leave prior credential intact.
    if (input.mode === "upload") {
      await resultsRepo.updateResultAccessCredential(input.result.id, {
        accessCodeHash: null,
        accessCodeEncrypted: null,
        accessCodeIssuedAt: null,
        accessCodeEmailedAt: null,
        accessCodeEmailStatus: "failed",
      });
    }
    return {
      ok: false,
      status: 503,
      error: emailResult.uncertain
        ? "Email delivery outcome is uncertain. The document access code was not activated."
        : "Document uploaded or ready, but access-code email failed. The code was not activated.",
      emailAccepted: false,
      credentialIssued: false,
      deliveryUncertain: emailResult.uncertain === true,
      result: input.result,
    };
  }

  const now = new Date();
  const activated = await resultsRepo.updateResultAccessCredential(input.result.id, {
    accessCodeHash,
    accessCodeEncrypted,
    accessCodeIssuedAt: now,
    accessCodeEmailedAt: now,
    accessCodeEmailStatus: "accepted",
    expectedHash: input.mode === "regenerate" ? input.result.accessCodeHash : undefined,
  });

  if (!activated) {
    return {
      ok: false,
      status: 409,
      error:
        "Email was accepted for sending, but the document access code could not be activated because the result changed concurrently.",
      emailAccepted: true,
      credentialIssued: false,
      activationUncertain: true,
      result: input.result,
    };
  }

  return {
    ok: true,
    result: activated,
    emailAccepted: true,
    emailedToMasked: maskEmail(email),
    accessCode,
  };
}

/** Reveal current plaintext for authorized staff print only. */
export function revealResultAccessCodeForPrint(result: ResultRow): string | null {
  if (!result.accessCodeEncrypted || !result.accessCodeHash) return null;
  return decryptAccessCode(result.accessCodeEncrypted);
}
