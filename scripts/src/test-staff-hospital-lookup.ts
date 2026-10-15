import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { HospitalPatientRecord } from "@workspace/db";
import { HospitalQueryError } from "@workspace/db/lite";
import {
  classifyStaffHospitalLookup,
  existingPatientCreateDecision,
  assembleStaffHospitalLookup,
  STAFF_HOSPITAL_LOOKUP_UNAVAILABLE,
  type StaffHospitalLookupBody,
} from "../../artifacts/api-server/src/lib/staff-hospital-lookup";
import {
  signStaffPatientReuseToken,
  verifyStaffPatientReuseToken,
} from "../../artifacts/api-server/src/lib/auth";
import { createMemoryPatientDepartmentStore } from "../../artifacts/api-server/src/lib/patient-department-access";
import { standardDepartmentLookup } from "./department-test-fixture";

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  process.env.JWT_SECRET = "test-jwt-secret-for-phase-d-hospital-lookup-32";
}

const lookup = standardDepartmentLookup();

function hospital(over: Partial<HospitalPatientRecord> = {}): HospitalPatientRecord {
  return {
    patientHisId: "1240",
    firstName: "JOEPHEL",
    middleName: null,
    lastName: "ROSAROSO",
    dateOfBirth: "1984-06-14",
    pkEmdPatients: 99,
    isDeceased: false,
    ...over,
  };
}

const patients = new Map<string, { id: number; portalUserId: number | null }>();

function resetPatients() {
  patients.clear();
  patients.set("1240", { id: 2, portalUserId: 11 });
}

async function assemble(input: {
  role?: string;
  matches?: { status: "none" } | { status: "ambiguous" } | { status: "one"; record: HospitalPatientRecord };
  user?: { id: number; role: string; isActive: boolean } | null;
}): Promise<StaffHospitalLookupBody> {
  const result = await assembleStaffHospitalLookup({
    role: input.role ?? "laboratory",
    staffUserId: 9,
    matches: input.matches ?? { status: "one", record: hospital() },
    lookupDepartment: lookup,
    findPortalPatient: async (hisId) => {
      const row = patients.get(hisId);
      return row ? { id: row.id, portalUserId: row.portalUserId, patientHisId: hisId } : undefined;
    },
    findPortalUser: async () => input.user === undefined
      ? { id: 11, role: "patient", isActive: true }
      : input.user ?? undefined,
    membershipExists: async (patientId, departmentId) =>
      patientId === 2 && departmentId === 4,
    signReuseToken: (payload) => `token:${payload.patientHisId}:${payload.staffUserId}:${payload.departmentId}`,
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("lookup failed");
  return result.body;
}

test("hospital record without a portal patient continues registration", async () => {
  patients.clear();
  const body = await assemble({});
  assert.equal(body.action, "CONTINUE_REGISTRATION");
  assert.equal(body.hospitalRecordFound, true);
  assert.equal(body.portalPatientFound, false);
  assert.equal(body.portalAccountFound, false);
  assert.equal(body.reuseToken, undefined);
  assert.equal(body.patientId, undefined);
});

test("existing portal patient without an account is reused", async () => {
  resetPatients();
  patients.set("1240", { id: 2, portalUserId: null });
  const body = await assemble({ user: null });
  assert.equal(body.action, "USE_EXISTING_PATIENT");
  assert.equal(body.portalPatientFound, true);
  assert.equal(body.portalAccountFound, false);
  assert.equal(body.patientId, 2);
  assert.ok(body.reuseToken);
});

test("existing portal account is explicit and is not a create path", async () => {
  resetPatients();
  const body = await assemble({});
  assert.equal(body.hospitalRecordFound, true);
  assert.equal(body.portalPatientFound, true);
  assert.equal(body.portalAccountFound, true);
  assert.equal(body.action, "USE_EXISTING_ACCOUNT");
  assert.equal(body.message, "Already have an Account and Hospital Record Verified – Use Existing Account");
  assert.equal(body.departmentMembershipExists, false);
  assert.notEqual(body.action, "CONTINUE_REGISTRATION");
});

test("current department membership and another department are both explicit", async () => {
  resetPatients();
  const laboratory = await assemble({ role: "laboratory" });
  const radiology = await assemble({ role: "radiology" });
  assert.equal(laboratory.departmentMembershipExists, false);
  assert.equal(radiology.departmentMembershipExists, true);
  assert.equal(laboratory.patientId, radiology.patientId);
});

test("linking the same patient does not create another patient or membership", async () => {
  const store = createMemoryPatientDepartmentStore();
  const patientId = 2;
  const first = await store.ensureMembership({ patientId, departmentId: 2, registeredById: 9 });
  const again = await store.ensureMembership({ patientId, departmentId: 2, registeredById: 9 });
  const radiology = await store.ensureMembership({ patientId, departmentId: 4, registeredById: 7 });
  assert.equal(first.created, true);
  assert.equal(again.created, false);
  assert.equal(radiology.created, true);
  assert.equal(new Set(store.rows.map((row) => row.patientId)).size, 1);
  assert.equal(store.rows.length, 2);
});

test("reuse does not issue an access code and ignores a client department id", () => {
  const registration = { status: "department" as const, departmentId: 2 };
  const token = { patientHisId: "1240", staffUserId: 9, departmentId: 2 };
  assert.equal(
    existingPatientCreateDecision({
      token,
      staffUserId: 9,
      hospitalHisId: "1240",
      registration,
      clientDepartmentId: 4,
    }),
    "link",
  );
  assert.equal(
    existingPatientCreateDecision({
      token: null,
      staffUserId: 9,
      hospitalHisId: "1240",
      registration,
      clientDepartmentId: 2,
    }),
    "conflict",
  );
  assert.equal(
    existingPatientCreateDecision({
      token: { patientHisId: "1240", staffUserId: 9, departmentId: 4 },
      staffUserId: 9,
      hospitalHisId: "1240",
      registration,
    }),
    "forbidden",
  );
  assert.equal(
    existingPatientCreateDecision({
      token: { patientHisId: "9999", staffUserId: 9, departmentId: 2 },
      staffUserId: 9,
      hospitalHisId: "1240",
      registration,
    }),
    "conflict",
  );
});

test("inactive and wrong-role portal users need resolution instead of a new patient", async () => {
  resetPatients();
  const inactive = await assemble({ user: { id: 11, role: "patient", isActive: false } });
  const physician = await assemble({ user: { id: 11, role: "physician", isActive: true } });
  assert.equal(inactive.action, "ACCOUNT_NEEDS_RESOLUTION");
  assert.equal(inactive.patientId, 2);
  assert.equal(physician.action, "ACCOUNT_NEEDS_RESOLUTION");
  assert.equal(physician.portalAccountFound, false);
});

test("a missing portal link is not treated as an account", () => {
  const base = {
    hospital: "found" as const,
    portalPatientFound: true,
    departmentMembershipExists: false,
  };
  assert.equal(classifyStaffHospitalLookup({ ...base, portalLink: "none" }).action, "USE_EXISTING_PATIENT");
  assert.equal(classifyStaffHospitalLookup({ ...base, portalLink: "none" }).portalAccountFound, false);
  assert.equal(
    classifyStaffHospitalLookup({ ...base, portalLink: "needs_resolution" }).action,
    "ACCOUNT_NEEDS_RESOLUTION",
  );
  assert.equal(
    classifyStaffHospitalLookup({ ...base, portalLink: "needs_resolution" }).portalAccountFound,
    false,
  );
});

test("not found is distinct from an unavailable hospital lookup", async () => {
  patients.clear();
  const missing = await assemble({ matches: { status: "none" } });
  assert.equal(missing.action, "NOT_FOUND");
  assert.equal(missing.hospitalRecordFound, false);
  assert.equal(missing.message.includes("Unable to verify"), false);
  assert.equal(STAFF_HOSPITAL_LOOKUP_UNAVAILABLE.includes("No hospital record"), false);
  const unavailable = new HospitalQueryError();
  assert.equal(unavailable instanceof HospitalQueryError, true);
  assert.notEqual(unavailable.message, missing.message);
});

test("ambiguous hospital matches are not auto-selected", async () => {
  const body = await assemble({ matches: { status: "ambiguous" } });
  assert.equal(body.action, "AMBIGUOUS");
  assert.equal(body.patientId, undefined);
  assert.equal(body.reuseToken, undefined);
});

test("super_admin stays global and medical_records still resolves a department", async () => {
  resetPatients();
  const admin = await assemble({ role: "super_admin" });
  assert.equal(admin.action, "USE_EXISTING_ACCOUNT");
  assert.equal(admin.departmentMembershipExists, null);
  const records = await assemble({ role: "medical_records" });
  assert.equal(records.departmentMembershipExists, false);
  assert.equal(records.patientId, 2);
});

test("reuse token is bound to the staff user and hospital id", () => {
  const token = signStaffPatientReuseToken({
    patientHisId: "1240",
    staffUserId: 9,
    departmentId: 2,
  });
  const verified = verifyStaffPatientReuseToken(token);
  assert.equal(verified?.patientHisId, "1240");
  assert.equal(verified?.staffUserId, 9);
  assert.equal(verified?.departmentId, 2);
  assert.equal(verifyStaffPatientReuseToken("not-a-token"), null);
  assert.equal(
    existingPatientCreateDecision({
      token: verified,
      staffUserId: 8,
      hospitalHisId: "1240",
      registration: { status: "department", departmentId: 2 },
    }),
    "forbidden",
  );
});

test("hospital lookup route requires auth and the HIS query stays read-only", () => {
  const route = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../artifacts/api-server/src/routes/patients.ts"),
    "utf8",
  );
  const start = route.indexOf('"/patients/hospital-lookup"');
  assert.ok(start > 0);
  assert.match(route.slice(Math.max(0, start - 40), start + 40), /requireAuth/);
  const repo = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../lib/db/src/repos/hospital-patients.ts"),
    "utf8",
  );
  const fn = repo.slice(repo.indexOf("export async function findHospitalPatientMatches"));
  assert.match(fn.slice(0, 1200), /SELECT TOP \(25\)/);
  assert.equal(/\b(INSERT|UPDATE|DELETE|MERGE)\b/i.test(fn.slice(0, 1200)), false);
});
