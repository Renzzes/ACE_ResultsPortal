import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ACCESS_TOKEN_KEY,
  PORTAL_TOKEN_KEY,
  SESSION_PUBLIC_ID_KEY,
  USER_PROFILE_KEY,
  clearTabAuth,
  forgetSharedAuthStorage,
  persistEmployeeTabSession,
  persistPatientTabSession,
  portalActionForHttpStatus,
  readSessionPublicId,
  sessionLogoutPath,
  sessionRefreshPath,
  shouldApplyAuthBootstrap,
  userWithAuthoritativeRole,
  type TabSessionStore,
} from "../../artifacts/ace-results-portal/src/lib/workflow-stability.ts";

function memory(): TabSessionStore & { dump(): Record<string, string> } {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    dump: () => Object.fromEntries(values),
  };
}

const appSource = readFileSync(new URL("../../artifacts/ace-results-portal/src/App.tsx", import.meta.url), "utf8");
const authSource = readFileSync(new URL("../../artifacts/ace-results-portal/src/lib/auth.tsx", import.meta.url), "utf8");
const accessSource = readFileSync(new URL("../../artifacts/ace-results-portal/src/pages/access.tsx", import.meta.url), "utf8");

test("login stores the access token and session id in the tab store and not a refresh secret", () => {
  const tab = memory();
  const shared = memory();
  shared.setItem("ace-doctor-theme", "dark");
  shared.setItem("ace_refresh_token", "old-secret");
  persistEmployeeTabSession(tab, {
    user: { role: "laboratory", username: "lab" },
    accessToken: "access-a",
    sessionPublicId: "public-id-admin-tab-a1",
  });
  forgetSharedAuthStorage(shared);
  assert.equal(tab.getItem(ACCESS_TOKEN_KEY), "access-a");
  assert.equal(tab.getItem(SESSION_PUBLIC_ID_KEY), "public-id-admin-tab-a1");
  assert.equal(tab.getItem("ace_refresh_token"), null);
  assert.equal(shared.getItem("ace_access_token"), null);
  assert.equal(shared.getItem("ace_refresh_token"), null);
  assert.equal(shared.getItem("ace-doctor-theme"), "dark");
});

test("refresh and logout use the current tab session id", () => {
  const publicId = "public-id-staff-tab-b1";
  assert.equal(sessionRefreshPath(publicId), `/api/auth/session/${publicId}/refresh`);
  assert.equal(sessionLogoutPath(publicId), `/api/auth/session/${publicId}/logout`);
  assert.equal(appSource.includes("/api/auth/refresh"), false);
  assert.equal(appSource.includes("ace_refresh_token"), false);
  assert.match(appSource, /sessionRefreshPath/);
  assert.match(authSource, /sessionLogoutPath/);
  assert.equal(authSource.includes("ace_refresh_token"), false);
  assert.equal(accessSource.includes("data.refreshToken"), false);
});

test("logout clears only the current tab authentication keys", () => {
  const tab = memory();
  const other = memory();
  const shared = memory();
  shared.setItem("ace-doctor-theme", "dark");
  persistEmployeeTabSession(tab, {
    user: { role: "laboratory" },
    accessToken: "access-b",
    sessionPublicId: "public-id-staff-tab-b2",
  });
  persistEmployeeTabSession(other, {
    user: { role: "super_admin" },
    accessToken: "access-a",
    sessionPublicId: "public-id-admin-tab-a2",
  });
  tab.setItem("unrelated-tab-note", "keep");
  clearTabAuth(tab);
  assert.equal(tab.getItem(ACCESS_TOKEN_KEY), null);
  assert.equal(readSessionPublicId(tab), null);
  assert.equal(tab.getItem("unrelated-tab-note"), "keep");
  assert.equal(other.getItem(ACCESS_TOKEN_KEY), "access-a");
  assert.equal(other.getItem(SESSION_PUBLIC_ID_KEY), "public-id-admin-tab-a2");
  assert.equal(shared.getItem("ace-doctor-theme"), "dark");
});

test("separate tab stores keep admin, staff, doctor, and patient sessions", () => {
  const admin = memory();
  const staff = memory();
  const doctor = memory();
  const patient = memory();
  persistEmployeeTabSession(admin, {
    user: { role: "super_admin" },
    accessToken: "admin-token",
    sessionPublicId: "sid-admin-000000000000",
  });
  persistEmployeeTabSession(staff, {
    user: { role: "laboratory" },
    accessToken: "staff-token",
    sessionPublicId: "sid-staff-000000000000",
  });
  persistEmployeeTabSession(doctor, {
    user: { role: "physician" },
    accessToken: "doctor-token",
    sessionPublicId: "sid-doctor-00000000000",
  });
  persistPatientTabSession(patient, {
    patient: { patientHisId: "1240" },
    accessToken: "patient-token",
    sessionPublicId: "sid-patient-0000000000",
  });
  clearTabAuth(staff);
  assert.equal(admin.getItem(ACCESS_TOKEN_KEY), "admin-token");
  assert.equal(doctor.getItem(ACCESS_TOKEN_KEY), "doctor-token");
  assert.equal(patient.getItem(PORTAL_TOKEN_KEY), "patient-token");
  assert.equal(patient.getItem(ACCESS_TOKEN_KEY), null);
  assert.equal(sessionRefreshPath(readSessionPublicId(patient)!), "/api/auth/session/sid-patient-0000000000/refresh");
  assert.equal(staff.getItem(ACCESS_TOKEN_KEY), null);
});

test("a second login replaces only that tab", () => {
  const first = memory();
  const second = memory();
  persistEmployeeTabSession(first, {
    user: { role: "super_admin" },
    accessToken: "admin-token",
    sessionPublicId: "sid-admin-000000000000",
  });
  persistEmployeeTabSession(second, {
    user: { role: "physician" },
    accessToken: "doctor-token",
    sessionPublicId: "sid-doctor-00000000000",
  });
  assert.equal(first.getItem(SESSION_PUBLIC_ID_KEY), "sid-admin-000000000000");
  persistPatientTabSession(second, {
    patient: { patientHisId: "1240" },
    accessToken: "patient-token",
    sessionPublicId: "sid-patient-0000000000",
  });
  assert.equal(second.getItem(ACCESS_TOKEN_KEY), null);
  assert.equal(second.getItem(PORTAL_TOKEN_KEY), "patient-token");
  assert.equal(first.getItem(ACCESS_TOKEN_KEY), "admin-token");
});

test("401 recovers the current session and 403 does not", () => {
  assert.equal(portalActionForHttpStatus(401), "recover-session");
  assert.equal(portalActionForHttpStatus(403), "stay");
});

test("a stale bootstrap cannot replace a newer tab session", () => {
  assert.equal(
    shouldApplyAuthBootstrap({
      cancelled: false,
      epochAtStart: 1,
      epochNow: 2,
      tokenAtStart: "old",
      tokenNow: "new",
      sessionAtStart: "sid-old",
      sessionNow: "sid-new",
    }),
    false,
  );
  assert.equal(
    shouldApplyAuthBootstrap({
      cancelled: false,
      epochAtStart: 4,
      epochNow: 4,
      tokenAtStart: "same",
      tokenNow: "same",
      sessionAtStart: "sid-same",
      sessionNow: "sid-same",
    }),
    true,
  );
});

test("stored profile role cannot override the access token role", () => {
  const user = userWithAuthoritativeRole({ role: "super_admin", username: "lab" }, tokenWithRole("laboratory"));
  assert.equal(user?.role, "laboratory");
});

function tokenWithRole(role: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ role, type: "access" })).toString("base64url");
  return `${header}.${body}.sig`;
}

test("employee profile key remains display state beside the access token", () => {
  const tab = memory();
  persistEmployeeTabSession(tab, {
    user: { role: "super_admin" },
    accessToken: tokenWithRole("laboratory"),
    sessionPublicId: "sid-staff-000000000000",
  });
  const stored = JSON.parse(tab.getItem(USER_PROFILE_KEY) ?? "null") as { role: string };
  const corrected = userWithAuthoritativeRole(stored, tab.getItem(ACCESS_TOKEN_KEY));
  assert.equal(stored.role, "super_admin");
  assert.equal(corrected?.role, "laboratory");
});
