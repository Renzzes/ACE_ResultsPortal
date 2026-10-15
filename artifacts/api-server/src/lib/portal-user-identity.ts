import { createHash } from "node:crypto";

/**
 * Deterministic internal username for Patient Portal users.
 * Patients sign in with Hospital Patient ID + password; this username is internal.
 * Fits dbo.users.username NVARCHAR(64) UNIQUE.
 */
export function portalUsernameForHisId(patientHisId: string): string {
  const hisId = patientHisId.trim();
  const prefix = "patient:";
  const maxLen = 64;
  if (!hisId) {
    throw new Error("patientHisId is required for portal username");
  }
  if (prefix.length + hisId.length <= maxLen) {
    return `${prefix}${hisId}`;
  }
  const hash = createHash("sha256").update(hisId, "utf8").digest("hex").slice(0, 8);
  const room = maxLen - prefix.length - 1 - hash.length;
  return `${prefix}${hisId.slice(0, Math.max(1, room))}_${hash}`;
}

