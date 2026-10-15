/**
 * Phase 2: Staff Desk hospital registration must never create a Patient Portal login.
 * Uploads must work without portal_user_id; later portal registration links the same record.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { after, test } from "node:test";
import {
  closePool,
  getPool,
  initDb,
  loadRootEnv,
  patientsRepo,
  resultsRepo,
  sql,
  usersRepo,
  PORTAL_USER_ROLE,
} from "@workspace/db";
import { hashPassword } from "../../artifacts/api-server/src/lib/auth.ts";

loadRootEnv();

const stamp = Date.now();
const PASSWORD = "NoPortal1!";
let hospitalPatientId = 0;
let portalUserId = 0;
let resultId = 0;
let staffId = 0;

async function cleanup() {
  const pool = await getPool();
  if (resultId > 0) {
    await pool.request().input("id", sql.Int, resultId).query("DELETE FROM dbo.result_physicians WHERE result_id = @id").catch(() => undefined);
    await pool.request().input("id", sql.Int, resultId).query("DELETE FROM dbo.results WHERE id = @id").catch(() => undefined);
  }
  if (hospitalPatientId > 0) {
    await pool.request().input("id", sql.Int, hospitalPatientId).query("DELETE FROM dbo.patient_departments WHERE patient_id = @id").catch(() => undefined);
    await pool.request().input("id", sql.Int, hospitalPatientId).query("DELETE FROM dbo.patient_physicians WHERE patient_id = @id").catch(() => undefined);
    await pool.request().input("id", sql.Int, hospitalPatientId).query("DELETE FROM dbo.patients WHERE id = @id");
  }
  for (const id of [portalUserId, staffId].filter((value) => value > 0)) {
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.auth_sessions WHERE user_id = @id").catch(() => undefined);
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.users WHERE id = @id").catch(() => undefined);
  }
}

test("staff create route never sets portalUserId or inserts a portal user", () => {
  const route = fs.readFileSync(
    new URL("../../artifacts/api-server/src/routes/patients.ts", import.meta.url),
    "utf8",
  );
  const start = route.indexOf('router.post("/patients"');
  const end = route.indexOf("router.get(\"/patients/:id\"");
  const create = route.slice(start, end > start ? end : start + 8000);
  assert.match(create, /patientsRepo\.insertPatient\(/);
  assert.equal(create.includes("portalUserId:"), false);
  assert.equal(create.includes("usersRepo.insertUser"), false);
  assert.equal(create.includes("PORTAL_USER_ROLE"), false);
});

test("hospital patient without portal can receive a result; later portal link reuses the same ids", async () => {
  await initDb();
  const passwordHash = await hashPassword(PASSWORD);

  const staff = await usersRepo.insertUser({
    username: `noportal-staff-${stamp}`,
    passwordHash,
    firstName: "No",
    lastName: "PortalStaff",
    email: null,
    role: "laboratory",
  });
  staffId = staff.id;

  const patient = await patientsRepo.insertPatient({
    patientHisId: `NOPORTAL-LIFE-${stamp}`,
    lastName: "Lifecycle",
    firstName: "Hospital",
    middleName: null,
    dateOfBirth: "1988-03-03",
    mobileNumber: null,
    email: `noportal-${stamp}@example.com`,
    accessCodeHash: passwordHash,
    createdById: staff.id,
  });
  hospitalPatientId = patient.id;
  assert.equal(patient.portalUserId, null);

  const beforeUsers = await usersRepo.findUserByUsername(`patient:NOPORTAL-LIFE-${stamp}`);
  assert.equal(beforeUsers, undefined);

  const result = await resultsRepo.insertResult({
    patientId: patient.id,
    category: "laboratory",
    fileName: `results/tmp-noportal-${stamp}.pdf`,
    originalFileName: "noportal.pdf",
    fileType: "pdf",
    fileSizeBytes: 100,
    releaseOption: "immediate",
    scheduledReleaseDate: null,
    dateReleased: new Date(),
    status: "released",
    remarks: "phase2 lifecycle",
    uploadedById: staff.id,
  });
  resultId = result.id;
  assert.equal(result.patientId, patient.id);

  const portalUser = await usersRepo.insertUser({
    username: `patient:noportal-life-${stamp}`,
    passwordHash,
    firstName: "Hospital",
    lastName: "Lifecycle",
    email: `noportal-${stamp}@example.com`,
    role: PORTAL_USER_ROLE,
  });
  portalUserId = portalUser.id;

  const linked = await patientsRepo.updatePortalUserId(patient.id, portalUser.id);
  assert.ok(linked);
  assert.equal(linked!.id, hospitalPatientId);
  assert.equal(linked!.portalUserId, portalUser.id);

  const stillLinked = await resultsRepo.findResultById(result.id);
  assert.ok(stillLinked);
  assert.equal(stillLinked!.id, resultId);
  assert.equal(stillLinked!.patientId, hospitalPatientId);

  const otherPatient = await patientsRepo.insertPatient({
    patientHisId: `OTHER-LIFE-${stamp}`,
    lastName: "Other",
    firstName: "Patient",
    middleName: null,
    dateOfBirth: "1992-04-04",
    mobileNumber: null,
    email: null,
    accessCodeHash: passwordHash,
    createdById: staff.id,
  });
  assert.notEqual(otherPatient.id, hospitalPatientId);
  assert.notEqual(stillLinked!.patientId, otherPatient.id);

  const pool = await getPool();
  await pool.request().input("id", sql.Int, otherPatient.id).query("DELETE FROM dbo.patients WHERE id = @id");
});

test("staff desk copy clarifies hospital record is not a portal login", () => {
  const page = fs.readFileSync(
    new URL("../../artifacts/ace-results-portal/src/pages/patients/new.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /does not create a Patient Portal/i);
});

after(async () => {
  await cleanup();
  await closePool();
});
