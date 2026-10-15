/**
 * In-memory single-use recovery transaction state.
 * No schema migration: keyed by recovery JWT jti, process-local.
 * Entries expire with the recovery token TTL (15 minutes).
 */
export type RecoveryTxnStatus = "active" | "otp_verified" | "claimed" | "used";

export interface RecoveryTxn {
  patientId: number;
  otpHash: string;
  expiresAt: number;
  status: RecoveryTxnStatus;
}

const store = new Map<string, RecoveryTxn>();

function purgeExpired(now: number): void {
  for (const [jti, txn] of store) {
    if (txn.expiresAt <= now) store.delete(jti);
  }
}

export function createRecoveryTxn(input: {
  jti: string;
  patientId: number;
  otpHash: string;
  ttlMs: number;
  now?: number;
}): void {
  const now = input.now ?? Date.now();
  purgeExpired(now);
  store.set(input.jti, {
    patientId: input.patientId,
    otpHash: input.otpHash,
    expiresAt: now + input.ttlMs,
    status: "active",
  });
}

export function getRecoveryTxn(jti: string, now = Date.now()): RecoveryTxn | undefined {
  purgeExpired(now);
  const txn = store.get(jti);
  if (!txn) return undefined;
  if (txn.expiresAt <= now) {
    store.delete(jti);
    return undefined;
  }
  return txn;
}

/**
 * Record that the emailed OTP matched. Password reset cannot proceed until this happens.
 * A wrong code leaves the transaction active.
 */
export function markRecoveryOtpVerified(
  jti: string,
  otpHash: string,
  now = Date.now(),
): "verified" | "invalid_otp" | "invalid_token" {
  const txn = getRecoveryTxn(jti, now);
  if (!txn || txn.status === "used" || txn.status === "claimed") return "invalid_token";
  if (txn.otpHash !== otpHash) return "invalid_otp";
  txn.status = "otp_verified";
  return "verified";
}

/** Atomically move otp_verified → claimed for the password update. */
export function claimRecoveryTxn(jti: string, now = Date.now()): RecoveryTxn | undefined {
  const txn = getRecoveryTxn(jti, now);
  if (!txn || txn.status !== "otp_verified") return undefined;
  txn.status = "claimed";
  return txn;
}

/** Release a claim after email failure so the patient can retry the password step. */
export function releaseRecoveryTxnClaim(jti: string, now = Date.now()): void {
  const txn = getRecoveryTxn(jti, now);
  if (!txn || txn.status !== "claimed") return;
  txn.status = "otp_verified";
}

/** Permanently consume after successful email + hash update. */
export function finalizeRecoveryTxn(jti: string, now = Date.now()): void {
  const txn = getRecoveryTxn(jti, now);
  if (!txn) return;
  txn.status = "used";
}

/** Test helper only. */
export function clearRecoveryTxnsForTests(): void {
  store.clear();
}
