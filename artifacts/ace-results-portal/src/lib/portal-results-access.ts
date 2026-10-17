const STORAGE_PREFIX = "ace_portal_results_access_code:";
const LEGACY_SESSION_KEY = "ace_portal_results_access_code";

/** In-memory only. Document codes are never written to browser storage. */
const memoryCodesByResult = new Map<number, string>();
/** @deprecated patient-wide key; cleared on use */
const memoryLegacy = new Map<string, string>();

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

export function getStoredPortalResultAccessCode(resultId: number): string | null {
  forgetPersistedCode();
  return memoryCodesByResult.get(resultId) ?? null;
}

export function setStoredPortalResultAccessCode(resultId: number, code: string): void {
  memoryCodesByResult.set(resultId, code.trim());
  forgetPersistedCode();
}

export function clearStoredPortalResultAccessCode(resultId?: number): void {
  if (resultId != null) memoryCodesByResult.delete(resultId);
  else memoryCodesByResult.clear();
  forgetPersistedCode();
}

/** @deprecated Patient-wide unlock is retired. */
export function getStoredPortalResultsAccessCode(patientHisId?: string | null): string | null {
  forgetPersistedCode(patientHisId);
  const key = storageKey(patientHisId);
  if (!key) return null;
  return memoryLegacy.get(key) ?? null;
}

/** @deprecated */
export function setStoredPortalResultsAccessCode(code: string, patientHisId?: string | null): void {
  const key = storageKey(patientHisId);
  if (!key) return;
  memoryLegacy.set(key, code.trim());
  forgetPersistedCode(patientHisId);
}

export function clearStoredPortalResultsAccessCode(patientHisId?: string | null): void {
  const key = storageKey(patientHisId);
  if (key) memoryLegacy.delete(key);
  else memoryLegacy.clear();
  memoryCodesByResult.clear();
  forgetPersistedCode(patientHisId);
}

export function clearStoredPortalResultsAccessCodeOnLock(): void {
  clearStoredPortalResultsAccessCode();
}

export async function unlockPortalResult(
  resultId: number,
  accessCode: string,
): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch("/api/portal/verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionStorage.getItem("ace_portal_token") ?? ""}`,
    },
    body: JSON.stringify({ accessCode: accessCode.trim(), resultId }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    unlocked?: boolean;
    resultId?: number;
  };
  if (!response.ok || data.unlocked !== true) {
    return { ok: false, error: data.error ?? "Invalid access code." };
  }
  setStoredPortalResultAccessCode(resultId, accessCode);
  return { ok: true };
}

/** @deprecated Use unlockPortalResult(resultId, code). */
export async function unlockPortalResults(accessCode: string): Promise<{ ok: boolean; error?: string }> {
  void accessCode;
  return { ok: false, error: "Select a document to unlock." };
}

/** Which result's code customFetch should send on the next portal download. */
let activeDownloadResultId: number | null = null;

export function beginPortalResultDownload(resultId: number): void {
  activeDownloadResultId = resultId;
}

export function endPortalResultDownload(): void {
  activeDownloadResultId = null;
}

export function getPortalAccessCodeForRequest(): string | null {
  if (activeDownloadResultId != null) {
    return getStoredPortalResultAccessCode(activeDownloadResultId);
  }
  return null;
}
