import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { authSessionsRepo, closePool, getPool, initDb, loadRootEnv, sql, usersRepo } from "@workspace/db";
import app from "../../artifacts/api-server/src/app.ts";
import { hashPassword, sessionRefreshCookieName } from "../../artifacts/api-server/src/lib/auth.ts";

loadRootEnv();

const PASSWORD = "AcctStat1!";
const stamp = Date.now();
const doctorUsername = `acctstat-d-${stamp}`;
const staffUsername = `acctstat-s-${stamp}`;

let server: Server;
let base = "";
let adminToken = "";
let doctorId = 0;
let staffId = 0;

async function json(path: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, init);
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, data, headers: response.headers };
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function login(username: string, portal: "admin" | "staff" | "doctor") {
  return json("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: portal === "admin" ? process.env.ADMIN_BOOTSTRAP_PASSWORD : PASSWORD, portal }),
  });
}

function refreshCookie(headers: Headers, sessionPublicId: string): string | null {
  const cookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const name = sessionRefreshCookieName(sessionPublicId);
  const raw = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  if (!raw) return null;
  return raw.split(";")[0] ?? null;
}

async function cleanup() {
  const ids = [doctorId, staffId].filter((id) => id > 0);
  if (ids.length === 0) return;
  const pool = await getPool();
  for (const id of ids) {
    await authSessionsRepo.revokeAllForUser(id);
    await pool
      .request()
      .input("id", sql.Int, id)
      .query("DELETE FROM dbo.auth_sessions WHERE user_id = @id");
  }
  await pool
    .request()
    .input("doctorName", sql.NVarChar(64), doctorUsername)
    .input("staffName", sql.NVarChar(64), staffUsername)
    .query(`
      DELETE FROM dbo.audit_logs
      WHERE user_id IN (${ids.join(",")})
         OR details LIKE '%' + @doctorName + '%'
         OR details LIKE '%' + @staffName + '%'
    `);
  for (const id of ids) {
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.users WHERE id = @id");
  }
}

test("account status setup", async () => {
  await initDb();
  server = app.listen(0);
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
  const adminUser = process.env.ADMIN_BOOTSTRAP_USERNAME || "admin";
  const admin = await login(adminUser, "admin");
  assert.equal(admin.status, 200);
  adminToken = String(admin.data.accessToken);
  const passwordHash = await hashPassword(PASSWORD);
  const doctor = await usersRepo.insertUser({
    username: doctorUsername,
    passwordHash,
    firstName: "Status",
    lastName: "Doctor",
    email: null,
    role: "physician",
  });
  const staff = await usersRepo.insertUser({
    username: staffUsername,
    passwordHash,
    firstName: "Status",
    lastName: "Staff",
    email: null,
    role: "medical_records",
  });
  doctorId = doctor.id;
  staffId = staff.id;
});

test("active doctor and staff can log in", async () => {
  const doctor = await login(doctorUsername, "doctor");
  const staff = await login(staffUsername, "staff");
  assert.equal(doctor.status, 200);
  assert.equal(typeof doctor.data.accessToken, "string");
  assert.equal(typeof doctor.data.sessionPublicId, "string");
  assert.equal(staff.status, 200);
  assert.notEqual(doctor.data.sessionPublicId, staff.data.sessionPublicId);
});

test("deactivating a logged-in doctor or staff rejects later access, refresh, and login", async () => {
  const doctor = await login(doctorUsername, "doctor");
  const staff = await login(staffUsername, "staff");
  assert.equal(doctor.status, 200);
  assert.equal(staff.status, 200);
  const doctorToken = String(doctor.data.accessToken);
  const staffToken = String(staff.data.accessToken);
  const doctorSid = String(doctor.data.sessionPublicId);
  const staffSid = String(staff.data.sessionPublicId);
  const doctorCookie = refreshCookie(doctor.headers, doctorSid);
  const staffCookie = refreshCookie(staff.headers, staffSid);
  assert.ok(doctorCookie);
  assert.ok(staffCookie);

  const doctorOff = await json(`/api/users/${doctorId}`, { method: "DELETE", headers: authHeaders(adminToken) });
  const staffOff = await json(`/api/users/${staffId}`, { method: "DELETE", headers: authHeaders(adminToken) });
  assert.equal(doctorOff.status, 200);
  assert.equal(staffOff.status, 200);
  assert.equal(doctorOff.data.isActive, false);
  assert.equal(staffOff.data.isActive, false);

  const doctorMe = await json("/api/auth/me", { headers: authHeaders(doctorToken) });
  const staffMe = await json("/api/auth/me", { headers: authHeaders(staffToken) });
  assert.equal(doctorMe.status, 401);
  assert.equal(staffMe.status, 401);

  const doctorRefresh = await json(`/api/auth/session/${doctorSid}/refresh`, {
    method: "POST",
    headers: { Cookie: doctorCookie },
  });
  const staffRefresh = await json(`/api/auth/session/${staffSid}/refresh`, {
    method: "POST",
    headers: { Cookie: staffCookie },
  });
  assert.equal(doctorRefresh.status, 401);
  assert.equal(staffRefresh.status, 401);
  assert.equal(typeof doctorRefresh.data.accessToken, "undefined");
  assert.equal(typeof staffRefresh.data.accessToken, "undefined");

  assert.equal((await login(doctorUsername, "doctor")).status, 401);
  assert.equal((await login(staffUsername, "staff")).status, 401);
});

test("reactivating allows a new login and does not create a session by itself", async () => {
  const before = await authSessionsRepo.listActiveSessions(200);
  const beforeIds = new Set(before.filter((row) => row.userId === doctorId || row.userId === staffId).map((row) => row.id));
  const doctorOn = await json(`/api/users/${doctorId}`, {
    method: "PATCH",
    headers: authHeaders(adminToken),
    body: JSON.stringify({ isActive: true }),
  });
  const staffOn = await json(`/api/users/${staffId}`, {
    method: "PATCH",
    headers: authHeaders(adminToken),
    body: JSON.stringify({ isActive: true }),
  });
  assert.equal(doctorOn.status, 200);
  assert.equal(staffOn.status, 200);
  assert.equal(doctorOn.data.isActive, true);
  assert.equal(staffOn.data.isActive, true);
  const after = await authSessionsRepo.listActiveSessions(200);
  const created = after.filter((row) => (row.userId === doctorId || row.userId === staffId) && !beforeIds.has(row.id));
  assert.equal(created.length, 0);
  assert.equal((await login(doctorUsername, "doctor")).status, 200);
  assert.equal((await login(staffUsername, "staff")).status, 200);
});

test("password reset does not reactivate an inactive account", async () => {
  await usersRepo.updateUser(doctorId, { isActive: false });
  const reset = await json(`/api/users/${doctorId}/reset-password`, {
    method: "POST",
    headers: authHeaders(adminToken),
    body: JSON.stringify({ newPassword: "AcctStat2!" }),
  });
  assert.equal(reset.status, 200);
  const doctor = await usersRepo.findUserById(doctorId);
  assert.equal(doctor?.isActive, false);
  const attempt = await json("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: doctorUsername, password: "AcctStat2!", portal: "doctor" }),
  });
  assert.equal(attempt.status, 401);
  await usersRepo.updateUser(doctorId, { isActive: true });
  await usersRepo.setUserPassword(doctorId, await hashPassword(PASSWORD), true);
});

test("a staff account cannot change account status", async () => {
  const staff = await login(staffUsername, "staff");
  assert.equal(staff.status, 200);
  const denied = await json(`/api/users/${doctorId}`, {
    method: "PATCH",
    headers: authHeaders(String(staff.data.accessToken)),
    body: JSON.stringify({ isActive: false }),
  });
  assert.equal(denied.status, 403);
  const doctor = await usersRepo.findUserById(doctorId);
  assert.equal(doctor?.isActive, true);
});

test("status changes are refused for accounts outside staff and doctor roles", async () => {
  const admin = await usersRepo.findUserByUsername(process.env.ADMIN_BOOTSTRAP_USERNAME || "admin");
  assert.ok(admin);
  const denied = await json(`/api/users/${admin.id}`, {
    method: "DELETE",
    headers: authHeaders(adminToken),
  });
  assert.equal(denied.status, 403);
  const again = await usersRepo.findUserById(admin.id);
  assert.equal(again?.isActive, true);
});

test("patient portal login and separate staff sessions stay unchanged", async () => {
  const portal = await json("/api/portal/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "NO-SUCH-PATIENT-999999", lastName: "NONE", password: PASSWORD }),
  });
  assert.equal(portal.status, 401);
  assert.equal("accessToken" in portal.data, false);

  const doctor = await login(doctorUsername, "doctor");
  const staff = await login(staffUsername, "staff");
  assert.equal(doctor.status, 200);
  assert.equal(staff.status, 200);
  const doctorSid = String(doctor.data.sessionPublicId);
  const logout = await json(`/api/auth/session/${doctorSid}/logout`, {
    method: "POST",
    headers: authHeaders(String(doctor.data.accessToken)),
  });
  assert.equal(logout.status, 200);
  const staffMe = await json("/api/auth/me", { headers: authHeaders(String(staff.data.accessToken)) });
  assert.equal(staffMe.status, 200);
});

after(async () => {
  await cleanup();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await closePool();
});
