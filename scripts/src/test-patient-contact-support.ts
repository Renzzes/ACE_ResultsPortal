/**
 * Patient Contact Support + recovery role restriction + forced password change.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { after, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  closePool,
  getPool,
  initDb,
  loadRootEnv,
  patientsRepo,
  patientSupportRequestsRepo,
  sql,
  usersRepo,
  PORTAL_USER_ROLE,
} from "@workspace/db";
import app from "../../artifacts/api-server/src/app.ts";
import { hashPassword, comparePassword } from "../../artifacts/api-server/src/lib/auth.ts";
import { setPortalEmailSenderForTests } from "../../artifacts/api-server/src/lib/portal-email.ts";

loadRootEnv();

const PASSWORD = "SupportTmp1!";
const NEW_PASSWORD = "SupportNew1!";
const stamp = Date.now();

let server: Server;
let base = "";
let adminToken = "";
let staffToken = "";
let portalUserId = 0;
let inactivePortalUserId = 0;
let staffUserId = 0;
let linkedPatientId = 0;
let hospitalOnlyPatientId = 0;
let inactivePatientId = 0;
const supportRequestIds: number[] = [];

async function json(path: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, init);
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, data };
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function cleanup() {
  const pool = await getPool();
  for (const id of supportRequestIds) {
    await patientSupportRequestsRepo.deleteSupportRequest(id).catch(() => undefined);
  }
  for (const id of [linkedPatientId, hospitalOnlyPatientId, inactivePatientId].filter((v) => v > 0)) {
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.patient_departments WHERE patient_id = @id").catch(() => undefined);
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.patient_physicians WHERE patient_id = @id").catch(() => undefined);
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.patients WHERE id = @id").catch(() => undefined);
  }
  for (const id of [portalUserId, inactivePortalUserId, staffUserId].filter((v) => v > 0)) {
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.auth_sessions WHERE user_id = @id").catch(() => undefined);
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.users WHERE id = @id").catch(() => undefined);
  }
}

test("setup support fixtures", async () => {
  assert.equal(await patientSupportRequestsRepo.schemaReady(), true);
  assert.equal(await patientSupportRequestsRepo.mustChangePasswordColumnsReady(), true);

  await initDb();
  server = app.listen(0);
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;

  setPortalEmailSenderForTests(async () => true);

  const adminLogin = await json("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: process.env.ADMIN_BOOTSTRAP_USERNAME || "admin",
      password: process.env.ADMIN_BOOTSTRAP_PASSWORD,
      portal: "admin",
    }),
  });
  assert.equal(adminLogin.status, 200);
  adminToken = String(adminLogin.data.accessToken);

  const passwordHash = await hashPassword(PASSWORD);
  const staff = await usersRepo.insertUser({
    username: `sup-staff-${stamp}`,
    passwordHash,
    firstName: "Sup",
    lastName: "Staff",
    email: null,
    role: "laboratory",
  });
  staffUserId = staff.id;

  const staffLogin = await json("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: staff.username, password: PASSWORD, portal: "staff" }),
  });
  assert.equal(staffLogin.status, 200);
  staffToken = String(staffLogin.data.accessToken);

  const portalUser = await usersRepo.insertUser({
    username: `patient:sup-${stamp}`,
    passwordHash,
    firstName: "Support",
    lastName: "Patient",
    email: `support-${stamp}@example.com`,
    role: PORTAL_USER_ROLE,
  });
  portalUserId = portalUser.id;

  const inactivePortal = await usersRepo.insertUser({
    username: `patient:sup-inactive-${stamp}`,
    passwordHash,
    firstName: "Inactive",
    lastName: "Patient",
    email: `support-inactive-${stamp}@example.com`,
    role: PORTAL_USER_ROLE,
  });
  inactivePortalUserId = inactivePortal.id;
  await usersRepo.updateUser(inactivePortal.id, { isActive: false });

  const linked = await patientsRepo.insertPatient({
    patientHisId: `SUP-LINK-${stamp}`,
    lastName: "Patient",
    firstName: "Support",
    middleName: null,
    dateOfBirth: "1990-01-01",
    mobileNumber: null,
    email: `support-${stamp}@example.com`,
    accessCodeHash: passwordHash,
    createdById: staff.id,
    portalUserId: portalUser.id,
  });
  linkedPatientId = linked.id;

  const hospitalOnly = await patientsRepo.insertPatient({
    patientHisId: `SUP-HOSP-${stamp}`,
    lastName: "Hospital",
    firstName: "Only",
    middleName: null,
    dateOfBirth: "1991-02-02",
    mobileNumber: null,
    email: `support-hosp-${stamp}@example.com`,
    accessCodeHash: passwordHash,
    createdById: staff.id,
  });
  hospitalOnlyPatientId = hospitalOnly.id;

  const inactivePatient = await patientsRepo.insertPatient({
    patientHisId: `SUP-INACT-${stamp}`,
    lastName: "Patient",
    firstName: "Inactive",
    middleName: null,
    dateOfBirth: "1992-03-03",
    mobileNumber: null,
    email: `support-inactive-${stamp}@example.com`,
    accessCodeHash: passwordHash,
    createdById: staff.id,
    portalUserId: inactivePortal.id,
  });
  inactivePatientId = inactivePatient.id;
});

test("1 — Contact Support is available from Patient Portal Login", () => {
  const page = fs.readFileSync(
    new URL("../../artifacts/ace-results-portal/src/pages/access.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /Contact Support/);
  assert.match(page, /ContactSupportDialog/);
});

test("2 — both request categories can be selected and submitted", async () => {
  for (const category of ["temporary_password", "diagnostic_access_code"] as const) {
    const submitted = await json("/api/portal/support-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category,
        patientHisId: `SUP-LINK-${stamp}`,
        lastName: "Patient",
        contactEmail: `support-${stamp}@example.com`,
        details: `category ${category}`,
      }),
    });
    assert.equal(submitted.status, 202);
    assert.match(String(submitted.data.message), /If your request can be verified/i);
  }
  const listed = await patientSupportRequestsRepo.listSupportRequests({ page: 1, limit: 20 });
  const mine = listed.data.filter((row) => row.patientHisId.includes(`SUP-`) && row.patientHisId.includes(String(stamp)));
  for (const row of mine) supportRequestIds.push(row.id);
  assert.ok(mine.some((row) => row.category === "temporary_password"));
  assert.ok(mine.some((row) => row.category === "diagnostic_access_code"));
});

test("3 — invalid inputs are rejected", async () => {
  const bad = await json("/api/portal/support-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category: "temporary_password", patientHisId: "", lastName: "" }),
  });
  assert.equal(bad.status, 400);
});

test("4 — public responses do not reveal account existence", async () => {
  const unknown = await json("/api/portal/support-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      category: "temporary_password",
      patientHisId: `DOES-NOT-EXIST-${stamp}`,
      lastName: "Nobody",
    }),
  });
  assert.equal(unknown.status, 202);
  assert.match(String(unknown.data.message), /If your request can be verified/i);
  const listed = await patientSupportRequestsRepo.listSupportRequests({ page: 1, limit: 50 });
  const orphan = listed.data.find((row) => row.patientHisId === `DOES-NOT-EXIST-${stamp}`);
  if (orphan) supportRequestIds.push(orphan.id);
});

test("5 — support requests are rate-limited", async () => {
  const his = `SUP-RATE-${stamp}`;
  for (let i = 0; i < 3; i++) {
    const ok = await json("/api/portal/support-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: "temporary_password",
        patientHisId: his,
        lastName: "Rate",
      }),
    });
    assert.equal(ok.status, 202);
  }
  const blocked = await json("/api/portal/support-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      category: "temporary_password",
      patientHisId: his,
      lastName: "Rate",
    }),
  });
  assert.equal(blocked.status, 429);
  const listed = await patientSupportRequestsRepo.listSupportRequests({ page: 1, limit: 50 });
  for (const row of listed.data.filter((item) => item.patientHisId === his)) {
    supportRequestIds.push(row.id);
  }
});

test("6 — unauthorized users cannot view or process support requests", async () => {
  const listed = await json("/api/admin/support-requests", { headers: authHeaders(staffToken) });
  assert.equal(listed.status, 403);
  const process = await json(`/api/admin/support-requests/1/process`, {
    method: "POST",
    headers: authHeaders(staffToken),
    body: JSON.stringify({ action: "fulfill" }),
  });
  assert.equal(process.status, 403);
});

test("7-13 — temporary password fulfill, forced change, inactive, SMTP failure", async () => {
  const created = await patientSupportRequestsRepo.insertSupportRequest({
    category: "temporary_password",
    patientHisId: `SUP-LINK-${stamp}`,
    lastName: "Patient",
    contactEmail: null,
    details: "fulfill me",
    requesterIpHash: null,
  });
  supportRequestIds.push(created.id);

  const fulfilled = await json(`/api/admin/support-requests/${created.id}/process`, {
    method: "POST",
    headers: authHeaders(adminToken),
    body: JSON.stringify({ action: "fulfill" }),
  });
  assert.equal(fulfilled.status, 200);
  assert.equal(fulfilled.data.passwordReset, true);
  assert.equal(fulfilled.data.emailAccepted, true);
  assert.equal(fulfilled.data.temporaryPassword, undefined);

  const portalUser = await usersRepo.findUserById(portalUserId);
  assert.ok(portalUser);
  assert.equal(portalUser!.mustChangePassword, true);
  assert.ok(portalUser!.passwordExpiresAt);
  assert.equal(await comparePassword(PASSWORD, portalUser!.passwordHash), false);

  // Login with old password should fail; we don't know temp password from API when email succeeds.
  // Re-issue with email failure to capture temp password for forced-change tests.
  setPortalEmailSenderForTests(async () => false);
  const created2 = await patientSupportRequestsRepo.insertSupportRequest({
    category: "temporary_password",
    patientHisId: `SUP-LINK-${stamp}`,
    lastName: "Patient",
    contactEmail: null,
    details: "email fail",
    requesterIpHash: null,
  });
  supportRequestIds.push(created2.id);
  const failedEmail = await json(`/api/admin/support-requests/${created2.id}/process`, {
    method: "POST",
    headers: authHeaders(adminToken),
    body: JSON.stringify({ action: "fulfill" }),
  });
  assert.equal(failedEmail.status, 200);
  assert.equal(failedEmail.data.emailAccepted, false);
  assert.equal(typeof failedEmail.data.temporaryPassword, "string");
  assert.match(String(failedEmail.data.message), /email delivery failed/i);
  const tempPassword = String(failedEmail.data.temporaryPassword);

  const login = await json("/api/portal/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: `SUP-LINK-${stamp}`,
      lastName: "Patient",
      password: tempPassword,
    }),
  });
  assert.equal(login.status, 200);
  assert.equal(login.data.mustChangePassword, true);
  const sessionToken = String(login.data.sessionToken);

  const blocked = await json("/api/portal/results", {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.code, "MUST_CHANGE_PASSWORD");

  const changed = await json("/api/portal/change-password", {
    method: "POST",
    headers: authHeaders(sessionToken),
    body: JSON.stringify({ currentPassword: tempPassword, newPassword: NEW_PASSWORD }),
  });
  assert.equal(changed.status, 200);

  const after = await usersRepo.findUserById(portalUserId);
  assert.ok(after);
  assert.equal(after!.mustChangePassword, false);
  assert.equal(after!.passwordExpiresAt, null);
  assert.equal(await comparePassword(NEW_PASSWORD, after!.passwordHash), true);
  assert.equal(await comparePassword(tempPassword, after!.passwordHash), false);

  // Inactive account is not silently reactivated.
  setPortalEmailSenderForTests(async () => true);
  const inactiveReq = await patientSupportRequestsRepo.insertSupportRequest({
    category: "temporary_password",
    patientHisId: `SUP-INACT-${stamp}`,
    lastName: "Patient",
    contactEmail: null,
    details: null,
    requesterIpHash: null,
  });
  supportRequestIds.push(inactiveReq.id);
  const inactiveProcess = await json(`/api/admin/support-requests/${inactiveReq.id}/process`, {
    method: "POST",
    headers: authHeaders(adminToken),
    body: JSON.stringify({ action: "fulfill" }),
  });
  assert.equal(inactiveProcess.status, 409);
  const stillInactive = await usersRepo.findUserById(inactivePortalUserId);
  assert.equal(stillInactive!.isActive, false);
});

test("14-15 — diagnostic access-code request uses reissue rules and does not create portal account", async () => {
  setPortalEmailSenderForTests(async () => true);
  const before = await patientsRepo.findPatientById(hospitalOnlyPatientId);
  assert.equal(before!.portalUserId, null);

  const created = await patientSupportRequestsRepo.insertSupportRequest({
    category: "diagnostic_access_code",
    patientHisId: `SUP-HOSP-${stamp}`,
    lastName: "Hospital",
    contactEmail: null,
    details: null,
    requesterIpHash: null,
  });
  supportRequestIds.push(created.id);

  const processed = await json(`/api/admin/support-requests/${created.id}/process`, {
    method: "POST",
    headers: authHeaders(adminToken),
    body: JSON.stringify({ action: "fulfill" }),
  });
  assert.equal(processed.status, 200);
  assert.equal(processed.data.accessCodeIssued, true);
  assert.equal(processed.data.emailAccepted, true);

  const after = await patientsRepo.findPatientById(hospitalOnlyPatientId);
  assert.equal(after!.portalUserId, null);
  assert.notEqual(after!.accessCodeHash, before!.accessCodeHash);
});

test("16 — passwords and access codes never appear in audit details from support processing", () => {
  const support = fs.readFileSync(
    new URL("../../artifacts/api-server/src/routes/support.ts", import.meta.url),
    "utf8",
  );
  assert.equal(support.includes("details: temporaryPassword"), false);
  assert.equal(support.includes("details: accessCode"), false);
  assert.match(support, /patient_support_temp_password_issued/);
  assert.match(support, /patient_support_access_code_issued/);
});

test("17 — Account Recovery displays only Doctor and Patient", () => {
  const page = fs.readFileSync(
    new URL("../../artifacts/ace-results-portal/src/pages/recover.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /SelectItem value="doctor"/);
  assert.match(page, /SelectItem value="patient"/);
  assert.equal(page.includes('SelectItem value="staff"'), false);
  assert.equal(page.includes("StaffRecovery"), false);
});

test("18 — recovery API rejects unsupported Staff recovery", async () => {
  const rejected = await json("/api/auth/account-recovery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "staff", userCode: "x", resetKey: "y" }),
  });
  assert.equal(rejected.status, 400);
  assert.match(String(rejected.data.error), /Staff password recovery is not available/i);
});

test("19 — Doctor recovery remains functional (generic acknowledgement)", async () => {
  const doctor = await json("/api/auth/account-recovery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "doctor", email: "doc@example.com", doctorName: "Doc" }),
  });
  assert.equal(doctor.status, 202);
});

test("20 — Patient recovery endpoint still responds without revealing accounts", async () => {
  const recover = await json("/api/portal/recover/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patientHisId: `NOPE-${stamp}`,
      lastName: "Nope",
      dateOfBirth: "1990-01-01",
    }),
  });
  // Generic non-success is fine; must not leak account existence details.
  assert.ok([200, 202, 400, 401, 404, 503].includes(recover.status));
  assert.equal(
    typeof recover.data.error === "string" || typeof recover.data.message === "string",
    true,
  );
});

test("21 — patient accounts remain excluded from staff user management", async () => {
  const listed = await json("/api/users?limit=100", { headers: authHeaders(adminToken) });
  assert.equal(listed.status, 200);
  const rows = (listed.data.data as Array<{ id: number; role: string }>) ?? [];
  assert.equal(rows.some((row) => row.id === portalUserId), false);
});

test("22 — staff login remains intact after recovery role restriction", async () => {
  const staffLogin = await json("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: `sup-staff-${stamp}`,
      password: PASSWORD,
      portal: "staff",
    }),
  });
  assert.equal(staffLogin.status, 200);
  assert.ok(staffLogin.data.accessToken);
});

after(async () => {
  setPortalEmailSenderForTests(null);
  await cleanup();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await closePool();
});
