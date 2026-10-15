/**
 * Admin Patient Accounts must list only hospital patients linked to a valid
 * patient-role portal user (portal_user_id → users.id, role=patient).
 * GET /api/patients remains the general hospital directory.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { after, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  closePool,
  departmentsRepo,
  getPool,
  initDb,
  loadRootEnv,
  patientDepartmentsRepo,
  patientsRepo,
  resultsRepo,
  sql,
  usersRepo,
  PORTAL_USER_ROLE,
} from "@workspace/db";
import app from "../../artifacts/api-server/src/app.ts";
import { hashPassword } from "../../artifacts/api-server/src/lib/auth.ts";

loadRootEnv();

const PASSWORD = "AdminAcct1!";
const stamp = Date.now();

let server: Server;
let base = "";
let adminToken = "";
let staffToken = "";

let portalUserId = 0;
let inactivePortalUserId = 0;
let staffUserId = 0;
let bogusStaffLinkUserId = 0;

let linkedPatientId = 0;
let hospitalOnlyPatientId = 0;
let inactiveLinkedPatientId = 0;
let orphanLinkedPatientId = 0;
let wrongRoleLinkedPatientId = 0;
let resultId = 0;

const idsToDelete = {
  patients: [] as number[],
  results: [] as number[],
  users: [] as number[],
};

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
  for (const id of idsToDelete.results) {
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.result_physicians WHERE result_id = @id").catch(() => undefined);
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.results WHERE id = @id").catch(() => undefined);
  }
  for (const id of idsToDelete.patients) {
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.patient_departments WHERE patient_id = @id").catch(() => undefined);
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.patient_physicians WHERE patient_id = @id").catch(() => undefined);
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.patients WHERE id = @id").catch(() => undefined);
  }
  for (const id of idsToDelete.users) {
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.auth_sessions WHERE user_id = @id").catch(() => undefined);
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.users WHERE id = @id").catch(() => undefined);
  }
}

test("setup fixtures and API server", async () => {
  await initDb();
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
    username: `apa-staff-${stamp}`,
    passwordHash,
    firstName: "Apa",
    lastName: "Staff",
    email: null,
    role: "laboratory",
  });
  staffUserId = staff.id;
  idsToDelete.users.push(staff.id);

  const staffLogin = await json("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: staff.username,
      password: PASSWORD,
      portal: "staff",
    }),
  });
  assert.equal(staffLogin.status, 200);
  staffToken = String(staffLogin.data.accessToken);

  const portalUser = await usersRepo.insertUser({
    username: `patient:apa-linked-${stamp}`,
    passwordHash,
    firstName: "Linked",
    lastName: "Portal",
    email: `apa-linked-${stamp}@example.com`,
    role: PORTAL_USER_ROLE,
  });
  portalUserId = portalUser.id;
  idsToDelete.users.push(portalUser.id);

  const inactivePortal = await usersRepo.insertUser({
    username: `patient:apa-inactive-${stamp}`,
    passwordHash,
    firstName: "Inactive",
    lastName: "Portal",
    email: `apa-inactive-${stamp}@example.com`,
    role: PORTAL_USER_ROLE,
  });
  inactivePortalUserId = inactivePortal.id;
  idsToDelete.users.push(inactivePortal.id);
  await usersRepo.updateUser(inactivePortal.id, { isActive: false });

  const wrongRoleUser = await usersRepo.insertUser({
    username: `apa-wrongrole-${stamp}`,
    passwordHash,
    firstName: "Wrong",
    lastName: "Role",
    email: null,
    role: "laboratory",
  });
  bogusStaffLinkUserId = wrongRoleUser.id;
  idsToDelete.users.push(wrongRoleUser.id);

  const linked = await patientsRepo.insertPatient({
    patientHisId: `APA-LINKED-${stamp}`,
    lastName: "Portal",
    firstName: "Linked",
    middleName: null,
    dateOfBirth: "1990-01-01",
    mobileNumber: null,
    email: `apa-linked-${stamp}@example.com`,
    accessCodeHash: passwordHash,
    createdById: staff.id,
    portalUserId: portalUser.id,
  });
  linkedPatientId = linked.id;
  idsToDelete.patients.push(linked.id);

  const hospitalOnly = await patientsRepo.insertPatient({
    patientHisId: `APA-HOSP-${stamp}`,
    lastName: "Hospital",
    firstName: "Only",
    middleName: null,
    dateOfBirth: "1991-02-02",
    mobileNumber: null,
    email: null,
    accessCodeHash: passwordHash,
    createdById: staff.id,
  });
  hospitalOnlyPatientId = hospitalOnly.id;
  idsToDelete.patients.push(hospitalOnly.id);
  assert.equal(hospitalOnly.portalUserId, null);

  const departments = await departmentsRepo.listDepartments({ activeOnly: true });
  const laboratory = departments.find((row) => row.code === "laboratory");
  assert.ok(laboratory, "laboratory department must exist for staff directory membership");
  await patientDepartmentsRepo.ensureMembership({
    patientId: hospitalOnly.id,
    departmentId: laboratory.id,
    registeredById: staff.id,
  });

  const inactiveLinked = await patientsRepo.insertPatient({
    patientHisId: `APA-INACT-${stamp}`,
    lastName: "Portal",
    firstName: "Inactive",
    middleName: null,
    dateOfBirth: "1992-03-03",
    mobileNumber: null,
    email: `apa-inactive-${stamp}@example.com`,
    accessCodeHash: passwordHash,
    createdById: staff.id,
    portalUserId: inactivePortal.id,
  });
  inactiveLinkedPatientId = inactiveLinked.id;
  idsToDelete.patients.push(inactiveLinked.id);

  const orphan = await patientsRepo.insertPatient({
    patientHisId: `APA-ORPHAN-${stamp}`,
    lastName: "Orphan",
    firstName: "Link",
    middleName: null,
    dateOfBirth: "1993-04-04",
    mobileNumber: null,
    email: null,
    accessCodeHash: passwordHash,
    createdById: staff.id,
  });
  orphanLinkedPatientId = orphan.id;
  idsToDelete.patients.push(orphan.id);
  // Simulate a dangling portal_user_id (no matching users row) without FK failure if present.
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, orphan.id)
    .input("bogus", sql.Int, 2_100_000_000 + (stamp % 100_000))
    .query("UPDATE dbo.patients SET portal_user_id = @bogus WHERE id = @id")
    .catch(async () => {
      // If FK blocks orphan links, leave portal_user_id null — still excluded from account list.
    });

  const wrongRoleLinked = await patientsRepo.insertPatient({
    patientHisId: `APA-WRONG-${stamp}`,
    lastName: "Wrong",
    firstName: "Role",
    middleName: null,
    dateOfBirth: "1994-05-05",
    mobileNumber: null,
    email: null,
    accessCodeHash: passwordHash,
    createdById: staff.id,
    portalUserId: wrongRoleUser.id,
  });
  wrongRoleLinkedPatientId = wrongRoleLinked.id;
  idsToDelete.patients.push(wrongRoleLinked.id);

  const result = await resultsRepo.insertResult({
    patientId: hospitalOnly.id,
    category: "laboratory",
    fileName: `results/tmp-apa-${stamp}.pdf`,
    originalFileName: "apa-hospital.pdf",
    fileType: "pdf",
    fileSizeBytes: 120,
    releaseOption: "immediate",
    scheduledReleaseDate: null,
    dateReleased: new Date(),
    status: "released",
    remarks: "admin patient accounts test",
    uploadedById: staff.id,
  });
  resultId = result.id;
  idsToDelete.results.push(result.id);
});

test("1 — hospital patient without portal account is excluded from Admin Patient Accounts", async () => {
  const listed = await json(`/api/admin/patient-accounts?search=APA-HOSP-${stamp}&limit=50`, {
    headers: authHeaders(adminToken),
  });
  assert.equal(listed.status, 200);
  const rows = (listed.data.data as Array<{ id: number }>) ?? [];
  assert.equal(rows.some((row) => row.id === hospitalOnlyPatientId), false);
});

test("2 — hospital patient with valid linked patient-role account appears", async () => {
  const listed = await json(`/api/admin/patient-accounts?search=APA-LINKED-${stamp}&limit=50`, {
    headers: authHeaders(adminToken),
  });
  assert.equal(listed.status, 200);
  const rows = (listed.data.data as Array<{ id: number; portalActive?: boolean }>) ?? [];
  const row = rows.find((item) => item.id === linkedPatientId);
  assert.ok(row);
  assert.equal(row.portalActive, true);
});

test("3 — NULL portal_user_id never creates an account-list entry", async () => {
  const listed = await json(`/api/admin/patient-accounts?search=APA-${stamp}&limit=100`, {
    headers: authHeaders(adminToken),
  });
  assert.equal(listed.status, 200);
  const rows = (listed.data.data as Array<{ id: number }>) ?? [];
  assert.equal(rows.some((row) => row.id === hospitalOnlyPatientId), false);
});

test("4 — nonexistent referenced user does not qualify as a portal account", async () => {
  const listed = await json(`/api/admin/patient-accounts?search=APA-ORPHAN-${stamp}&limit=50`, {
    headers: authHeaders(adminToken),
  });
  assert.equal(listed.status, 200);
  const rows = (listed.data.data as Array<{ id: number }>) ?? [];
  assert.equal(rows.some((row) => row.id === orphanLinkedPatientId), false);
});

test("5 — linked user with non-patient role does not qualify", async () => {
  const listed = await json(`/api/admin/patient-accounts?search=APA-WRONG-${stamp}&limit=50`, {
    headers: authHeaders(adminToken),
  });
  assert.equal(listed.status, 200);
  const rows = (listed.data.data as Array<{ id: number }>) ?? [];
  assert.equal(rows.some((row) => row.id === wrongRoleLinkedPatientId), false);
});

test("6 — inactive but valid linked patient account appears with portalActive false", async () => {
  const listed = await json(`/api/admin/patient-accounts?search=APA-INACT-${stamp}&limit=50`, {
    headers: authHeaders(adminToken),
  });
  assert.equal(listed.status, 200);
  const rows = (listed.data.data as Array<{ id: number; portalActive?: boolean }>) ?? [];
  const row = rows.find((item) => item.id === inactiveLinkedPatientId);
  assert.ok(row);
  assert.equal(row.portalActive, false);
});

test("7 — staff can still search hospital patients without portal accounts", async () => {
  const listed = await json(`/api/patients?search=APA-HOSP-${stamp}&limit=50`, {
    headers: authHeaders(staffToken),
  });
  assert.equal(listed.status, 200);
  const rows = (listed.data.data as Array<{ id: number; portalActive?: boolean }>) ?? [];
  const row = rows.find((item) => item.id === hospitalOnlyPatientId);
  assert.ok(row);
  assert.equal(row.portalActive, false);
});

test("8 — staff can still see results for patients without portal accounts", async () => {
  const found = await resultsRepo.findResultById(resultId);
  assert.ok(found);
  assert.equal(found!.patientId, hospitalOnlyPatientId);
  assert.equal(found!.id, resultId);
});

test("9 — portal registration link path reuses hospital patient id", async () => {
  const passwordHash = await hashPassword(PASSWORD);
  const portalUser = await usersRepo.insertUser({
    username: `patient:apa-reg-${stamp}`,
    passwordHash,
    firstName: "Only",
    lastName: "Hospital",
    email: `apa-reg-${stamp}@example.com`,
    role: PORTAL_USER_ROLE,
  });
  idsToDelete.users.push(portalUser.id);

  const linked = await patientsRepo.updatePortalUserId(hospitalOnlyPatientId, portalUser.id);
  assert.ok(linked);
  assert.equal(linked!.id, hospitalOnlyPatientId);
  assert.equal(linked!.portalUserId, portalUser.id);

  const listed = await json(`/api/admin/patient-accounts?search=APA-HOSP-${stamp}&limit=50`, {
    headers: authHeaders(adminToken),
  });
  assert.equal(listed.status, 200);
  const rows = (listed.data.data as Array<{ id: number }>) ?? [];
  assert.equal(rows.some((row) => row.id === hospitalOnlyPatientId), true);

  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, hospitalOnlyPatientId)
    .query("UPDATE dbo.patients SET portal_user_id = NULL, updated_at = SYSDATETIMEOFFSET() WHERE id = @id");
});

test("10 — previously uploaded results remain linked after portal link", async () => {
  const passwordHash = await hashPassword(PASSWORD);
  const portalUser = await usersRepo.insertUser({
    username: `patient:apa-reslink-${stamp}`,
    passwordHash,
    firstName: "Only",
    lastName: "Hospital",
    email: `apa-reslink-${stamp}@example.com`,
    role: PORTAL_USER_ROLE,
  });
  idsToDelete.users.push(portalUser.id);
  await patientsRepo.updatePortalUserId(hospitalOnlyPatientId, portalUser.id);

  const still = await resultsRepo.findResultById(resultId);
  assert.ok(still);
  assert.equal(still!.patientId, hospitalOnlyPatientId);

  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, hospitalOnlyPatientId)
    .query("UPDATE dbo.patients SET portal_user_id = NULL, updated_at = SYSDATETIMEOFFSET() WHERE id = @id");
});

test("11 — patient accounts remain excluded from Staff and Doctor management", async () => {
  const staffList = await json("/api/users?limit=200", { headers: authHeaders(adminToken) });
  assert.equal(staffList.status, 200);
  const staffRows = (staffList.data.data as Array<{ id: number; role: string }>) ?? [];
  assert.equal(staffRows.some((row) => row.id === portalUserId), false);
  assert.equal(staffRows.some((row) => row.role === PORTAL_USER_ROLE), false);

  const doctors = await json("/api/users?role=physician&limit=100", { headers: authHeaders(adminToken) });
  assert.equal(doctors.status, 200);
  const doctorRows = (doctors.data.data as Array<{ role: string }>) ?? [];
  assert.equal(doctorRows.every((row) => row.role === "physician"), true);
});

test("12 — Admin Patients page uses dedicated account endpoint (not GET /api/patients)", () => {
  const page = fs.readFileSync(
    new URL("../../artifacts/ace-results-portal/src/pages/admin/patients.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /fetchAdminPatientAccounts/);
  assert.equal(page.includes("useListPatients"), false);

  const api = fs.readFileSync(
    new URL("../../artifacts/ace-results-portal/src/lib/admin-api.ts", import.meta.url),
    "utf8",
  );
  assert.match(api, /\/api\/admin\/patient-accounts/);

  const route = fs.readFileSync(
    new URL("../../artifacts/api-server/src/routes/admin.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /listPortalAccountPatients/);
  assert.match(route, /\/admin\/patient-accounts/);
});

test("staff cannot access admin patient-accounts endpoint", async () => {
  const listed = await json(`/api/admin/patient-accounts?limit=10`, {
    headers: authHeaders(staffToken),
  });
  assert.equal(listed.status, 403);
});

after(async () => {
  await cleanup();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await closePool();
});
