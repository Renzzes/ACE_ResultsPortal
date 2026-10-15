import assert from "node:assert/strict";
import test from "node:test";
import type { Department, DepartmentResultScope, ResultRow } from "@workspace/db";
import { PATIENT_HIS_ID_COLUMN } from "@workspace/db";
import { AppError } from "../../artifacts/api-server/src/lib/errors";
import {
  categoriesForResultScope,
  lookupDepartments,
  requestedCategoryWithinScope,
  resolveResultCategoryScope,
  resolveStaffDepartment,
  type DepartmentLookup,
} from "../../artifacts/api-server/src/lib/department-resolver";
import { canMessageRole } from "../../artifacts/api-server/src/lib/messaging-rbac";
import { canPortalAccessResult, canAccessResult, canMutateResult } from "../../artifacts/api-server/src/lib/result-access";
import { canUploadCategory } from "../../artifacts/api-server/src/lib/rbac";
import { assertPhysicianMayAccessPatient } from "../../artifacts/api-server/src/lib/prescription-access";
import type { AuthUser } from "../../artifacts/api-server/src/middlewares/auth";
import { departmentRow, standardDepartmentLookup, standardDepartments } from "./department-test-fixture";

function staff(role: string, userId = 2): AuthUser {
  return { userId, username: `user-${role}`, role };
}

function fakeResult(overrides: Partial<ResultRow> = {}): ResultRow {
  return {
    id: 10,
    patientId: 100,
    category: "laboratory",
    fileName: "results/10/result.pdf",
    originalFileName: "lab.pdf",
    fileType: "pdf",
    fileSizeBytes: 12,
    releaseOption: "immediate",
    scheduledReleaseDate: null,
    dateReleased: null,
    status: "released",
    remarks: null,
    uploadedById: 1,
    uploadedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function throwingLookup(label: string): DepartmentLookup {
  return async () => {
    throw new Error(`${label} must not query departments`);
  };
}

test("laboratory, radiology, endoscopy, and medical_records resolve from role code", async () => {
  const lookup = standardDepartmentLookup();
  const laboratory = await resolveStaffDepartment("laboratory", lookup);
  assert.equal(laboratory.ok && laboratory.kind === "department" && laboratory.department.code, "laboratory");
  if (laboratory.ok && laboratory.kind === "department") {
    assert.equal(laboratory.department.id, 2);
    assert.equal(laboratory.department.name, "Laboratory");
    assert.equal(laboratory.department.resultScope, "laboratory");
    assert.equal(laboratory.department.isActive, true);
  }

  const radiology = await resolveStaffDepartment("  Radiology ", lookup);
  assert.equal(radiology.ok && radiology.kind === "department" && radiology.department.id, 4);
  if (radiology.ok && radiology.kind === "department") {
    assert.equal(radiology.department.resultScope, "radiology");
  }

  const endoscopy = await resolveStaffDepartment("endoscopy", lookup);
  assert.equal(endoscopy.ok && endoscopy.kind === "department" && endoscopy.department.resultScope, "other");

  const records = await resolveStaffDepartment("medical_records", lookup);
  assert.equal(records.ok && records.kind === "department" && records.department.resultScope, "all");
});

test("super_admin, physician, and patient do not require a department row", async () => {
  const lookup = throwingLookup("global");
  const admin = await resolveStaffDepartment("super_admin", lookup);
  assert.deepEqual(admin, { ok: true, kind: "global" });

  const physician = await resolveStaffDepartment("physician", throwingLookup("physician"));
  assert.deepEqual(physician, { ok: true, kind: "not_department", role: "physician" });

  const patient = await resolveStaffDepartment("patient", throwingLookup("patient"));
  assert.deepEqual(patient, { ok: true, kind: "not_department", role: "patient" });

  assert.equal((await resolveResultCategoryScope("super_admin", lookup)).status, "ok");
  assert.deepEqual(await resolveResultCategoryScope("physician", throwingLookup("physician-scope")), {
    status: "ok",
    categories: "all",
  });
  assert.deepEqual(await resolveResultCategoryScope("patient", throwingLookup("patient-scope")), {
    status: "none",
  });
});

test("inactive and unknown departments fail closed", async () => {
  const rows = standardDepartments().map((row) =>
    row.code === "laboratory" ? { ...row, isActive: false } : row,
  );
  const lookup = lookupDepartments(rows);
  const inactive = await resolveStaffDepartment("laboratory", lookup);
  assert.deepEqual(inactive, { ok: false, reason: "inactive" });
  assert.deepEqual(await resolveResultCategoryScope("laboratory", lookup), { status: "forbidden" });
  assert.equal(
    await canAccessResult(staff("laboratory"), fakeResult({ category: "laboratory" }), {
      lookupDepartment: lookup,
    }),
    false,
  );

  const unknown = await resolveStaffDepartment("cardiology", lookup);
  assert.deepEqual(unknown, { ok: false, reason: "unknown" });
  assert.deepEqual(await resolveResultCategoryScope("cardiology", lookup), { status: "forbidden" });
  assert.equal(
    await canAccessResult(staff("cardiology"), fakeResult(), { lookupDepartment: lookup }),
    false,
  );
});

test("result_scope is authoritative and unknown scopes fail closed", async () => {
  const radiology = categoriesForResultScope("radiology");
  assert.ok(Array.isArray(radiology));
  assert.ok(radiology.includes("mri"));
  assert.ok(radiology.includes("echo_2d"));
  assert.ok(radiology.includes("ultrasound"));
  assert.equal(radiology.includes("laboratory"), false);
  assert.deepEqual(categoriesForResultScope("laboratory"), ["laboratory"]);
  assert.deepEqual(categoriesForResultScope("other"), ["other"]);
  assert.equal(categoriesForResultScope("all"), "all");
  assert.equal(categoriesForResultScope("cardiology"), null);

  const narrowed = standardDepartments().map((row) =>
    row.code === "radiology" ? { ...row, resultScope: "laboratory" as DepartmentResultScope } : row,
  );
  const lookup = lookupDepartments(narrowed);
  assert.deepEqual(await resolveResultCategoryScope("radiology", lookup), {
    status: "ok",
    categories: ["laboratory"],
  });
  assert.equal(
    await canAccessResult(staff("radiology"), fakeResult({ category: "laboratory" }), {
      lookupDepartment: lookup,
      patientBelongsToDepartment: async () => true,
    }),
    true,
  );
  assert.equal(
    await canAccessResult(staff("radiology"), fakeResult({ category: "radiology" }), {
      lookupDepartment: lookup,
      patientBelongsToDepartment: async () => true,
    }),
    false,
  );
  assert.equal(await canUploadCategory("radiology", "laboratory", lookup), true);
  assert.equal(await canUploadCategory("radiology", "mri", lookup), false);

  const invalid = lookupDepartments([
    departmentRow({
      id: 9,
      code: "laboratory",
      name: "Laboratory",
      resultScope: "unexpected" as DepartmentResultScope,
    }),
  ]);
  assert.deepEqual(await resolveStaffDepartment("laboratory", invalid), {
    ok: false,
    reason: "invalid_scope",
  });
  assert.deepEqual(await resolveResultCategoryScope("laboratory", invalid), { status: "misconfigured" });
  await assert.rejects(
    () => canAccessResult(staff("laboratory"), fakeResult(), { lookupDepartment: invalid }),
    (err: unknown) => err instanceof AppError && err.status === 500 && !/sql|department id|unexpected/i.test(err.message),
  );
});

test("client category cannot widen department scope", async () => {
  const lookup = standardDepartmentLookup();
  const laboratory = await resolveResultCategoryScope("laboratory", lookup);
  assert.equal(laboratory.status, "ok");
  if (laboratory.status !== "ok") return;
  assert.equal(requestedCategoryWithinScope("radiology", laboratory.categories).denied, true);
  assert.equal(requestedCategoryWithinScope("laboratory", laboratory.categories).denied, false);
  assert.deepEqual(requestedCategoryWithinScope("laboratory", laboratory.categories).category, "laboratory");

  const radiology = await resolveResultCategoryScope("radiology", lookup);
  assert.equal(radiology.status, "ok");
  if (radiology.status !== "ok") return;
  assert.equal(requestedCategoryWithinScope("laboratory", radiology.categories).denied, true);
  assert.equal(requestedCategoryWithinScope("mri", radiology.categories).denied, false);

  const records = await resolveResultCategoryScope("medical_records", lookup);
  assert.deepEqual(records, { status: "ok", categories: "all" });
  assert.equal(requestedCategoryWithinScope("laboratory", "all").denied, false);
  assert.equal(requestedCategoryWithinScope("not-a-category", "all").denied, true);
});

test("current live department scopes keep existing result authorization", async () => {
  const lookup = standardDepartmentLookup();
  const lab = fakeResult({ category: "laboratory" });
  const rad = fakeResult({ id: 11, category: "radiology" });
  const echo = fakeResult({ id: 12, category: "echo_2d" });
  const deps = { lookupDepartment: lookup, patientBelongsToDepartment: async () => true };

  assert.equal(await canAccessResult(staff("laboratory"), lab, deps), true);
  assert.equal(await canAccessResult(staff("laboratory"), rad, deps), false);
  assert.equal(await canAccessResult(staff("radiology"), rad, deps), true);
  assert.equal(await canAccessResult(staff("radiology"), echo, deps), true);
  assert.equal(await canAccessResult(staff("radiology"), lab, deps), false);
  assert.equal(await canAccessResult(staff("endoscopy"), fakeResult({ category: "other" }), deps), true);
  assert.equal(await canAccessResult(staff("endoscopy"), lab, deps), false);
  assert.equal(await canAccessResult(staff("medical_records"), lab, deps), true);
  assert.equal(await canAccessResult(staff("medical_records"), rad, deps), true);
  assert.equal(await canAccessResult(staff("super_admin"), rad, { lookupDepartment: throwingLookup("admin-access") }), true);

  assert.equal(await canUploadCategory("laboratory", "laboratory", lookup), true);
  assert.equal(await canUploadCategory("laboratory", "radiology", lookup), false);
  assert.equal(await canUploadCategory("radiology", "mri", lookup), true);
  assert.equal(await canMutateResult(staff("laboratory"), fakeResult({ status: "pending" }), deps), true);
  assert.equal(await canMutateResult(staff("radiology"), fakeResult({ category: "laboratory", status: "pending" }), deps), false);
});

test("physician, portal, messaging, and scheduler boundaries stay outside department resolution", async () => {
  const released = fakeResult({ patientId: 5, status: "released" });
  assert.equal(canPortalAccessResult(released, 5), true);
  assert.equal(canPortalAccessResult(released, 6), false);
  assert.equal(canPortalAccessResult(fakeResult({ patientId: 5, status: "pending" }), 5), false);

  assert.equal(canMessageRole("laboratory", "physician"), true);
  assert.equal(canMessageRole("laboratory", "patient"), false);
  assert.equal(canMessageRole("physician", "physician"), false);

  assert.equal(PATIENT_HIS_ID_COLUMN, "PatientHisId");

  const access = await assertPhysicianMayAccessPatient(staff("physician", 7), 100, {
    findUserById: async () => ({ id: 7, role: "physician", isActive: true }),
    findPatientById: async () => ({ id: 100 }),
    findAssignment: async () => ({ id: 1 }),
  });
  assert.deepEqual(access, { ok: true });

  const missing = await canAccessResult(
    staff("physician", 8),
    fakeResult({ status: "pending" }),
    {
      lookupDepartment: throwingLookup("physician-result"),
      resolveActor: async () => ({ role: "physician", isActive: true }),
      hasResultAssignments: async () => false,
      findResultAssignment: async () => null,
      findPatientAssignment: async () => null,
    },
  );
  assert.equal(missing, false);
});

test("department lookup is select-only in this suite", async () => {
  const calls: string[] = [];
  const lookup: DepartmentLookup = async (code) => {
    calls.push(code);
    return standardDepartments().find((row) => row.code === code);
  };
  const resolved = await resolveStaffDepartment("laboratory", lookup);
  assert.deepEqual(calls, ["laboratory"]);
  assert.equal(resolved.ok, true);
});
