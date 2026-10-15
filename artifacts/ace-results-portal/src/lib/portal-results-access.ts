const STORAGE_PREFIX = "ace_portal_results_access_code:";
const LEGACY_SESSION_KEY = "ace_portal_results_access_code";

/** In-memory only. The diagnostic access code is never written to browser storage. */
const memoryCodes = new Map<string, string>();

function currentPatientHisId(): string | null {
  try {
    const patient = JSON.parse(sessionStorage.getItem("ace_portal_patient") || "null") as {
      patientHisId?: string;
    } | null;
    const hisId = patient?.patientHisId?.trim();
    return hisId || null;
  } catch {
    return null;
  }
}

function storageKey(patientHisId?: string | null): string | null {
  const hisId = patientHisId?.trim() || currentPatientHisId();
  return hisId ? `${STORAGE_PREFIX}${hisId}` : null;
}

function forgetPersistedCode(patientHisId?: string | null): void {
  try {
    const key = storageKey(patientHisId);
    if (key) localStorage.removeItem(key);
    sessionStorage.removeItem(LEGACY_SESSION_KEY);
  } catch {
    /* storage may be blocked */
  }
}

/**
 * Remembered only in this tab's memory after a successful results unlock.
 * A reload asks for the access code again. Browser storage is never used.
 */
export function getStoredPortalResultsAccessCode(patientHisId?: string | null): string | null {
  forgetPersistedCode(patientHisId);
  const key = storageKey(patientHisId);
  if (!key) return null;
  return memoryCodes.get(key) ?? null;
}

export function setStoredPortalResultsAccessCode(code: string, patientHisId?: string | null): void {
  const key = storageKey(patientHisId);
  if (!key) return;
  memoryCodes.set(key, code.trim());
  forgetPersistedCode(patientHisId);
}

export function clearStoredPortalResultsAccessCode(patientHisId?: string | null): void {
  const key = storageKey(patientHisId);
  if (key) memoryCodes.delete(key);
  else memoryCodes.clear();
  forgetPersistedCode(patientHisId);
}

/** Clear unlock cache when the server rejects the code (admin issued a replacement). */
export function clearStoredPortalResultsAccessCodeOnLock(): void {
  clearStoredPortalResultsAccessCode();
}

export async function unlockPortalResults(accessCode: string): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch("/api/portal/verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionStorage.getItem("ace_portal_token") ?? ""}`,
    },
    body: JSON.stringify({ accessCode: accessCode.trim() }),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string; unlocked?: boolean };
  if (!response.ok || data.unlocked !== true) {
    return { ok: false, error: data.error ?? "Invalid access code." };
  }
  setStoredPortalResultsAccessCode(accessCode);
  return { ok: true };
}
