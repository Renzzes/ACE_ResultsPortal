/** Pure Phase H workflow decisions. The server remains authoritative. */

const UNSAFE_RESET_ERROR = /password_hash|stack trace|\bat\s+\S+\.(?:ts|js):\d+|bcrypt|jwt|secret|refresh token/i;

export const SESSION_PUBLIC_ID_KEY = "ace_session_public_id";
export const ACCESS_TOKEN_KEY = "ace_access_token";
export const USER_PROFILE_KEY = "ace_user";
export const PORTAL_TOKEN_KEY = "ace_portal_token";
export const PORTAL_PROFILE_KEY = "ace_portal_patient";

/** Current-tab employee session. The refresh secret is not one of these keys. */
export const STAFF_SESSION_KEYS = [USER_PROFILE_KEY, ACCESS_TOKEN_KEY] as const;
/** Current-tab patient session. The refresh secret is not one of these keys. */
export const PORTAL_SESSION_KEYS = [PORTAL_PROFILE_KEY, PORTAL_TOKEN_KEY] as const;

export const TAB_AUTH_KEYS = [...STAFF_SESSION_KEYS, ...PORTAL_SESSION_KEYS, SESSION_PUBLIC_ID_KEY] as const;

/** Shared localStorage names from before H.5.3. New sessions must not write these. */
export const LEGACY_SHARED_AUTH_KEYS = [
  "ace_user",
  "ace_access_token",
  "ace_refresh_token",
  "ace_portal_patient",
  "ace_portal_token",
] as const;

export interface TabSessionStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readSessionPublicId(store: TabSessionStore): string | null {
  const value = store.getItem(SESSION_PUBLIC_ID_KEY);
  return value && value.trim() ? value : null;
}

export function sessionRefreshPath(sessionPublicId: string): string {
  return `/api/auth/session/${encodeURIComponent(sessionPublicId)}/refresh`;
}

export function sessionLogoutPath(sessionPublicId: string): string {
  return `/api/auth/session/${encodeURIComponent(sessionPublicId)}/logout`;
}

export function persistEmployeeTabSession(
  store: TabSessionStore,
  input: { user: unknown; accessToken: string; sessionPublicId: string },
): void {
  store.setItem(USER_PROFILE_KEY, JSON.stringify(input.user));
  store.setItem(ACCESS_TOKEN_KEY, input.accessToken);
  store.setItem(SESSION_PUBLIC_ID_KEY, input.sessionPublicId);
  store.removeItem(PORTAL_PROFILE_KEY);
  store.removeItem(PORTAL_TOKEN_KEY);
}

export function persistPatientTabSession(
  store: TabSessionStore,
  input: { patient: unknown; accessToken: string; sessionPublicId: string },
): void {
  store.setItem(PORTAL_PROFILE_KEY, JSON.stringify(input.patient));
  store.setItem(PORTAL_TOKEN_KEY, input.accessToken);
  store.setItem(SESSION_PUBLIC_ID_KEY, input.sessionPublicId);
  store.removeItem(USER_PROFILE_KEY);
  store.removeItem(ACCESS_TOKEN_KEY);
}

export function clearTabAuth(store: TabSessionStore): void {
  for (const key of TAB_AUTH_KEYS) store.removeItem(key);
}

/** Drops leftover shared credentials. Other localStorage keys stay. */
export function forgetSharedAuthStorage(store: TabSessionStore): void {
  for (const key of LEGACY_SHARED_AUTH_KEYS) store.removeItem(key);
}

export const STAFF_PORTAL_ROLES = ["medical_records", "laboratory", "radiology", "endoscopy"] as const;

export type RefreshOutcome = "none" | "rejected" | "network" | "refreshed";

export type RouteDecision =
  | { kind: "loading" }
  | { kind: "login"; to: string }
  | { kind: "redirect"; to: string }
  | { kind: "render" };

export function passwordResetErrorMessage(input: {
  status?: number;
  serverMessage?: string;
  submittedPassword?: string;
}): string {
  const fallback = "Could not reset password";
  if (input.status === 401) return "Your session has expired. Sign in again and retry.";
  if (input.status === 403) return "You are not allowed to reset this password.";
  if (input.status === 404) return "That account was not found.";
  const message = (input.serverMessage ?? "").trim();
  const requirementFallback = "The new password does not meet the requirements.";
  if (!message || message.length > 180 || UNSAFE_RESET_ERROR.test(message)) {
    return input.status === 400 ? requirementFallback : fallback;
  }
  if (
    input.submittedPassword &&
    input.submittedPassword.length >= 4 &&
    message.includes(input.submittedPassword)
  ) {
    return input.status === 400 ? requirementFallback : fallback;
  }
  return message;
}

export function registrationUploadPath(patientId: number): string {
  if (!Number.isInteger(patientId) || patientId <= 0) {
    throw new Error("A server-created patient id is required");
  }
  return `/results/upload?patientId=${patientId}`;
}

export function patientPrefillId(raw: string | null | undefined): number | null {
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export function uploadSelectionFromPatient(patient: {
  id: number;
  patientHisId: string;
  lastName: string;
  firstName: string;
}): { id: number; patientHisId: string; name: string } {
  return {
    id: patient.id,
    patientHisId: patient.patientHisId,
    name: `${patient.lastName}, ${patient.firstName}`,
  };
}

export function nextAttendingAssignments(
  currentIds: readonly number[],
  physicianId: number,
): { ids: number[]; duplicate: boolean } {
  if (currentIds.includes(physicianId)) {
    return { ids: [...currentIds], duplicate: true };
  }
  return { ids: [...currentIds, physicianId], duplicate: false };
}

export function portalHomeForRole(role: string | null | undefined): string | null {
  if (role === "super_admin") return "/admin";
  if (role === "physician") return "/physician/overview";
  if (role === "patient") return "/portal/dashboard";
  if (role && (STAFF_PORTAL_ROLES as readonly string[]).includes(role)) return "/dashboard";
  return null;
}

/**
 * The access token is the credential the API will enforce.
 * A stored profile role must not override it.
 */
export function authoritativeRole(
  userRole: string | null | undefined,
  accessToken: string | null | undefined,
): string {
  const fromToken = roleFromAccessTokenPayload(accessToken);
  if (fromToken) return fromToken;
  return typeof userRole === "string" ? userRole : "";
}

export function userWithAuthoritativeRole<T extends { role?: unknown }>(
  user: T | null,
  accessToken: string | null | undefined,
): T | null {
  if (!user || typeof user !== "object") return user;
  const role = authoritativeRole(typeof user.role === "string" ? user.role : undefined, accessToken);
  if (!role || user.role === role) return user;
  return { ...user, role };
}

export function shouldApplyAuthBootstrap(input: {
  cancelled: boolean;
  epochAtStart: number;
  epochNow: number;
  tokenAtStart: string | null;
  tokenNow: string | null;
  sessionAtStart?: string | null;
  sessionNow?: string | null;
}): boolean {
  if (input.cancelled) return false;
  if (input.epochAtStart !== input.epochNow) return false;
  if (
    input.sessionAtStart !== undefined &&
    input.sessionNow !== undefined &&
    input.sessionAtStart !== input.sessionNow
  ) {
    return false;
  }
  return input.tokenAtStart === input.tokenNow;
}

/** 401 may recover the session. Any other status, including 403, stays on the current portal. */
export function portalActionForHttpStatus(status: number | undefined): "stay" | "recover-session" {
  if (status === 401) return "recover-session";
  return "stay";
}

export function mayRequestAdminOverview(role: string | null | undefined): boolean {
  return role === "super_admin";
}

export function mayRequestAuditOrArchive(role: string | null | undefined): boolean {
  return role === "super_admin" || role === "medical_records";
}

export function decideRoleRoute(input: {
  sessionReady: boolean;
  hasUser: boolean;
  role: string | null | undefined;
  allowedRoles: readonly string[];
  loginTo: string;
}): RouteDecision {
  if (!input.sessionReady) return { kind: "loading" };
  if (!input.hasUser) return { kind: "login", to: input.loginTo };
  const role = typeof input.role === "string" ? input.role : "";
  if (!role) return { kind: "login", to: "/login" };
  if (input.allowedRoles.includes(role)) return { kind: "render" };
  const home = portalHomeForRole(role);
  if (!home) return { kind: "login", to: "/login" };
  return { kind: "redirect", to: home };
}

export function shouldClearSessionAfterMeFailure(input: {
  status?: number;
  accessTokenStillPresent: boolean;
  refreshOutcome: RefreshOutcome;
  /** Role claim inside the bearer. A staff role must survive a 403. */
  tokenRole?: string | null;
}): boolean {
  if (input.status === 403) {
    // /api/auth/me returns 403 only when the bearer is a patient identity.
    // A staff, physician, or admin role must not be logged out or moved.
    if (input.tokenRole && input.tokenRole !== "patient") return false;
    return true;
  }
  if (input.status !== 401) return false;
  if (input.refreshOutcome === "network") return false;
  if (!input.accessTokenStillPresent) return true;
  return input.refreshOutcome === "rejected" || input.refreshOutcome === "refreshed";
}

export function roleFromAccessTokenPayload(token: string | null | undefined): string | undefined {
  if (!token) return undefined;
  const part = token.split(".")[1];
  if (!part) return undefined;
  try {
    const payload = JSON.parse(decodeBase64Url(part)) as { role?: unknown };
    return typeof payload.role === "string" && payload.role ? payload.role : undefined;
  } catch {
    return undefined;
  }
}

function decodeBase64Url(part: string): string {
  const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.length % 4 === 0 ? normalized : normalized + "=".repeat(4 - (normalized.length % 4));
  if (typeof globalThis.atob === "function") return globalThis.atob(padded);
  return Buffer.from(padded, "base64").toString("utf8");
}
