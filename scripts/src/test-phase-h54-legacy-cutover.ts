import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  closePool,
  getPool,
  initDb,
  loadDbConfig,
  loadRootEnv,
  patientsRepo,
  sql,
  usersRepo,
  PORTAL_USER_ROLE,
} from "@workspace/db";
import app from "../../artifacts/api-server/src/app.ts";
import { hashPassword, signAccessToken } from "../../artifacts/api-server/src/lib/auth.ts";

loadRootEnv();

/** Ephemeral in-process API — do not require a separately started PORT=5000 server. */
let API = "";
let liveServer: Server | undefined;
const stamp = Date.now();
const staffUsername = `h54-staff-${stamp}`;
const staffPassword = `H54Staff${stamp}a!`;
const portalPassword = `H54Portal${stamp}a!`;
const portalHisId = `H54-${stamp}`;
const portalLastName = "H54Patient";
let staffUserId = 0;
let portalUserId = 0;
let portalPatientId = 0;
const createdPublicIds: string[] = [];
const revokeSql = readFileSync(
  new URL("../../docs/migration/sql/015_auth_sessions_revoke_legacy.sql", import.meta.url),
  "utf8",
);

type LoginBody = {
  accessToken?: string;
  refreshToken?: string;
  sessionPublicId?: string;
  sessionToken?: string;
  error?: string;
  user?: { id?: number; role?: string; username?: string };
};

function decodeJwt(token: string): Record<string, unknown> {
  const part = token.split(".")[1];
  assert.ok(part, "JWT payload missing");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

async function post(path: string, body: unknown, token?: string, cookie?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as LoginBody;
  return { status: response.status, data, response };
}

async function get(path: string, token: string) {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: response.status };
}

function cookiePair(response: Response, name: string): { value: string; header: string } | undefined {
  const lines = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const header = lines.find((line) => line.startsWith(`${name}=`));
  if (!header) return undefined;
  const value = header.slice(name.length + 1).split(";")[0] ?? "";
  return { value, header };
}

async function sessionRow(publicId: string) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("publicId", sql.Char(22), publicId)
    .query(`
      SELECT public_id, portal, revoked_at, user_id
      FROM dbo.auth_sessions
      WHERE public_id = @publicId
    `);
  return result.recordset[0] as
    | { public_id: string; portal: string | null; revoked_at: Date | null; user_id: number }
    | undefined;
}

async function login(portal: "admin" | "staff" | "doctor", username: string, password: string) {
  const result = await post("/api/auth/login", { username, password, portal });
  assert.equal(result.status, 200, result.data.error ?? `${portal} login failed`);
  assert.equal(result.data.refreshToken, undefined);
  assert.equal(result.data.sessionPublicId?.length, 22);
  createdPublicIds.push(result.data.sessionPublicId!);
  const legacy = cookiePair(result.response, "ace_refresh_token");
  assert.equal(legacy, undefined);
  const cookie = cookiePair(result.response, `ace_rt_${result.data.sessionPublicId}`);
  assert.ok(cookie, "session cookie missing");
  assert.match(cookie.header, /HttpOnly/i);
  assert.equal(cookie.value.length > 0, true);
  return result;
}

before(async () => {
  assert.equal(loadDbConfig().database, "ACE_ResultsPortal");
  await initDb();
  liveServer = app.listen(0);
  const address = liveServer.address() as AddressInfo;
  API = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${API}/api/healthz`);
  assert.equal(health.status, 200);

  const staffHash = await hashPassword(staffPassword);
  const staff = await usersRepo.insertUser({
    username: staffUsername,
    passwordHash: staffHash,
    firstName: "H54",
    lastName: "Staff",
    email: null,
    role: "laboratory",
  });
  staffUserId = staff.id;

  const portalHash = await hashPassword(portalPassword);
  const portalUser = await usersRepo.insertUser({
    username: `patient:${portalHisId}`,
    passwordHash: portalHash,
    firstName: "H54",
    lastName: portalLastName,
    email: null,
    role: PORTAL_USER_ROLE,
  });
  portalUserId = portalUser.id;
  const patient = await patientsRepo.insertPatient({
    patientHisId: portalHisId,
    lastName: portalLastName,
    firstName: "H54",
    middleName: null,
    dateOfBirth: "1990-01-01",
    mobileNumber: null,
    email: null,
    accessCodeHash: portalHash,
    createdById: null,
    portalUserId: portalUser.id,
  });
  portalPatientId = patient.id;
});

after(async () => {
  try {
    const pool = await getPool();
    for (const publicId of createdPublicIds) {
      await pool
        .request()
        .input("publicId", sql.Char(22), publicId)
        .query(`
          UPDATE dbo.auth_sessions
          SET revoked_at = COALESCE(revoked_at, SYSDATETIMEOFFSET())
          WHERE public_id = @publicId
        `);
    }
    if (portalPatientId > 0) {
      await pool.request().input("id", sql.Int, portalPatientId).query("DELETE FROM dbo.patients WHERE id = @id").catch(() => undefined);
    }
    for (const id of [portalUserId, staffUserId].filter((value) => value > 0)) {
      await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.auth_sessions WHERE user_id = @id").catch(() => undefined);
      await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.users WHERE id = @id").catch(() => undefined);
    }
  } finally {
    await new Promise<void>((resolve) => {
      if (!liveServer) {
        resolve();
        return;
      }
      liveServer.close(() => resolve());
    });
    await closePool();
  }
});

test("legacy revoke script changes only revoked_at on portal-null rows", () => {
  assert.match(revokeSql, /USE \[ACE_ResultsPortal\]/);
  assert.match(revokeSql, /UPDATE dbo\.auth_sessions/);
  assert.match(revokeSql, /SET revoked_at = SYSDATETIMEOFFSET\(\)/);
  assert.match(revokeSql, /WHERE portal IS NULL/);
  assert.match(revokeSql, /AND revoked_at IS NULL/);
  const executable = revokeSql.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(/\bDELETE\b/i.test(executable), false);
  for (const forbidden of ["dbo.users", "dbo.results", "dbo.result_reviews", "patient_departments", "LiveDB_ACE"]) {
    assert.equal(executable.includes(forbidden), false, forbidden);
  }
});

test("new sessions stay isolated and legacy auth routes are gone", async () => {
  const username = process.env.ADMIN_BOOTSTRAP_USERNAME || "admin";
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  assert.ok(password, "ADMIN_BOOTSTRAP_PASSWORD is required");

  const admin = await login("admin", username, password);
  const staff = await login("staff", staffUsername, staffPassword);
  const doctor = await login("doctor", username, password);
  for (const result of [admin, doctor]) {
    const payload = decodeJwt(result.data.accessToken!);
    assert.equal(payload.sid, result.data.sessionPublicId);
    assert.equal(payload.role, "super_admin");
    assert.equal(payload.type, "access");
  }
  const staffPayload = decodeJwt(staff.data.accessToken!);
  assert.equal(staffPayload.sid, staff.data.sessionPublicId);
  assert.notEqual(staffPayload.role, "staff");
  assert.equal(staffPayload.role, staff.data.user?.role);
  assert.equal((await sessionRow(admin.data.sessionPublicId!))?.portal, "admin");
  assert.equal((await sessionRow(staff.data.sessionPublicId!))?.portal, "staff");
  assert.equal((await sessionRow(doctor.data.sessionPublicId!))?.portal, "doctor");

  const adminCookie = cookiePair(admin.response, `ace_rt_${admin.data.sessionPublicId}`);
  assert.ok(adminCookie);
  const legacyRefresh = await post(
    "/api/auth/refresh",
    {},
    undefined,
    `ace_rt_${admin.data.sessionPublicId}=${adminCookie.value}`,
  );
  assert.equal(legacyRefresh.status, 404);
  const refreshed = await post(
    `/api/auth/session/${admin.data.sessionPublicId}/refresh`,
    {},
    undefined,
    `ace_rt_${admin.data.sessionPublicId}=${adminCookie.value}`,
  );
  assert.equal(refreshed.status, 200, refreshed.data.error ?? "session refresh failed");
  assert.equal(refreshed.data.refreshToken, undefined);
  assert.equal(decodeJwt(refreshed.data.accessToken!).role, "super_admin");

  const legacyLogout = await post("/api/auth/logout", {}, admin.data.accessToken);
  assert.equal(legacyLogout.status, 404);
  assert.equal((await sessionRow(admin.data.sessionPublicId!))?.revoked_at, null);
  assert.equal((await sessionRow(staff.data.sessionPublicId!))?.revoked_at, null);

  const logout = await post(
    `/api/auth/session/${staff.data.sessionPublicId}/logout`,
    {},
    staff.data.accessToken,
  );
  assert.equal(logout.status, 200, logout.data.error ?? "session logout failed");
  assert.ok((await sessionRow(staff.data.sessionPublicId!))?.revoked_at);
  assert.equal((await sessionRow(admin.data.sessionPublicId!))?.revoked_at, null);
  assert.equal((await get("/api/auth/me", staff.data.accessToken!)).status, 401);
  assert.equal((await get("/api/auth/me", refreshed.data.accessToken!)).status, 200);

  const doctorLogout = await post(
    `/api/auth/session/${doctor.data.sessionPublicId}/logout`,
    {},
    doctor.data.accessToken,
  );
  assert.equal(doctorLogout.status, 200);
  assert.equal((await get("/api/auth/me", doctor.data.accessToken!)).status, 401);

  const pool = await getPool();
  await pool
    .request()
    .input("publicId", sql.Char(22), admin.data.sessionPublicId)
    .query(`
      UPDATE dbo.auth_sessions
      SET expires_at = DATEADD(minute, -1, SYSDATETIMEOFFSET())
      WHERE public_id = @publicId
    `);
  assert.equal((await get("/api/auth/me", refreshed.data.accessToken!)).status, 401);

  const missing = signAccessToken({
    userId: admin.data.user?.id ?? 1,
    username,
    role: "super_admin",
    sid: "AAAAAAAAAAAAAAAAAAAAAA",
  });
  assert.equal((await get("/api/auth/me", missing)).status, 401);

  const patient = await post("/api/portal/login", {
    identifier: portalHisId,
    lastName: portalLastName,
    password: portalPassword,
  });
  assert.equal(patient.status, 200, patient.data.error ?? "patient login failed");
  assert.equal(patient.data.refreshToken, undefined);
  assert.equal(patient.data.sessionPublicId?.length, 22);
  createdPublicIds.push(patient.data.sessionPublicId!);
  const patientPayload = decodeJwt(patient.data.sessionToken!);
  assert.equal(patientPayload.type, "portal");
  assert.equal(patientPayload.sid, patient.data.sessionPublicId);
  assert.equal((await sessionRow(patient.data.sessionPublicId!))?.portal, "patient");
  const patientCookie = cookiePair(patient.response, `ace_rt_${patient.data.sessionPublicId}`);
  assert.ok(patientCookie);
  assert.match(patientCookie.header, /HttpOnly/i);
  assert.equal(cookiePair(patient.response, "ace_refresh_token"), undefined);
});

test("cutover left no active legacy session and did not touch clinical tables", async () => {
  const pool = await getPool();
  const dbName = await pool.request().query("SELECT DB_NAME() AS name");
  assert.equal(dbName.recordset[0]?.name, "ACE_ResultsPortal");

  const counts = await pool.request().query(`
    SELECT
      SUM(CASE WHEN portal IS NULL AND revoked_at IS NULL THEN 1 ELSE 0 END) AS active_legacy,
      SUM(CASE WHEN public_id IS NULL AND revoked_at IS NULL THEN 1 ELSE 0 END) AS active_null_public_id,
      SUM(CASE WHEN portal IS NOT NULL AND public_id IS NULL THEN 1 ELSE 0 END) AS new_missing_public_id,
      SUM(CASE WHEN portal IS NULL AND public_id IS NOT NULL THEN 1 ELSE 0 END) AS public_id_without_portal
    FROM dbo.auth_sessions
  `);
  const row = counts.recordset[0] as Record<string, number | null>;
  assert.equal(Number(row.active_legacy ?? 0), 0);
  assert.equal(Number(row.active_null_public_id ?? 0), 0);
  assert.equal(Number(row.new_missing_public_id ?? 0), 0);
  assert.equal(Number(row.public_id_without_portal ?? 0), 0);

  const duplicates = await pool.request().query(`
    SELECT COUNT(*) AS duplicate_groups
    FROM (
      SELECT public_id
      FROM dbo.auth_sessions
      WHERE public_id IS NOT NULL
      GROUP BY public_id
      HAVING COUNT(*) > 1
    ) d
  `);
  assert.equal(Number(duplicates.recordset[0]?.duplicate_groups ?? 0), 0);

  for (const table of ["dbo.users", "dbo.results", "dbo.result_reviews", "dbo.patient_departments", "dbo.departments", "dbo.role_permissions"]) {
    const marker = await pool.request().query(`SELECT COL_LENGTH(N'${table}', N'public_id') AS public_id_len`);
    assert.equal(marker.recordset[0]?.public_id_len, null, table);
  }
});
