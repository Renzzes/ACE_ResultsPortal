import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { ResultRow } from "@workspace/db";
import { canAccessResult, canPortalAccessResult } from "../../artifacts/api-server/src/lib/result-access";
import { canUploadCategory } from "../../artifacts/api-server/src/lib/rbac";
import {
  createMemoryPatientDepartmentStore,
  resolveRegistrationDepartment,
  resolveStaffPatientAccess,
  staffDirectoryConstraint,
  assertStaffMayAccessPatient,
} from "../../artifacts/api-server/src/lib/patient-department-access";
import { resolveResultCategoryScope } from "../../artifacts/api-server/src/lib/department-resolver";
import type { AuthUser } from "../../artifacts/api-server/src/middlewares/auth";
import { standardDepartmentLookup } from "./department-test-fixture";

const lookup = standardDepartmentLookup();

function staff(role: string, userId = 2): AuthUser {
  return { userId, username: role, role };
}

function fakeResult(overrides: Partial<ResultRow> = {}): ResultRow {
  return {
    id: 10,
    patientId: 2,
    category: "laboratory",
    fileName: "results/10/result.pdf",
    originalFileName: "lab.pdf",
    fileType: "pdf",
    fileSizeBytes: 12,
    releaseOption: "immediate",
    scheduledReleaseDate: null,
    dateReleased: new Date(),
    status: "released",
    remarks: null,
    uploadedById: 1,
    uploadedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

test("laboratory and radiology resolve to their departments", async () => {
  const laboratory = await resolveStaffPatientAccess("laboratory", lookup);
  const radiology = await resolveStaffPatientAccess("radiology", lookup);
  assert.deepEqual(laboratory, { status: "membership", departmentId: 2 });
  assert.deepEqual(radiology, { status: "membership", departmentId: 4 });
});

test("unknown and inactive departments still fail closed", async () => {
  assert.deepEqual(await resolveStaffPatientAccess("cardiology", lookup), { status: "forbidden" });
  const inactive = await resolveStaffPatientAccess("laboratory", async (code) => {
    const row = await lookup(code);
    return row ? { ...row, isActive: false } : undefined;
  });
  assert.deepEqual(inactive, { status: "forbidden" });
});

test("department lists follow membership and ignore a client department id", async () => {
  const store = createMemoryPatientDepartmentStore([
    { patientId: 2, departmentId: 2, registeredById: 9 },
    { patientId: 5, departmentId: 4, registeredById: 7 },
    { patientId: 6, departmentId: 2, registeredById: 9 },
    { patientId: 6, departmentId: 4, registeredById: 7 },
  ]);
  const spoofedDepartmentId = 4;
  const laboratory = await staffDirectoryConstraint("laboratory", lookup, store);
  const radiology = await staffDirectoryConstraint("radiology", lookup, store);
  assert.equal(laboratory.kind, "ids");
  assert.equal(radiology.kind, "ids");
  if (laboratory.kind !== "ids" || radiology.kind !== "ids") return;
  assert.equal(laboratory.departmentId, 2);
  assert.notEqual(laboratory.departmentId, spoofedDepartmentId);
  assert.deepEqual(laboratory.ids, [2, 6]);
  assert.deepEqual(radiology.ids, [5, 6]);
  assert.equal(laboratory.ids.includes(5), false);
  assert.equal(radiology.ids.includes(2), false);
  assert.equal(laboratory.ids.includes(6) && radiology.ids.includes(6), true);
});

test("the same patient can belong to multiple departments without a duplicate membership", async () => {
  const store = createMemoryPatientDepartmentStore();
  const patientId = 2;
  const first = await store.ensureMembership({ patientId, departmentId: 2, registeredById: 9 });
  const second = await store.ensureMembership({ patientId, departmentId: 4, registeredById: 7 });
  const duplicate = await store.ensureMembership({ patientId, departmentId: 2, registeredById: 9 });
  assert.equal(first.created, true);
  assert.equal(second.created, true);
  assert.equal(duplicate.created, false);
  assert.deepEqual(store.rows.map((row) => row.patientId), [2, 2]);
  assert.deepEqual(
    [...(await store.listDepartmentIdsForPatient(patientId))].sort(),
    [2, 4],
  );
  assert.equal(new Set(store.rows.map((row) => row.patientId)).size, 1);
});

test("registration department comes from the role, not a client department id", async () => {
  const clientDepartmentId = 4;
  const registration = await resolveRegistrationDepartment("laboratory", lookup);
  assert.deepEqual(registration, { status: "department", departmentId: 2 });
  assert.notEqual(registration.status === "department" ? registration.departmentId : 0, clientDepartmentId);
  assert.deepEqual(await resolveRegistrationDepartment("super_admin", lookup), { status: "none" });
  assert.deepEqual(await resolveRegistrationDepartment("physician", lookup), { status: "not_staff" });
  assert.deepEqual(await resolveRegistrationDepartment("patient", lookup), { status: "not_staff" });
});

test("staff cannot open or upload for a patient outside their department", async () => {
  const store = createMemoryPatientDepartmentStore([
    { patientId: 2, departmentId: 2, registeredById: 9 },
    { patientId: 5, departmentId: 4, registeredById: 7 },
  ]);
  const labOnLab = await assertStaffMayAccessPatient("laboratory", 2, lookup, store);
  const labOnRad = await assertStaffMayAccessPatient("laboratory", 5, lookup, store);
  const radOnRad = await assertStaffMayAccessPatient("radiology", 5, lookup, store);
  assert.deepEqual(labOnLab, { ok: true });
  assert.equal(labOnRad.ok, false);
  if (!labOnRad.ok) assert.equal(labOnRad.status, 403);
  assert.deepEqual(radOnRad, { ok: true });

  const member = {
    lookupDepartment: lookup,
    patientBelongsToDepartment: async (patientId: number, departmentId: number) =>
      store.patientBelongsToDepartment(patientId, departmentId),
  };
  assert.equal(await canAccessResult(staff("laboratory"), fakeResult({ patientId: 2, category: "laboratory" }), member), true);
  assert.equal(await canAccessResult(staff("laboratory"), fakeResult({ patientId: 5, category: "laboratory" }), member), false);
  assert.equal(await canAccessResult(staff("radiology"), fakeResult({ patientId: 5, category: "radiology" }), member), true);
  assert.equal(await canAccessResult(staff("radiology"), fakeResult({ patientId: 5, category: "laboratory" }), member), false);
  assert.equal(await canUploadCategory("laboratory", "laboratory", lookup), true);
  assert.equal(await canUploadCategory("laboratory", "radiology", lookup), false);
});

test("super_admin and medical_records stay global; physician and portal stay unchanged", async () => {
  assert.deepEqual(await resolveStaffPatientAccess("super_admin", lookup), { status: "global" });
  assert.deepEqual(await resolveStaffPatientAccess("medical_records", lookup), { status: "global" });
  assert.deepEqual(await resolveStaffPatientAccess("physician", lookup), { status: "physician" });
  assert.deepEqual(await resolveStaffPatientAccess("patient", lookup), { status: "none" });
  assert.deepEqual(await resolveResultCategoryScope("medical_records", lookup), {
    status: "ok",
    categories: "all",
  });

  const denyMembership = {
    lookupDepartment: lookup,
    patientBelongsToDepartment: async () => false,
  };
  assert.equal(
    await canAccessResult(staff("medical_records"), fakeResult({ category: "radiology" }), denyMembership),
    true,
  );
  assert.equal(
    await canAccessResult(staff("super_admin"), fakeResult({ category: "laboratory" }), {
      lookupDepartment: async () => {
        throw new Error("super_admin must not query departments");
      },
      patientBelongsToDepartment: async () => {
        throw new Error("super_admin must not query membership");
      },
    }),
    true,
  );
  assert.equal(
    await canAccessResult(staff("physician", 8), fakeResult({ status: "pending" }), {
      lookupDepartment: async () => {
        throw new Error("physician must not query departments");
      },
      patientBelongsToDepartment: async () => {
        throw new Error("physician must not query membership");
      },
      resolveActor: async () => ({ role: "physician", isActive: true }),
      hasResultAssignments: async () => false,
      findResultAssignment: async () => null,
      findPatientAssignment: async () => null,
    }),
    false,
  );
  assert.equal(canPortalAccessResult(fakeResult({ patientId: 2, status: "released" }), 2), true);
  assert.equal(canPortalAccessResult(fakeResult({ patientId: 2, status: "pending" }), 2), false);
  assert.equal(canPortalAccessResult(fakeResult({ patientId: 5, status: "released" }), 2), false);
});

test("migration 013 creates patient_departments and does not backfill", () => {
  const sqlPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../docs/migration/sql/013_patient_departments.sql",
  );
  const sql = fs.readFileSync(sqlPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(sql, /CREATE TABLE dbo\.patient_departments/);
  assert.match(sql, /UQ_patient_departments_patient_department UNIQUE \(patient_id, department_id\)/);
  assert.match(sql, /FK_patient_departments_patient/);
  assert.match(sql, /FK_patient_departments_department/);
  assert.match(sql, /IX_patient_departments_department_id/);
  assert.equal(/INSERT\s+INTO/i.test(sql), false);
  assert.equal(/UPDATE\s+/i.test(sql), false);
  assert.equal(/ALTER\s+TABLE\s+dbo\.patients/i.test(sql), false);
  assert.equal(/ALTER\s+TABLE\s+dbo\.results/i.test(sql), false);
});
