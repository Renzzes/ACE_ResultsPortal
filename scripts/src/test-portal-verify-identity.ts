import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  closeHisPool,
  closePool,
  hospitalPatientsRepo,
  HospitalQueryError,
  initDb,
  loadRootEnv,
} from "@workspace/db";

loadRootEnv();

const API = `http://127.0.0.1:${process.env.PORT ?? "5000"}`;

const known = {
  patientHisId: "1240",
  lastName: "ROSAROSO",
  dateOfBirth: "1984-06-14",
};

async function post(path: string, body: unknown) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, data };
}

test("HIS identity match by patid + last name + DOB", async () => {
  await initDb();
  const match = await hospitalPatientsRepo.verifyHospitalPatientByHisIdentity(known);
  assert.ok(match);
  assert.equal(match.patientHisId, "1240");
  assert.equal(match.lastName.toUpperCase(), "ROSAROSO");
  assert.equal(match.dateOfBirth, "1984-06-14");
  assert.equal(match.isDeceased, false);
});

test("alternate PatientID resolves to patid", async () => {
  await initDb();
  const match = await hospitalPatientsRepo.verifyHospitalPatientByHisIdentity({
    patientHisId: "11200004",
    lastName: "ROSAROSO",
    dateOfBirth: "1984-06-14",
  });
  assert.ok(match);
  assert.equal(match.patientHisId, "1240");
});

test("wrong last name is not verified", async () => {
  await initDb();
  const match = await hospitalPatientsRepo.verifyHospitalPatientByHisIdentity({
    ...known,
    lastName: "NOT-THE-PATIENT",
  });
  assert.equal(match, undefined);
});

test("wrong DOB is not verified", async () => {
  await initDb();
  const match = await hospitalPatientsRepo.verifyHospitalPatientByHisIdentity({
    ...known,
    dateOfBirth: "1999-01-01",
  });
  assert.equal(match, undefined);
});

test("invalid HIS id is not verified", async () => {
  await initDb();
  const match = await hospitalPatientsRepo.verifyHospitalPatientByHisIdentity({
    patientHisId: "NO-SUCH-PATIENT-999999",
    lastName: "ROSAROSO",
    dateOfBirth: "1984-06-14",
  });
  assert.equal(match, undefined);
});

test("case-insensitive last name", async () => {
  await initDb();
  const match = await hospitalPatientsRepo.verifyHospitalPatientByHisIdentity({
    ...known,
    lastName: "rosaroso",
  });
  assert.ok(match);
});

test("SQL injection style HIS id does not match", async () => {
  await initDb();
  const match = await hospitalPatientsRepo.verifyHospitalPatientByHisIdentity({
    patientHisId: "1240' OR 1=1 --",
    lastName: "ROSAROSO",
    dateOfBirth: "1984-06-14",
  });
  assert.equal(match, undefined);
});

test("oversized HIS id rejected", async () => {
  await initDb();
  const match = await hospitalPatientsRepo.verifyHospitalPatientByHisIdentity({
    patientHisId: "X".repeat(80),
    lastName: "ROSAROSO",
    dateOfBirth: "1984-06-14",
  });
  assert.equal(match, undefined);
});

test("invalid date format rejected", async () => {
  await initDb();
  const match = await hospitalPatientsRepo.verifyHospitalPatientByHisIdentity({
    ...known,
    dateOfBirth: "06/14/1984",
  });
  assert.equal(match, undefined);
});

test("empty values rejected", async () => {
  await initDb();
  const match = await hospitalPatientsRepo.verifyHospitalPatientByHisIdentity({
    patientHisId: "   ",
    lastName: "   ",
    dateOfBirth: "",
  });
  assert.equal(match, undefined);
});

test("verify-identity API generic failure shape", async () => {
  const result = await post("/api/portal/verify-identity", {
    ...known,
    lastName: "NOT-THE-PATIENT",
  });
  if (result.status === 404) return;
  assert.notEqual(result.data.verified, true);
  assert.equal("pkEmdPatients" in result.data, false);
  assert.equal("accessCode" in result.data, false);
  if (result.status === 401) {
    const msg =
      typeof result.data.error === "string"
        ? result.data.error
        : typeof result.data.message === "string"
          ? result.data.message
          : "";
    assert.equal(msg, "Patient information could not be verified.");
  }
});

test("verify-identity API success returns registration token for new accounts", async () => {
  const result = await post("/api/portal/verify-identity", known);
  if (result.status === 404 || result.status === 503) return;
  assert.equal(result.status, 200);
  assert.equal(result.data.verified, true);
  assert.equal("pkEmdPatients" in result.data, false);
  assert.equal("PK_emdpatients" in result.data, false);
  assert.equal("accessCode" in result.data, false);
  if (result.data.isNewPortalAccount === true) {
    assert.equal(typeof result.data.registrationToken, "string");
  }
});

test("portal register rejects invalid token", async () => {
  const result = await post("/api/portal/register", {
    registrationToken: "invalid.token.value",
    email: "test@example.com",
    confirmEmail: "test@example.com",
  });
  if (result.status === 404) return;
  assert.ok(result.status === 401 || result.status === 400);
});

test("HospitalQueryError message stays generic", () => {
  const err = new HospitalQueryError(new Error("hidden"));
  assert.equal(err.message, "HOSPITAL_DB_UNAVAILABLE");
});

after(async () => {
  await closeHisPool().catch(() => undefined);
  await closePool();
});
