/**
 * Short-lived, in-memory plaintext access codes from staff patient registration.
 * Codes are never written to the database; only the hash is persisted.
 *
 * PROCESS-LOCAL ONLY: entries do not survive restarts or other app processes.
 * Do not treat this cache as durable cross-process storage.
 */

const DEFAULT_TTL_MS = 30 * 60 * 1000;
/** Soft bound to avoid unbounded growth if TTL cleanup lags. */
const MAX_ENTRIES = 5_000;

type PendingCode = {
  code: string;
  issuedByUserId: number;
  expiresAt: number;
  /** In-process send guard — does not coordinate across processes. */
  sendInFlight: boolean;
};

const pending = new Map<number, PendingCode>();

function sweepExpired(now = Date.now()): void {
  for (const [patientId, row] of pending) {
    if (now > row.expiresAt && !row.sendInFlight) {
      pending.delete(patientId);
    }
  }
}

function evictIfNeeded(): void {
  if (pending.size <= MAX_ENTRIES) return;
  sweepExpired();
  if (pending.size <= MAX_ENTRIES) return;
  // Drop soonest-to-expire idle entries first (never mid-send).
  const idle = [...pending.entries()]
    .filter(([, row]) => !row.sendInFlight)
    .sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  for (const [patientId] of idle) {
    if (pending.size <= MAX_ENTRIES) break;
    pending.delete(patientId);
  }
}

export function rememberRegistrationAccessCode(
  patientId: number,
  issuedByUserId: number,
  code: string,
  ttlMs = DEFAULT_TTL_MS,
): void {
  if (!Number.isFinite(patientId) || patientId <= 0) return;
  if (!code || typeof code !== "string") return;
  sweepExpired();
  // Replacing an entry invalidates any previous pending code for this patient.
  pending.set(patientId, {
    code,
    issuedByUserId,
    expiresAt: Date.now() + ttlMs,
    sendInFlight: false,
  });
  evictIfNeeded();
}

export function peekRegistrationAccessCode(patientId: number): string | null {
  sweepExpired();
  const row = pending.get(patientId);
  if (!row) return null;
  if (Date.now() > row.expiresAt) {
    if (!row.sendInFlight) pending.delete(patientId);
    return null;
  }
  return row.code;
}

export type BeginSendResult =
  | { ok: true; code: string }
  | { ok: false; reason: "unavailable" | "in_flight" };

/**
 * Atomically claims the pending code for a send attempt within this process.
 * Call endRegistrationAccessCodeSend when SMTP finishes (accepted or failed).
 */
export function beginRegistrationAccessCodeSend(patientId: number): BeginSendResult {
  sweepExpired();
  const row = pending.get(patientId);
  if (!row) return { ok: false, reason: "unavailable" };
  if (Date.now() > row.expiresAt) {
    if (!row.sendInFlight) pending.delete(patientId);
    return { ok: false, reason: "unavailable" };
  }
  if (row.sendInFlight) return { ok: false, reason: "in_flight" };
  row.sendInFlight = true;
  return { ok: true, code: row.code };
}

export function endRegistrationAccessCodeSend(
  patientId: number,
  _outcome: "accepted" | "failed",
): void {
  const row = pending.get(patientId);
  if (!row) return;
  row.sendInFlight = false;
  // Keep code until TTL so staff can retry after SMTP failure or uncertain timeout.
  if (Date.now() > row.expiresAt) {
    pending.delete(patientId);
  }
}

export function clearRegistrationAccessCode(patientId: number): void {
  pending.delete(patientId);
}

/** Test-only helpers */
export function __resetRegistrationAccessCodeCacheForTests(): void {
  pending.clear();
}

export function __registrationAccessCodeCacheSizeForTests(): number {
  sweepExpired();
  return pending.size;
}

export function __forceExpireRegistrationAccessCodeForTests(patientId: number): void {
  const row = pending.get(patientId);
  if (!row) return;
  row.expiresAt = Date.now() - 1;
  row.sendInFlight = false;
  pending.delete(patientId);
}
