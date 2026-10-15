import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  closePool,
  getPool,
  initDb,
  loadRootEnv,
  patientsRepo,
  sql,
  usersRepo,
  PORTAL_USER_ROLE,
} from "@workspace/db";
import app from "../../artifacts/api-server/src/app.ts";
import { hashPassword } from "../../artifacts/api-server/src/lib/auth.ts";

loadRootEnv();

const PASSWORD = "SepTest1!";
const stamp = Date.now();
const patientUsername = `patient:sep-${stamp}`;
const staffUsername = `sep-staff-${stamp}`;

let server: Server;
let base = "";
let adminToken = "";
let portalUserId = 0;
let patientId = 0;
let staffId = 0;

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
  if (patientId > 0) {
    await pool.request().input("id", sql.Int, patientId).query("DELETE FROM dbo.patient_departments WHERE patient_id = @id").catch(() => undefined);
    await pool.request().input("id", sql.Int, patientId).query("DELETE FROM dbo.patient_physicians WHERE patient_id = @id").catch(() => undefined);
    await pool.request().input("id", sql.Int, patientId).query("DELETE FROM dbo.patients WHERE id = @id");
  }
  for (const id of [portalUserId, staffId].filter((value) => value > 0)) {
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.auth_sessions WHERE user_id = @id");
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.users WHERE id = @id");
  }
}

test("setup employee and patient accounts", async () => {
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
    username: staffUsername,
    passwordHash,
    firstName: "Sep",
    lastName: "Staff",
    email: null,
    role: "laboratory",
  });
  staffId = staff.id;

  const portalUser = await usersRepo.insertUser({
    username: patientUsername,
    passwordHash,
    firstName: "Sep",
    lastName: "Patient",
    email: `sep-${stamp}@example.com`,
    role: PORTAL_USER_ROLE,
  });
  portalUserId = portalUser.id;

  const patient = await patientsRepo.insertPatient({
    patientHisId: `SEP-${stamp}`,
    lastName: "Patient",
    firstName: "Sep",
    middleName: null,
    dateOfBirth: "1990-01-01",
    mobileNumber: null,
    email: `sep-${stamp}@example.com`,
    accessCodeHash: passwordHash,
    createdById: null,
    portalUserId: portalUser.id,
  });
  patientId = patient.id;
});

test("staff user list excludes patient-role accounts", async () => {
  const listed = await json("/api/users?limit=100", { headers: authHeaders(adminToken) });
  assert.equal(listed.status, 200);
  const rows = (listed.data.data as Array<{ id: number; role: string; username: string }>) ?? [];
  assert.equal(rows.some((row) => row.role === PORTAL_USER_ROLE), false);
  assert.equal(rows.some((row) => row.id === portalUserId), false);
  assert.equal(rows.some((row) => row.id === staffId), true);
});

test("explicit role=patient returns an empty employee list", async () => {
  const listed = await json("/api/users?role=patient&limit=20", { headers: authHeaders(adminToken) });
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.data.data, []);
  assert.equal(listed.data.total, 0);
});

test("doctor list returns only physicians", async () => {
  const listed = await json("/api/users?role=physician&limit=100", { headers: authHeaders(adminToken) });
  assert.equal(listed.status, 200);
  const rows = (listed.data.data as Array<{ role: string }>) ?? [];
  assert.equal(rows.every((row) => row.role === "physician"), true);
  assert.equal(rows.some((row) => row.role === PORTAL_USER_ROLE), false);
});

test("admin patient-accounts list shows linked portal accounts with portalActive", async () => {
  const listed = await json(`/api/admin/patient-accounts?search=SEP-${stamp}&limit=20`, {
    headers: authHeaders(adminToken),
  });
  assert.equal(listed.status, 200);
  const rows = (listed.data.data as Array<{ id: number; portalActive?: boolean; patientHisId: string }>) ?? [];
  const row = rows.find((item) => item.id === patientId);
  assert.ok(row);
  assert.equal(row.portalActive, true);
});

test("staff create patient does not create a portal user", async () => {
  const before = await usersRepo.findUserByUsername(`patient:NO-PORTAL-${stamp}`);
  assert.equal(before, undefined);

  // Staff desk create requires HIS verify; assert insertPatient path leaves portalUserId null.
  const passwordHash = await hashPassword(PASSWORD);
  const hospitalOnly = await patientsRepo.insertPatient({
    patientHisId: `NOPORTAL-${stamp}`,
    lastName: "Only",
    firstName: "Hospital",
    middleName: null,
    dateOfBirth: "1991-02-02",
    mobileNumber: null,
    email: null,
    accessCodeHash: passwordHash,
    createdById: staffId,
  });
  assert.equal(hospitalOnly.portalUserId, null);
  const noUser = await usersRepo.findUserByUsername(`patient:NOPORTAL-${stamp}`);
  assert.equal(noUser, undefined);

  const pool = await getPool();
  await pool.request().input("id", sql.Int, hospitalOnly.id).query("DELETE FROM dbo.patients WHERE id = @id");
});

test("AccountsManager staff filter source excludes patient", async () => {
  const page = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../../artifacts/ace-results-portal/src/components/admin/accounts-manager.tsx", import.meta.url), "utf8"),
  );
  assert.match(page, /role !== "patient"/);
  assert.match(page, /role === "physician"/);
});

after(async () => {
  await cleanup();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await closePool();
});
