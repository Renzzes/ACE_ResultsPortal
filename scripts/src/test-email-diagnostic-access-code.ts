/**
 * Staff Desk: email the registration diagnostic access code without regenerating it.
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
  patientDepartmentsRepo,
  patientsRepo,
  sql,
  usersRepo,
} from "@workspace/db";
import app from "../../artifacts/api-server/src/app.ts";
import { hashAccessCode, hashPassword } from "../../artifacts/api-server/src/lib/auth.ts";
import { resolveRegistrationDepartment } from "../../artifacts/api-server/src/lib/patient-department-access.ts";
import {
  __forceExpireRegistrationAccessCodeForTests,
  __registrationAccessCodeCacheSizeForTests,
  __resetRegistrationAccessCodeCacheForTests,
  beginRegistrationAccessCodeSend,
  clearRegistrationAccessCode,
  endRegistrationAccessCodeSend,
  peekRegistrationAccessCode,
  rememberRegistrationAccessCode,
} from "../../artifacts/api-server/src/lib/registration-access-code-cache.ts";
import { setPortalEmailSenderForTests } from "../../artifacts/api-server/src/lib/portal-email.ts";

loadRootEnv();

const stamp = Date.now();
const PASSWORD = `EmailCode${stamp}a!`;
const ACCESS_CODE = `ACE-${stamp.toString(36).toUpperCase().slice(-8)}`;
let server: Server;
let base = "";
let labId = 0;
let physicianId = 0;
let patientId = 0;
let patientNoEmailId = 0;
let sentMails: Array<{ to: string; subject: string; text: string }> = [];
let forceEmailFail = false;

async function json(path: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, init);
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, data };
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function login(username: string, portal: "admin" | "staff" | "doctor") {
  return json("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      password: portal === "admin" ? process.env.ADMIN_BOOTSTRAP_PASSWORD : PASSWORD,
      portal,
    }),
  });
}

async function cleanup() {
  const pool = await getPool();
  for (const id of [patientId, patientNoEmailId].filter((value) => value > 0)) {
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.patient_physicians WHERE patient_id = @id").catch(() => undefined);
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.patient_departments WHERE patient_id = @id").catch(() => undefined);
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.patients WHERE id = @id").catch(() => undefined);
  }
  for (const id of [labId, physicianId].filter((value) => value > 0)) {
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.auth_sessions WHERE user_id = @id").catch(() => undefined);
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.users WHERE id = @id").catch(() => undefined);
  }
}

test("setup ephemeral API and registration access-code fixtures", async () => {
  assert.equal(loadDbConfig().database, "ACE_ResultsPortal");
  await initDb();
  __resetRegistrationAccessCodeCacheForTests();
  sentMails = [];
  forceEmailFail = false;
  setPortalEmailSenderForTests(async (to, subject, text) => {
    if (forceEmailFail) return false;
    sentMails.push({ to, subject, text });
    return true;
  });

  server = app.listen(0);
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${base}/api/healthz`);
  assert.equal(health.status, 200);

  const passwordHash = await hashPassword(PASSWORD);
  const accessHash = await hashAccessCode(ACCESS_CODE);

  const lab = await usersRepo.insertUser({
    username: `emailcode-lab-${stamp}`,
    passwordHash,
    firstName: "Email",
    lastName: "Lab",
    email: null,
    role: "laboratory",
  });
  labId = lab.id;

  const physician = await usersRepo.insertUser({
    username: `emailcode-md-${stamp}`,
    passwordHash,
    firstName: "Email",
    lastName: "Doc",
    email: null,
    role: "physician",
  });
  physicianId = physician.id;

  const withEmail = await patientsRepo.insertPatient({
    patientHisId: `EMAILCODE-${stamp}`,
    lastName: "WithEmail",
    firstName: "Patient",
    middleName: null,
    dateOfBirth: "1990-01-01",
    mobileNumber: null,
    email: `patient.with.${stamp}@example.com`,
    accessCodeHash: accessHash,
    createdById: lab.id,
  });
  patientId = withEmail.id;
  rememberRegistrationAccessCode(withEmail.id, lab.id, ACCESS_CODE);

  const noEmail = await patientsRepo.insertPatient({
    patientHisId: `EMAILCODENO-${stamp}`,
    lastName: "NoEmail",
    firstName: "Patient",
    middleName: null,
    dateOfBirth: "1991-02-02",
    mobileNumber: null,
    email: null,
    accessCodeHash: accessHash,
    createdById: lab.id,
  });
  patientNoEmailId = noEmail.id;
  rememberRegistrationAccessCode(noEmail.id, lab.id, ACCESS_CODE);

  const registration = await resolveRegistrationDepartment("laboratory");
  assert.equal(registration.status, "department");
  if (registration.status === "department") {
    await patientDepartmentsRepo.ensureMembership({
      patientId: withEmail.id,
      departmentId: registration.departmentId,
      registeredById: lab.id,
    });
    await patientDepartmentsRepo.ensureMembership({
      patientId: noEmail.id,
      departmentId: registration.departmentId,
      registeredById: lab.id,
    });
  }
});

test("success screen source includes Email this Access Code and unavailable/uncertain handling", async () => {
  const page = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../../artifacts/ace-results-portal/src/pages/patients/new.tsx", import.meta.url), "utf8"),
  );
  assert.match(page, /Email this Access Code/);
  assert.match(page, /Add Patient Email/);
  assert.match(page, /email-diagnostic-access-code/);
  assert.match(page, /An email address is required to send this access code/);
  assert.match(page, /Email accepted for sending/);
  assert.match(page, /Delivery uncertain/);
  assert.match(page, /Open Patient to Reissue Code/);
  assert.match(page, /pending_code_unavailable/);
});

test("sending emails the pending registration code without changing the hash or creating a portal user", async () => {
  const labLogin = await login(`emailcode-lab-${stamp}`, "staff");
  assert.equal(labLogin.status, 200);
  const token = String(labLogin.data.accessToken);
  const before = await patientsRepo.findPatientById(patientId);
  assert.ok(before);
  assert.equal(before!.portalUserId, null);
  const hashBefore = before!.accessCodeHash;

  const sent = await json(`/api/patients/${patientId}/email-diagnostic-access-code`, {
    method: "POST",
    headers: authHeaders(token),
    body: "{}",
  });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  assert.equal(sent.data.success, true);
  assert.equal(sent.data.delivery, "accepted");
  assert.equal(typeof sent.data.emailedToMasked, "string");
  assert.equal(String(sent.data.emailedToMasked).includes("@"), true);
  assert.equal(JSON.stringify(sent.data).includes(ACCESS_CODE), false);
  assert.match(String(sent.data.message ?? ""), /accepted for sending/i);

  assert.equal(sentMails.length, 1);
  assert.equal(sentMails[0]?.to, `patient.with.${stamp}@example.com`);
  assert.match(sentMails[0]?.text ?? "", new RegExp(ACCESS_CODE));
  assert.match(sentMails[0]?.text ?? "", /does not create a Patient Portal account/i);

  const after = await patientsRepo.findPatientById(patientId);
  assert.equal(after!.accessCodeHash, hashBefore);
  assert.equal(after!.portalUserId, null);
  assert.equal(peekRegistrationAccessCode(patientId), ACCESS_CODE);
});

test("transport failure reports delivery failed and keeps saved email and hash", async () => {
  forceEmailFail = true;
  sentMails = [];
  const labLogin = await login(`emailcode-lab-${stamp}`, "staff");
  const token = String(labLogin.data.accessToken);
  const before = await patientsRepo.findPatientById(patientId);
  const failed = await json(`/api/patients/${patientId}/email-diagnostic-access-code`, {
    method: "POST",
    headers: authHeaders(token),
    body: "{}",
  });
  assert.equal(failed.status, 503);
  assert.equal(failed.data.delivery, "failed");
  assert.equal(failed.data.reason, "smtp_failed");
  assert.equal(failed.data.success, undefined);
  assert.ok(String(failed.data.error ?? "").length > 0);
  assert.equal(sentMails.length, 0);
  const after = await patientsRepo.findPatientById(patientId);
  assert.equal(after!.email, before!.email);
  assert.equal(after!.accessCodeHash, before!.accessCodeHash);
  forceEmailFail = false;
});

test("add email persists contact then sends without creating a second patient", async () => {
  sentMails = [];
  const labLogin = await login(`emailcode-lab-${stamp}`, "staff");
  const token = String(labLogin.data.accessToken);
  const newEmail = `added.${stamp}@example.com`;
  const beforeCount = await patientsRepo.findPatientByHisId(`EMAILCODENO-${stamp}`);
  assert.ok(beforeCount);

  const missing = await json(`/api/patients/${patientNoEmailId}/email-diagnostic-access-code`, {
    method: "POST",
    headers: authHeaders(token),
    body: "{}",
  });
  assert.equal(missing.status, 400);
  assert.equal(missing.data.reason, "email_required");
  assert.equal(missing.data.delivery, "not_attempted");

  const sent = await json(`/api/patients/${patientNoEmailId}/email-diagnostic-access-code`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ email: newEmail }),
  });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  assert.equal(sent.data.emailSaved, true);
  assert.equal(sent.data.delivery, "accepted");
  assert.equal(sentMails.length, 1);
  assert.equal(sentMails[0]?.to, newEmail);

  const updated = await patientsRepo.findPatientById(patientNoEmailId);
  assert.equal(updated!.email, newEmail);
  assert.equal(updated!.portalUserId, null);
  const sameHis = await patientsRepo.findPatientByHisId(`EMAILCODENO-${stamp}`);
  assert.equal(sameHis!.id, patientNoEmailId);
});

test("email saved but SMTP failure keeps address and does not claim delivery", async () => {
  forceEmailFail = true;
  sentMails = [];
  const labLogin = await login(`emailcode-lab-${stamp}`, "staff");
  const token = String(labLogin.data.accessToken);
  const retryEmail = `retry-fail.${stamp}@example.com`;
  rememberRegistrationAccessCode(patientNoEmailId, labId, ACCESS_CODE);
  const failed = await json(`/api/patients/${patientNoEmailId}/email-diagnostic-access-code`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ email: retryEmail }),
  });
  assert.equal(failed.status, 503);
  assert.equal(failed.data.emailSaved, true);
  assert.equal(failed.data.delivery, "failed");
  assert.equal(sentMails.length, 0);
  const updated = await patientsRepo.findPatientById(patientNoEmailId);
  assert.equal(updated!.email, retryEmail);
  forceEmailFail = false;
});

test("invalid email is rejected and does not claim save success", async () => {
  const labLogin = await login(`emailcode-lab-${stamp}`, "staff");
  const token = String(labLogin.data.accessToken);
  const rejected = await json(`/api/patients/${patientNoEmailId}/email-diagnostic-access-code`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ email: "not-an-email" }),
  });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.data.emailSaved, false);
  assert.equal(rejected.data.delivery, "not_attempted");
});

test("physician cannot email diagnostic access codes", async () => {
  const doctorLogin = await login(`emailcode-md-${stamp}`, "doctor");
  assert.equal(doctorLogin.status, 200);
  const denied = await json(`/api/patients/${patientId}/email-diagnostic-access-code`, {
    method: "POST",
    headers: authHeaders(String(doctorLogin.data.accessToken)),
    body: "{}",
  });
  assert.equal(denied.status, 403);
});

test("expired pending code returns machine-readable unavailable without changing hash", async () => {
  const labLogin = await login(`emailcode-lab-${stamp}`, "staff");
  const token = String(labLogin.data.accessToken);
  const orphan = await patientsRepo.insertPatient({
    patientHisId: `EMAILORPHAN-${stamp}`,
    lastName: "Orphan",
    firstName: "Code",
    middleName: null,
    dateOfBirth: "1992-03-03",
    mobileNumber: null,
    email: `orphan.${stamp}@example.com`,
    accessCodeHash: await hashAccessCode("ORPHAN-CODE"),
    createdById: labId,
  });
  const registration = await resolveRegistrationDepartment("laboratory");
  if (registration.status === "department") {
    await patientDepartmentsRepo.ensureMembership({
      patientId: orphan.id,
      departmentId: registration.departmentId,
      registeredById: labId,
    });
  }
  rememberRegistrationAccessCode(orphan.id, labId, "ORPHAN-TEMP");
  __forceExpireRegistrationAccessCodeForTests(orphan.id);
  const before = orphan.accessCodeHash;
  const gone = await json(`/api/patients/${orphan.id}/email-diagnostic-access-code`, {
    method: "POST",
    headers: authHeaders(token),
    body: "{}",
  });
  assert.equal(gone.status, 410);
  assert.equal(gone.data.reason, "pending_code_unavailable");
  assert.equal(gone.data.delivery, "not_attempted");
  assert.equal(gone.data.nextAction, "view_patient_regenerate");
  const after = await patientsRepo.findPatientById(orphan.id);
  assert.equal(after!.accessCodeHash, before);

  const pool = await getPool();
  await pool.request().input("id", sql.Int, orphan.id).query("DELETE FROM dbo.patient_departments WHERE patient_id = @id").catch(() => undefined);
  await pool.request().input("id", sql.Int, orphan.id).query("DELETE FROM dbo.patients WHERE id = @id");
});

test("simulated restart clears pending code (process-local cache)", async () => {
  const labLogin = await login(`emailcode-lab-${stamp}`, "staff");
  const token = String(labLogin.data.accessToken);
  rememberRegistrationAccessCode(patientId, labId, ACCESS_CODE);
  clearRegistrationAccessCode(patientId); // restart simulation
  const gone = await json(`/api/patients/${patientId}/email-diagnostic-access-code`, {
    method: "POST",
    headers: authHeaders(token),
    body: "{}",
  });
  assert.equal(gone.status, 410);
  assert.equal(gone.data.reason, "pending_code_unavailable");
  rememberRegistrationAccessCode(patientId, labId, ACCESS_CODE);
});

test("regenerating replaces pending code; old confirmation code cannot be emailed", async () => {
  const labLogin = await login(`emailcode-lab-${stamp}`, "staff");
  const token = String(labLogin.data.accessToken);
  const oldCode = "OLD-CODE-1";
  const newCode = "NEW-CODE-2";
  rememberRegistrationAccessCode(patientId, labId, oldCode);
  clearRegistrationAccessCode(patientId);
  rememberRegistrationAccessCode(patientId, labId, newCode);
  assert.equal(peekRegistrationAccessCode(patientId), newCode);
  sentMails = [];
  const sent = await json(`/api/patients/${patientId}/email-diagnostic-access-code`, {
    method: "POST",
    headers: authHeaders(token),
    body: "{}",
  });
  assert.equal(sent.status, 200);
  assert.match(sentMails[0]?.text ?? "", /NEW-CODE-2/);
  assert.equal((sentMails[0]?.text ?? "").includes(oldCode), false);
});

test("concurrent in-process sends reject the second with send_in_progress", async () => {
  rememberRegistrationAccessCode(patientId, labId, ACCESS_CODE);
  const first = beginRegistrationAccessCodeSend(patientId);
  assert.equal(first.ok, true);
  const second = beginRegistrationAccessCodeSend(patientId);
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.reason, "in_flight");

  const labLogin = await login(`emailcode-lab-${stamp}`, "staff");
  const token = String(labLogin.data.accessToken);
  const blocked = await json(`/api/patients/${patientId}/email-diagnostic-access-code`, {
    method: "POST",
    headers: authHeaders(token),
    body: "{}",
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.reason, "send_in_progress");
  endRegistrationAccessCodeSend(patientId, "failed");
});

test("admin issue-and-email route uses safe email-then-activate sequence", async () => {
  const route = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../../artifacts/api-server/src/routes/patients.ts", import.meta.url), "utf8"),
  );
  const start = route.indexOf('"/patients/:id/email-access-code"');
  const end = route.indexOf('"/patients/:id/email-diagnostic-access-code"');
  const slice = route.slice(start, end);
  assert.match(slice, /issueAccessCodeAndEmail/);
  assert.match(slice, /portal_access_code_issued_and_emailed/);
  // Must not replace the hash before the shared helper confirms SMTP acceptance.
  assert.equal(slice.includes("updateAccessCodeHash("), false);
});

test("cache helpers never expose codes through logs in route source", async () => {
  const route = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../../artifacts/api-server/src/routes/patients.ts", import.meta.url), "utf8"),
  );
  const start = route.indexOf('"/patients/:id/email-diagnostic-access-code"');
  const slice = route.slice(start, start + 7500);
  assert.match(slice, /beginRegistrationAccessCodeSend/);
  assert.match(slice, /emailedToMasked: maskEmail/);
  assert.match(slice, /pending_code_unavailable/);
  assert.equal(slice.includes("logger.info({ accessCode"), false);
  assert.equal(slice.includes("details: pendingCode"), false);
  assert.ok(__registrationAccessCodeCacheSizeForTests() >= 0);
});

after(async () => {
  setPortalEmailSenderForTests(null);
  __resetRegistrationAccessCodeCacheForTests();
  await cleanup();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await closePool();
});
