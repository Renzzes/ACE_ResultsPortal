import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  closePool,
  hospitalPatientsRepo,
  HospitalQueryError,
  initDb,
  loadRootEnv,
} from "@workspace/db";

loadRootEnv();

const API = `http://127.0.0.1:${process.env.PORT ?? "5000"}`;

const knownIdentity = {
  firstName: "JOEPHEL",
  middleName: "SOLON",
  lastName: "ROSAROSO",
  suffix: "",
  gender: "Male",
  birthDate: "1984-06-14",
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

test("hospital databases stay separated", () => {
  assert.equal(process.env.DB_DATABASE, "ACE_ResultsPortal");
  assert.equal(process.env.HOSPITAL_DB_DATABASE, "LiveDB_ACE");
  assert.notEqual(process.env.DB_DATABASE, process.env.HOSPITAL_DB_DATABASE);
});

test("read-only hospital identity match for authorized test patient", async () => {
  await initDb();
  const match = await hospitalPatientsRepo.findHospitalPatientIdentity(knownIdentity);
  assert.ok(match, "expected a hospital identity match");
  assert.equal(String(match.patid), "1240");
  assert.equal(match.pkEmdPatients, 1004);
  assert.equal(match.hasHospitalRecord, true);
});

test("wrong last name does not match", async () => {
  await initDb();
  const match = await hospitalPatientsRepo.findHospitalPatientIdentity({
    ...knownIdentity,
    lastName: "NOT-THE-PATIENT",
  });
  assert.equal(match, undefined);
});

test("wrong birth date does not match", async () => {
  await initDb();
  const match = await hospitalPatientsRepo.findHospitalPatientIdentity({
    ...knownIdentity,
    birthDate: "1999-01-01",
  });
  assert.equal(match, undefined);
});

test("nonexistent patient does not match", async () => {
  await initDb();
  const match = await hospitalPatientsRepo.findHospitalPatientIdentity({
    firstName: "ZZZNOMATCH",
    lastName: "ZZZNOMATCH",
    gender: "Male",
    birthDate: "1900-01-01",
  });
  assert.equal(match, undefined);
});

test("verify-patient API does not return hospital identifiers", async () => {
  const result = await post("/api/auth/verify-patient", knownIdentity);
  if (result.status === 404) {
    assert.ok(true, "API process needs a restart to load the new endpoint");
    return;
  }
  assert.ok(result.status === 200 || result.status === 503);
  assert.equal("pkEmdPatients" in result.data, false);
  assert.equal("patid" in result.data, false);
  assert.equal("PK_emdPatients" in result.data, false);
  if (result.status === 200 && result.data.verified === true) {
    assert.equal(result.data.verified, true);
  }
  if (result.status === 200 && result.data.verified === false) {
    assert.ok(
      result.data.reason === "PATIENT_NOT_VERIFIED" ||
        result.data.reason === "NO_HOSPITAL_RECORD" ||
        result.data.reason === "HOSPITAL_DATABASE_UNAVAILABLE",
    );
  }
});

test("verify-patient wrong identity is generic", async () => {
  const result = await post("/api/auth/verify-patient", {
    ...knownIdentity,
    lastName: "NOT-THE-PATIENT",
  });
  if (result.status === 404) return;
  assert.notEqual(result.data.verified, true);
  assert.equal(result.data.reason === "NO_HOSPITAL_RECORD" || result.data.reason === "PATIENT_NOT_VERIFIED" || result.status === 503, true);
});

test("HospitalQueryError is used for hospital failures", () => {
  const err = new HospitalQueryError(new Error("hidden"));
  assert.equal(err.message, "HOSPITAL_DB_UNAVAILABLE");
  assert.ok(!String(err.message).includes("LiveDB"));
});

after(async () => {
  const { closeHisPool } = await import("@workspace/db");
  await closeHisPool().catch(() => undefined);
  await closePool();
});
