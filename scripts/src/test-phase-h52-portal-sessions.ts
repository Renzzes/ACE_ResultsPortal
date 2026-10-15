import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
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
const staffUsername = `h52-staff-${stamp}`;
const staffPassword = `H52Staff${stamp}a!`;
const portalPassword = `H52Portal${stamp}a!`;
const portalHisId = `H52-${stamp}`;
const portalLastName = "H52Patient";
let staffUserId = 0;
let portalUserId = 0;
let portalPatientId = 0;
const createdPublicIds: string[] = [];
let legacyRows: Array<{ id: number; revokedAt: string | null }> = [];

type LoginBody = {
  accessToken?: string;
  refreshToken?: string;
  sessionPublicId?: string;
  error?: string;
  user?: { id?: number; role?: string; username?: string };
  sessionToken?: string;
  patient?: { id?: number };
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
  const data = (await response.json().catch(() => ({}))) as { error?: string; role?: string };
  return { status: response.status, data };
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
      SELECT public_id, portal, refresh_token_hash, revoked_at, last_used_at, user_id
      FROM dbo.auth_sessions
      WHERE public_id = @publicId
    `);
  return result.recordset[0] as
    | {
        public_id: string;
        portal: string | null;
        refresh_token_hash: string;
        revoked_at: Date | null;
        last_used_at: Date | null;
        user_id: number;
      }
    | undefined;
}

async function login(portal: "admin" | "staff" | "doctor" | "patient", username: string, password: string) {
  const result = await post("/api/auth/login", { username, password, portal });
  assert.equal(result.status, 200, result.data.error ?? `login ${portal} failed`);
  assert.equal(typeof result.data.accessToken, "string");
  assert.equal(typeof result.data.sessionPublicId, "string");
  assert.equal(result.data.sessionPublicId?.length, 22);
  createdPublicIds.push(result.data.sessionPublicId!);
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
    firstName: "H52",
    lastName: "Staff",
    email: null,
    role: "laboratory",
  });
  staffUserId = staff.id;

  const portalHash = await hashPassword(portalPassword);
  const portalUser = await usersRepo.insertUser({
    username: `patient:${portalHisId}`,
    passwordHash: portalHash,
    firstName: "H52",
    lastName: portalLastName,
    email: null,
    role: PORTAL_USER_ROLE,
  });
  portalUserId = portalUser.id;
  const patient = await patientsRepo.insertPatient({
    patientHisId: portalHisId,
    lastName: portalLastName,
    firstName: "H52",
    middleName: null,
    dateOfBirth: "1990-01-01",
    mobileNumber: null,
    email: null,
    accessCodeHash: portalHash,
    createdById: null,
    portalUserId: portalUser.id,
  });
  portalPatientId = patient.id;

  const pool = await getPool();
  const rows = await pool.request().query(`
    SELECT id, revoked_at
    FROM dbo.auth_sessions
    WHERE public_id IS NULL AND portal IS NULL
  `);
  legacyRows = (rows.recordset as Array<{ id: number; revoked_at: Date | null }>).map((row) => ({
    id: Number(row.id),
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
  }));
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
    if (legacyRows.length > 0) {
      const again = await pool.request().query(`
        SELECT id, public_id, portal, revoked_at
        FROM dbo.auth_sessions
        WHERE public_id IS NULL AND portal IS NULL
      `);
      const byId = new Map(
        (again.recordset as Array<{ id: number; public_id: string | null; portal: string | null; revoked_at: Date | null }>).map(
          (row) => [Number(row.id), row],
        ),
      );
      for (const legacy of legacyRows) {
        const row = byId.get(legacy.id);
        assert.ok(row, `legacy session ${legacy.id} disappeared`);
        assert.equal(row.public_id, null);
        assert.equal(row.portal, null);
        const revokedAt = row.revoked_at ? new Date(row.revoked_at).toISOString() : null;
        assert.equal(revokedAt, legacy.revokedAt, `legacy session ${legacy.id} was revoked during H.5.2`);
      }
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

test("login rejects an unknown portal channel", async () => {
  const username = process.env.ADMIN_BOOTSTRAP_USERNAME || "admin";
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  assert.ok(password, "ADMIN_BOOTSTRAP_PASSWORD is required");
  const missing = await post("/api/auth/login", { username, password });
  assert.equal(missing.status, 400);
  const unknown = await post("/api/auth/login", { username, password, portal: "super_admin" });
  assert.equal(unknown.status, 400);
});

test("new login creates one independent session and does not change the role", async () => {
  const username = process.env.ADMIN_BOOTSTRAP_USERNAME || "admin";
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  assert.ok(password, "ADMIN_BOOTSTRAP_PASSWORD is required");
  const channels = ["admin", "staff", "doctor", "patient"] as const;
  for (const portal of channels) {
    const result = await login(portal, username, password);
    const payload = decodeJwt(result.data.accessToken!);
    assert.equal(payload.sid, result.data.sessionPublicId);
    assert.equal(payload.type, "access");
    assert.equal(payload.role, "super_admin");
    assert.equal(result.data.user?.role, "super_admin");
    const row = await sessionRow(result.data.sessionPublicId!);
    assert.ok(row);
    assert.equal(String(row.public_id).trim().length, 22);
    assert.equal(row.portal, portal);
    assert.equal(row.revoked_at, null);
    assert.equal(row.refresh_token_hash.trim().length, 64);
    assert.equal(result.data.refreshToken, undefined);
    const cookieName = `ace_rt_${result.data.sessionPublicId}`;
    const cookie = cookiePair(result.response, cookieName);
    assert.notEqual(row.refresh_token_hash.trim(), cookie?.value);
    assert.ok(cookie, "session cookie missing");
    assert.match(cookie.header, /HttpOnly/i);
    assert.match(cookie.header, /SameSite=Lax/i);
    assert.match(cookie.header, /Path=\/api\/auth/i);
    assert.equal(/Secure/i.test(cookie.header), process.env.NODE_ENV === "production");
    const legacy = cookiePair(result.response, "ace_refresh_token");
    assert.equal(legacy, undefined);
  }
});

test("refresh rotates the secret, keeps sid, and rejects the previous secret", async () => {
  const username = process.env.ADMIN_BOOTSTRAP_USERNAME || "admin";
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  assert.ok(password, "ADMIN_BOOTSTRAP_PASSWORD is required");
  const result = await login("staff", username, password);
  const publicId = result.data.sessionPublicId!;
  const firstCookie = cookiePair(result.response, `ace_rt_${publicId}`);
  assert.ok(firstCookie, "session cookie missing");
  const firstSecret = firstCookie.value;
  const before = await sessionRow(publicId);
  assert.ok(before);
  const firstHash = before.refresh_token_hash.trim();

  const refreshed = await post(
    `/api/auth/session/${publicId}/refresh`,
    {},
    undefined,
    `ace_rt_${publicId}=${firstSecret}`,
  );
  assert.equal(refreshed.status, 200, refreshed.data.error ?? "refresh failed");
  assert.equal(refreshed.data.sessionPublicId, publicId);
  const nextPayload = decodeJwt(refreshed.data.accessToken!);
  assert.equal(nextPayload.sid, publicId);
  assert.equal(nextPayload.role, "super_admin");
  const afterRefresh = await sessionRow(publicId);
  assert.ok(afterRefresh);
  assert.notEqual(afterRefresh.refresh_token_hash.trim(), firstHash);
  assert.ok(afterRefresh.last_used_at);
  assert.equal(String(afterRefresh.public_id).trim(), publicId);
  const nextCookie = cookiePair(refreshed.response, `ace_rt_${publicId}`);
  assert.ok(nextCookie);

  const reused = await post(
    `/api/auth/session/${publicId}/refresh`,
    {},
    undefined,
    `ace_rt_${publicId}=${firstSecret}`,
  );
  assert.equal(reused.status, 401);

  const rotated = await post(
    `/api/auth/session/${publicId}/refresh`,
    {},
    undefined,
    `ace_rt_${publicId}=${nextCookie.value}`,
  );
  assert.equal(rotated.status, 200, rotated.data.error ?? "rotated refresh failed");
  assert.equal(decodeJwt(rotated.data.accessToken!).sid, publicId);
});

test("logout revokes only the addressed session", async () => {
  const username = process.env.ADMIN_BOOTSTRAP_USERNAME || "admin";
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  assert.ok(password, "ADMIN_BOOTSTRAP_PASSWORD is required");
  const admin = await login("admin", username, password);
  const staff = await login("staff", username, password);
  const doctor = await login("doctor", username, password);
  const logout = await post(
    `/api/auth/session/${staff.data.sessionPublicId}/logout`,
    {},
    staff.data.accessToken,
  );
  assert.equal(logout.status, 200, logout.data.error ?? "logout failed");
  const staffRow = await sessionRow(staff.data.sessionPublicId!);
  const adminRow = await sessionRow(admin.data.sessionPublicId!);
  const doctorRow = await sessionRow(doctor.data.sessionPublicId!);
  assert.ok(staffRow?.revoked_at);
  assert.equal(adminRow?.revoked_at, null);
  assert.equal(doctorRow?.revoked_at, null);
  const me = await get("/api/auth/me", staff.data.accessToken!);
  assert.equal(me.status, 401);
});

test("a user cannot revoke another user's session", async () => {
  const adminUser = process.env.ADMIN_BOOTSTRAP_USERNAME || "admin";
  const adminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  assert.ok(adminPassword, "ADMIN_BOOTSTRAP_PASSWORD is required");
  const admin = await login("admin", adminUser, adminPassword);
  const staff = await login("staff", staffUsername, staffPassword);
  const attack = await post(
    `/api/auth/session/${admin.data.sessionPublicId}/logout`,
    {},
    staff.data.accessToken,
  );
  assert.equal(attack.status, 401);
  const adminRow = await sessionRow(admin.data.sessionPublicId!);
  assert.equal(adminRow?.revoked_at, null);
  assert.notEqual(adminRow?.user_id, (await sessionRow(staff.data.sessionPublicId!))?.user_id);
});

test("expired and missing sessions return 401", async () => {
  const username = process.env.ADMIN_BOOTSTRAP_USERNAME || "admin";
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  assert.ok(password, "ADMIN_BOOTSTRAP_PASSWORD is required");
  const result = await login("doctor", username, password);
  const pool = await getPool();
  await pool
    .request()
    .input("publicId", sql.Char(22), result.data.sessionPublicId)
    .query(`
      UPDATE dbo.auth_sessions
      SET expires_at = DATEADD(minute, -1, SYSDATETIMEOFFSET())
      WHERE public_id = @publicId
    `);
  const expired = await get("/api/auth/me", result.data.accessToken!);
  assert.equal(expired.status, 401);

  const missingSid = randomBytes(16).toString("base64url");
  const missingToken = signAccessToken({
    userId: result.data.user?.id ?? 1,
    username,
    role: "super_admin",
    sid: missingSid,
  });
  const missing = await get("/api/auth/me", missingToken);
  assert.equal(missing.status, 401);
});

test("patient login creates a patient session with sid", async () => {
  const result = await post("/api/portal/login", {
    identifier: portalHisId,
    lastName: portalLastName,
    password: portalPassword,
  });
  assert.equal(result.status, 200, result.data.error ?? "patient login failed");
  assert.equal(typeof result.data.sessionToken, "string");
  assert.equal(result.data.sessionPublicId?.length, 22);
  createdPublicIds.push(result.data.sessionPublicId!);
  const payload = decodeJwt(result.data.sessionToken!);
  assert.equal(payload.type, "portal");
  assert.equal(payload.sid, result.data.sessionPublicId);
  assert.equal(payload.role, undefined);
  const row = await sessionRow(result.data.sessionPublicId!);
  assert.ok(row);
  assert.equal(row.portal, "patient");
  assert.equal(row.revoked_at, null);
  assert.equal(row.refresh_token_hash.trim().length, 64);
  const cookie = cookiePair(result.response, `ace_rt_${result.data.sessionPublicId}`);
  assert.ok(cookie);
  assert.match(cookie.header, /HttpOnly/i);
});
