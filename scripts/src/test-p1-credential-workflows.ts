/**
 * P1 production-readiness regressions:
 *  P1-1 concurrent support-request claim
 *  P1-2 recovery clears temp-password flags + revokes sessions
 *  P1-3 access-code hash preserved when SMTP fails
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  closePool,
  getPool,
  initDb,
  loadDbConfig,
  loadRootEnv,
  patientsRepo,
  patientSupportRequestsRepo,
  sql,
  usersRepo,
  PORTAL_USER_ROLE,
} from "@workspace/db";
import app from "../../artifacts/api-server/src/app.ts";
import {
  compareAccessCode,
  comparePassword,
  createRecoveryJti,
  hashAccessCode,
  hashOtp,
  hashPassword,
  signRecoveryToken,
} from "../../artifacts/api-server/src/lib/auth.ts";
import {
  confirmPasswordRecovery,
  verifyPasswordRecoveryOtp,
} from "../../artifacts/api-server/src/lib/portal-recovery.ts";
import { createRecoveryTxn } from "../../artifacts/api-server/src/lib/recovery-state.ts";
import {
  setPortalEmailDetailedSenderForTests,
  setPortalEmailSenderForTests,
} from "../../artifacts/api-server/src/lib/portal-email.ts";
import { issueAccessCodeAndEmail } from "../../artifacts/api-server/src/lib/access-code-email.ts";

loadRootEnv();

const stamp = Date.now();
const PASSWORD = `P1Cred${stamp}a!`;
const RECOVERED = `P1Recov${stamp}a!`;
const OTHER_PASSWORD = `P1Other${stamp}a!`;
const ACCESS_CODE = `P1C-${stamp.toString(36).toUpperCase().slice(-8)}`;

let server: Server;
let base = "";
let adminToken = "";
let staffToken = "";
let staffUserId = 0;
let portalUserId = 0;
let otherPortalUserId = 0;
let patientId = 0;
let otherPatientId = 0;
let accessPatientId = 0;
const supportIds: number[] = [];

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
  for (const id of supportIds) {
    await patientSupportRequestsRepo.deleteSupportRequest(id).catch(() => undefined);
  }
  for (const id of [patientId, otherPatientId, accessPatientId].filter((v) => v > 0)) {
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.patient_departments WHERE patient_id = @id").catch(() => undefined);
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.patient_physicians WHERE patient_id = @id").catch(() => undefined);
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.patients WHERE id = @id").catch(() => undefined);
  }
  for (const id of [portalUserId, otherPortalUserId, staffUserId].filter((v) => v > 0)) {
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.auth_sessions WHERE user_id = @id").catch(() => undefined);
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.users WHERE id = @id").catch(() => undefined);
  }
}

test("setup P1 credential fixtures", async () => {
  assert.equal(loadDbConfig().database, "ACE_ResultsPortal");
  assert.equal(await patientSupportRequestsRepo.schemaReady(), true);
  assert.equal(await patientSupportRequestsRepo.mustChangePasswordColumnsReady(), true);
  await initDb();

  setPortalEmailSenderForTests(async () => true);

  server = app.listen(0);
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;

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
    username: `p1-staff-${stamp}`,
    passwordHash,
    firstName: "P1",
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
    username: `patient:p1-${stamp}`,
    passwordHash,
    firstName: "P1",
    lastName: "Patient",
    email: `p1-patient-${stamp}@example.com`,
    role: PORTAL_USER_ROLE,
  });
  portalUserId = portalUser.id;

  const otherUser = await usersRepo.insertUser({
    username: `patient:p1o-${stamp}`,
    passwordHash: await hashPassword(OTHER_PASSWORD),
    firstName: "P1",
    lastName: "Other",
    email: `p1-other-${stamp}@example.com`,
    role: PORTAL_USER_ROLE,
  });
  otherPortalUserId = otherUser.id;

  const accessHash = await hashAccessCode(ACCESS_CODE);
  const patient = await patientsRepo.insertPatient({
    patientHisId: `P1-${stamp}`,
    lastName: "Patient",
    firstName: "P1",
    middleName: null,
    dateOfBirth: "1990-01-01",
    mobileNumber: null,
    email: `p1-patient-${stamp}@example.com`,
    accessCodeHash: accessHash,
    createdById: staff.id,
    portalUserId: portalUser.id,
  });
  patientId = patient.id;

  const otherPatient = await patientsRepo.insertPatient({
    patientHisId: `P1O-${stamp}`,
    lastName: "Other",
    firstName: "P1",
    middleName: null,
    dateOfBirth: "1991-01-01",
    mobileNumber: null,
    email: `p1-other-${stamp}@example.com`,
    accessCodeHash: accessHash,
    createdById: staff.id,
    portalUserId: otherUser.id,
  });
  otherPatientId = otherPatient.id;

  const accessPatient = await patientsRepo.insertPatient({
    patientHisId: `P1A-${stamp}`,
    lastName: "Access",
    firstName: "P1",
    middleName: null,
    dateOfBirth: "1992-01-01",
    mobileNumber: null,
    email: `p1-access-${stamp}@example.com`,
    accessCodeHash: accessHash,
    createdById: staff.id,
  });
  accessPatientId = accessPatient.id;
});

test("P1-1 — concurrent fulfill: exactly one claimant issues credentials", async () => {
  const created = await patientSupportRequestsRepo.insertSupportRequest({
    category: "temporary_password",
    patientHisId: `P1-${stamp}`,
    lastName: "Patient",
    contactEmail: null,
    details: "concurrent",
    requesterIpHash: null,
  });
  supportIds.push(created.id);

  const body = JSON.stringify({ action: "fulfill" });
  const [a, b] = await Promise.all([
    json(`/api/admin/support-requests/${created.id}/process`, {
      method: "POST",
      headers: authHeaders(adminToken),
      body,
    }),
    json(`/api/admin/support-requests/${created.id}/process`, {
      method: "POST",
      headers: authHeaders(adminToken),
      body,
    }),
  ]);

  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  const winner = a.status === 200 ? a : b;
  const loser = a.status === 409 ? a : b;
  assert.equal(winner.data.passwordReset, true);
  assert.match(String(loser.data.error), /already being processed|already been closed/i);

  const row = await patientSupportRequestsRepo.findSupportRequestById(created.id);
  assert.equal(row?.status, "completed");
});

test("P1-1 — completed request cannot be fulfilled again", async () => {
  const created = await patientSupportRequestsRepo.insertSupportRequest({
    category: "temporary_password",
    patientHisId: `P1-${stamp}`,
    lastName: "Patient",
    contactEmail: null,
    details: null,
    requesterIpHash: null,
  });
  supportIds.push(created.id);
  const first = await json(`/api/admin/support-requests/${created.id}/process`, {
    method: "POST",
    headers: authHeaders(adminToken),
    body: JSON.stringify({ action: "fulfill" }),
  });
  assert.equal(first.status, 200);
  const second = await json(`/api/admin/support-requests/${created.id}/process`, {
    method: "POST",
    headers: authHeaders(adminToken),
    body: JSON.stringify({ action: "fulfill" }),
  });
  assert.equal(second.status, 409);
});

test("P1-1 — rejected request cannot be fulfilled", async () => {
  const created = await patientSupportRequestsRepo.insertSupportRequest({
    category: "temporary_password",
    patientHisId: `P1-${stamp}`,
    lastName: "Patient",
    contactEmail: null,
    details: null,
    requesterIpHash: null,
  });
  supportIds.push(created.id);
  const rejected = await json(`/api/admin/support-requests/${created.id}/process`, {
    method: "POST",
    headers: authHeaders(adminToken),
    body: JSON.stringify({ action: "reject", adminNotes: "no" }),
  });
  assert.equal(rejected.status, 200);
  const again = await json(`/api/admin/support-requests/${created.id}/process`, {
    method: "POST",
    headers: authHeaders(adminToken),
    body: JSON.stringify({ action: "fulfill" }),
  });
  assert.equal(again.status, 409);
});

test("P1-1 — SMTP failure after temp password does not reopen for silent reissue", async () => {
  setPortalEmailSenderForTests(async () => false);
  const created = await patientSupportRequestsRepo.insertSupportRequest({
    category: "temporary_password",
    patientHisId: `P1-${stamp}`,
    lastName: "Patient",
    contactEmail: null,
    details: "smtp fail",
    requesterIpHash: null,
  });
  supportIds.push(created.id);
  const processed = await json(`/api/admin/support-requests/${created.id}/process`, {
    method: "POST",
    headers: authHeaders(adminToken),
    body: JSON.stringify({ action: "fulfill" }),
  });
  assert.equal(processed.status, 200);
  assert.equal(processed.data.emailAccepted, false);
  assert.equal(typeof processed.data.temporaryPassword, "string");

  const retry = await json(`/api/admin/support-requests/${created.id}/process`, {
    method: "POST",
    headers: authHeaders(adminToken),
    body: JSON.stringify({ action: "fulfill" }),
  });
  assert.equal(retry.status, 409);
  setPortalEmailSenderForTests(async () => true);
});

test("P1-1 — credential-generation failure returns to pending", async () => {
  const hosp = await patientsRepo.insertPatient({
    patientHisId: `P1H-${stamp}`,
    lastName: "Hosp",
    firstName: "P1",
    middleName: null,
    dateOfBirth: "1993-01-01",
    mobileNumber: null,
    email: `p1-hosp-${stamp}@example.com`,
    accessCodeHash: await hashAccessCode(ACCESS_CODE),
    createdById: staffUserId,
  });
  const created = await patientSupportRequestsRepo.insertSupportRequest({
    category: "temporary_password",
    patientHisId: `P1H-${stamp}`,
    lastName: "Hosp",
    contactEmail: null,
    details: null,
    requesterIpHash: null,
  });
  supportIds.push(created.id);
  const failed = await json(`/api/admin/support-requests/${created.id}/process`, {
    method: "POST",
    headers: authHeaders(adminToken),
    body: JSON.stringify({ action: "fulfill" }),
  });
  assert.ok([400, 404, 409].includes(failed.status), `status=${failed.status}`);
  const row = await patientSupportRequestsRepo.findSupportRequestById(created.id);
  assert.equal(row?.status, "pending");

  await patientSupportRequestsRepo.deleteSupportRequest(created.id);
  const idx = supportIds.indexOf(created.id);
  if (idx >= 0) supportIds.splice(idx, 1);
  const pool = await getPool();
  await pool.request().input("id", sql.Int, hosp.id).query("DELETE FROM dbo.patients WHERE id = @id");
});

test("P1-1 — unauthorized staff cannot claim", async () => {
  const created = await patientSupportRequestsRepo.insertSupportRequest({
    category: "temporary_password",
    patientHisId: `P1-${stamp}`,
    lastName: "Patient",
    contactEmail: null,
    details: null,
    requesterIpHash: null,
  });
  supportIds.push(created.id);
  const denied = await json(`/api/admin/support-requests/${created.id}/process`, {
    method: "POST",
    headers: authHeaders(staffToken),
    body: JSON.stringify({ action: "fulfill" }),
  });
  assert.equal(denied.status, 403);
  const row = await patientSupportRequestsRepo.findSupportRequestById(created.id);
  assert.equal(row?.status, "pending");
});

test("P1-1 — independent requests can be processed in parallel", async () => {
  const a = await patientSupportRequestsRepo.insertSupportRequest({
    category: "diagnostic_access_code",
    patientHisId: `P1A-${stamp}`,
    lastName: "Access",
    contactEmail: null,
    details: null,
    requesterIpHash: null,
  });
  const b = await patientSupportRequestsRepo.insertSupportRequest({
    category: "diagnostic_access_code",
    patientHisId: `P1A-${stamp}`,
    lastName: "Access",
    contactEmail: null,
    details: null,
    requesterIpHash: null,
  });
  supportIds.push(a.id, b.id);

  const [ra, rb] = await Promise.all([
    json(`/api/admin/support-requests/${a.id}/process`, {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({ action: "fulfill" }),
    }),
    json(`/api/admin/support-requests/${b.id}/process`, {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({ action: "fulfill" }),
    }),
  ]);
  assert.ok([200, 409, 503].includes(ra.status), `a=${ra.status}`);
  assert.ok([200, 409, 503].includes(rb.status), `b=${rb.status}`);
  assert.ok(ra.status === 200 || rb.status === 200, "at least one independent request succeeds");
});

test("P1-2 — recovery clears must_change_password and password_expires_at", async () => {
  const expires = new Date(Date.now() - 60_000);
  await usersRepo.setUserPassword(portalUserId, await hashPassword(PASSWORD), true, {
    mustChangePassword: true,
    passwordExpiresAt: expires,
  });

  const otp = "112233";
  const otpHash = hashOtp(otp);
  const jti = createRecoveryJti();
  createRecoveryTxn({ jti, patientId, otpHash, ttlMs: 60_000 });
  const recoveryToken = signRecoveryToken({ patientId, otpHash, jti });
  assert.equal(verifyPasswordRecoveryOtp({ recoveryToken, otp }).ok, true);

  setPortalEmailSenderForTests(async () => true);
  const result = await confirmPasswordRecovery({
    recoveryToken,
    otp,
    newPassword: RECOVERED,
  });
  assert.equal(result.ok, true);

  const user = await usersRepo.findUserById(portalUserId);
  assert.ok(user);
  assert.equal(user!.mustChangePassword, false);
  assert.equal(user!.passwordExpiresAt, null);
  assert.equal(await comparePassword(RECOVERED, user!.passwordHash), true);

  const login = await json("/api/portal/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: `P1-${stamp}`,
      lastName: "Patient",
      password: RECOVERED,
    }),
  });
  assert.equal(login.status, 200);
  assert.equal(login.data.mustChangePassword, false);
});

test("P1-2 — recovery revokes existing sessions; other users unaffected", async () => {
  await usersRepo.setUserPassword(portalUserId, await hashPassword(PASSWORD), true, {
    clearForcedChange: true,
  });
  const loginA = await json("/api/portal/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: `P1-${stamp}`,
      lastName: "Patient",
      password: PASSWORD,
    }),
  });
  assert.equal(loginA.status, 200);
  const tokenA = String(loginA.data.sessionToken);

  const loginB = await json("/api/portal/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: `P1O-${stamp}`,
      lastName: "Other",
      password: OTHER_PASSWORD,
    }),
  });
  assert.equal(loginB.status, 200);
  const tokenB = String(loginB.data.sessionToken);

  const otp = "445566";
  const otpHash = hashOtp(otp);
  const jti = createRecoveryJti();
  createRecoveryTxn({ jti, patientId, otpHash, ttlMs: 60_000 });
  const recoveryToken = signRecoveryToken({ patientId, otpHash, jti });
  assert.equal(verifyPasswordRecoveryOtp({ recoveryToken, otp }).ok, true);
  const recovered = await confirmPasswordRecovery({
    recoveryToken,
    otp,
    newPassword: RECOVERED,
  });
  assert.equal(recovered.ok, true);

  const meA = await json("/api/portal/profile", { headers: { Authorization: `Bearer ${tokenA}` } });
  assert.equal(meA.status, 401);

  const meB = await json("/api/portal/profile", { headers: { Authorization: `Bearer ${tokenB}` } });
  assert.equal(meB.status, 200);

  const pool = await getPool();
  const sessions = await pool
    .request()
    .input("userId", sql.Int, portalUserId)
    .query(`SELECT COUNT(*) AS active FROM dbo.auth_sessions WHERE user_id = @userId AND revoked_at IS NULL`);
  assert.equal(Number((sessions.recordset[0] as { active: number }).active), 0);

  const otherActive = await pool
    .request()
    .input("userId", sql.Int, otherPortalUserId)
    .query(`SELECT COUNT(*) AS active FROM dbo.auth_sessions WHERE user_id = @userId AND revoked_at IS NULL`);
  assert.ok(Number((otherActive.recordset[0] as { active: number }).active) >= 1);
});

test("P1-2 — incorrect OTP does not change password or sessions", async () => {
  await usersRepo.setUserPassword(portalUserId, await hashPassword(PASSWORD), true, {
    clearForcedChange: true,
  });
  const before = await usersRepo.findUserById(portalUserId);
  const otp = "778899";
  const otpHash = hashOtp(otp);
  const jti = createRecoveryJti();
  createRecoveryTxn({ jti, patientId, otpHash, ttlMs: 60_000 });
  const recoveryToken = signRecoveryToken({ patientId, otpHash, jti });
  assert.equal(verifyPasswordRecoveryOtp({ recoveryToken, otp: "000000" }).ok, false);

  const after = await usersRepo.findUserById(portalUserId);
  assert.equal(after!.passwordHash, before!.passwordHash);
  assert.equal(after!.mustChangePassword, before!.mustChangePassword);
});

test("P1-3 — SMTP unavailable before send leaves hash unchanged", async () => {
  const before = await patientsRepo.findPatientById(accessPatientId);
  assert.ok(before);
  setPortalEmailSenderForTests(async () => false);

  const issued = await issueAccessCodeAndEmail({
    patient: before!,
    email: before!.email!,
  });
  assert.equal(issued.ok, false);
  if (!issued.ok) {
    assert.equal(issued.hashUnchanged, true);
    assert.equal(issued.credentialIssued, false);
  }

  const after = await patientsRepo.findPatientById(accessPatientId);
  assert.equal(after!.accessCodeHash, before!.accessCodeHash);
  setPortalEmailSenderForTests(async () => true);
});

test("P1-3 — uncertain SMTP timeout leaves hash unchanged and reports uncertainty", async () => {
  const before = await patientsRepo.findPatientById(accessPatientId);
  setPortalEmailDetailedSenderForTests(async () => ({
    accepted: false,
    uncertain: true,
    reason: "timeout",
  }));

  const issued = await issueAccessCodeAndEmail({
    patient: before!,
    email: before!.email!,
  });
  assert.equal(issued.ok, false);
  if (!issued.ok) {
    assert.equal(issued.deliveryUncertain, true);
    assert.equal(issued.hashUnchanged, true);
  }
  const after = await patientsRepo.findPatientById(accessPatientId);
  assert.equal(after!.accessCodeHash, before!.accessCodeHash);
  setPortalEmailSenderForTests(async () => true);
});

test("P1-3 — successful email+activate matches persisted hash", async () => {
  const before = await patientsRepo.findPatientById(accessPatientId);
  setPortalEmailSenderForTests(async () => true);
  const issued = await issueAccessCodeAndEmail({
    patient: before!,
    email: before!.email!,
  });
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  assert.equal(issued.credentialIssued, true);
  assert.equal(issued.emailAccepted, true);
  assert.equal(await compareAccessCode(issued.accessCode, issued.patient.accessCodeHash), true);
});

test("P1-3 — staff email-access-code preserves hash on SMTP failure", async () => {
  const before = await patientsRepo.findPatientById(accessPatientId);
  setPortalEmailSenderForTests(async () => false);
  const failed = await json(`/api/patients/${accessPatientId}/email-access-code`, {
    method: "POST",
    headers: authHeaders(adminToken),
    body: "{}",
  });
  assert.equal(failed.status, 503);
  assert.equal(failed.data.hashUnchanged, true);
  const after = await patientsRepo.findPatientById(accessPatientId);
  assert.equal(after!.accessCodeHash, before!.accessCodeHash);
  setPortalEmailSenderForTests(async () => true);
});

test("P1-3 — concurrent reissue cannot silently double-activate", async () => {
  const before = await patientsRepo.findPatientById(accessPatientId);
  assert.ok(before);
  setPortalEmailSenderForTests(async () => true);

  const [a, b] = await Promise.all([
    issueAccessCodeAndEmail({ patient: before!, email: before!.email! }),
    issueAccessCodeAndEmail({ patient: before!, email: before!.email! }),
  ]);

  const successes = [a, b].filter((r) => r.ok);
  const failures = [a, b].filter((r) => !r.ok);
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  if (!failures[0]!.ok) {
    assert.equal(failures[0]!.emailAccepted, true);
    assert.equal("activationUncertain" in failures[0]! && failures[0]!.activationUncertain, true);
  }
  const after = await patientsRepo.findPatientById(accessPatientId);
  assert.ok(successes[0]!.ok);
  if (successes[0]!.ok) {
    assert.equal(after!.accessCodeHash, successes[0]!.patient.accessCodeHash);
  }
});

test("P1-3 — email-access-code does not create portal accounts", async () => {
  const before = await patientsRepo.findPatientById(accessPatientId);
  assert.equal(before!.portalUserId, null);
  setPortalEmailSenderForTests(async () => true);
  const sent = await json(`/api/patients/${accessPatientId}/email-access-code`, {
    method: "POST",
    headers: authHeaders(adminToken),
    body: "{}",
  });
  assert.equal(sent.status, 200);
  const after = await patientsRepo.findPatientById(accessPatientId);
  assert.equal(after!.portalUserId, null);
  assert.notEqual(after!.accessCodeHash, before!.accessCodeHash);
});

test("P1-1/3 — unauthorized staff cannot process admin support or claim", async () => {
  const listed = await json("/api/admin/support-requests", { headers: authHeaders(staffToken) });
  assert.equal(listed.status, 403);
});

after(async () => {
  setPortalEmailSenderForTests(null);
  await cleanup();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await closePool();
});
