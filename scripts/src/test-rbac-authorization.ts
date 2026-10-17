import assert from "node:assert/strict";
import test from "node:test";
import {
  canArchiveResult,
  canAssignPhysicians,
  canCreatePatients,
  canDeletePatients,
  canDeleteResult,
  canEditPatients,
  canRegenerateAccessCode,
  canReleaseResult,
  canUploadCategory,
  canUploadResults,
  canViewAuditLogs,
} from "../../artifacts/api-server/src/lib/rbac";
import { canAccessResult, canMutateResult, canPortalAccessResult } from "../../artifacts/api-server/src/lib/result-access";
import { resolveResultCategoryScope } from "../../artifacts/api-server/src/lib/department-resolver";
import { standardDepartmentLookup } from "./department-test-fixture";
import type { ResultRow } from "@workspace/db";
import type { AuthUser } from "../../artifacts/api-server/src/middlewares/auth";

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
    status: "pending",
    remarks: null,
    uploadedById: 1,
    uploadedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    accessCodeHash: null,
    accessCodeEncrypted: null,
    accessCodeIssuedAt: null,
    accessCodeEmailedAt: null,
    accessCodeEmailStatus: null,
    ...overrides,
  };
}

function staff(role: string, userId = 2): AuthUser {
  return { userId, username: `user-${role}`, role };
}

test("physician cannot create patients or regenerate access codes", () => {
  assert.equal(canCreatePatients("physician"), false);
  assert.equal(canRegenerateAccessCode("physician"), false);
  assert.equal(canCreatePatients("laboratory"), true);
  assert.equal(canRegenerateAccessCode("radiology"), true);
});

test("only medical_records and super_admin edit/delete/assign patients", () => {
  for (const role of ["laboratory", "radiology", "endoscopy", "physician"]) {
    assert.equal(canEditPatients(role), false, role);
    assert.equal(canDeletePatients(role), false, role);
    assert.equal(canAssignPhysicians(role), false, role);
  }
  assert.equal(canEditPatients("medical_records"), true);
  assert.equal(canAssignPhysicians("super_admin"), true);
});

test("department category upload scope", async () => {
  const lookup = standardDepartmentLookup();
  assert.equal(canUploadResults("physician"), false);
  assert.equal(canUploadResults("medical_records"), true);
  assert.equal(canUploadResults("laboratory"), true);
  assert.equal(await canUploadCategory("laboratory", "laboratory", lookup), true);
  assert.equal(await canUploadCategory("laboratory", "radiology", lookup), false);
  assert.equal(await canUploadCategory("radiology", "mri", lookup), true);
  assert.equal(await canUploadCategory("radiology", "laboratory", lookup), false);
  assert.equal(await canUploadCategory("endoscopy", "other", lookup), true);
  assert.equal(await canUploadCategory("endoscopy", "laboratory", lookup), false);
  assert.equal(await canUploadCategory("medical_records", "laboratory", lookup), true);
});

test("result delete is medical_records/super_admin only", () => {
  assert.equal(canDeleteResult("laboratory"), false);
  assert.equal(canDeleteResult("radiology"), false);
  assert.equal(canDeleteResult("medical_records"), true);
  assert.equal(canDeleteResult("super_admin"), true);
});

test("lab/rad can release and archive in-scope; restore needs archive flag", () => {
  assert.equal(canReleaseResult("laboratory"), true);
  assert.equal(canArchiveResult("radiology"), true);
  assert.equal(canViewAuditLogs("laboratory"), false);
  assert.equal(canViewAuditLogs("medical_records"), true);
});

test("result scope follows departments.result_scope", async () => {
  const lookup = standardDepartmentLookup();
  assert.deepEqual(await resolveResultCategoryScope("laboratory", lookup), {
    status: "ok",
    categories: ["laboratory"],
  });
  const rad = await resolveResultCategoryScope("radiology", lookup);
  assert.equal(rad.status, "ok");
  if (rad.status === "ok" && Array.isArray(rad.categories)) {
    assert.ok(rad.categories.includes("mri") && !rad.categories.includes("laboratory"));
  } else {
    assert.fail("radiology scope should be a category list");
  }
  assert.deepEqual(await resolveResultCategoryScope("super_admin", lookup), { status: "ok", categories: "all" });
  assert.deepEqual(await resolveResultCategoryScope("medical_records", lookup), { status: "ok", categories: "all" });
});

test("canAccessResult denies cross-department staff access", async () => {
  const lookup = standardDepartmentLookup();
  const deps = { lookupDepartment: lookup, patientBelongsToDepartment: async () => true };
  const labResult = fakeResult({ category: "laboratory", status: "released" });
  const radResult = fakeResult({ id: 11, category: "radiology", status: "released" });

  assert.equal(await canAccessResult(staff("laboratory"), labResult, deps), true);
  assert.equal(await canAccessResult(staff("laboratory"), radResult, deps), false);
  assert.equal(await canAccessResult(staff("radiology"), radResult, deps), true);
  assert.equal(await canAccessResult(staff("radiology"), labResult, deps), false);
  assert.equal(await canAccessResult(staff("super_admin"), radResult, deps), true);
  assert.equal(await canAccessResult(staff("medical_records"), labResult, deps), true);
});

test("canMutateResult denies physician and out-of-scope departments", async () => {
  const lookup = standardDepartmentLookup();
  const deps = { lookupDepartment: lookup, patientBelongsToDepartment: async () => true };
  const labPending = fakeResult({ category: "laboratory", status: "pending" });
  assert.equal(await canMutateResult(staff("physician"), labPending, deps), false);
  assert.equal(await canMutateResult(staff("laboratory"), labPending, deps), true);
  assert.equal(await canMutateResult(staff("radiology"), labPending, deps), false);
});

test("portal access is own released only", () => {
  const released = fakeResult({ patientId: 5, status: "released" });
  const pending = fakeResult({ patientId: 5, status: "pending" });
  assert.equal(canPortalAccessResult(released, 5), true);
  assert.equal(canPortalAccessResult(released, 6), false);
  assert.equal(canPortalAccessResult(pending, 5), false);
});
