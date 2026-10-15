import assert from "node:assert/strict";
import test from "node:test";
import { canMutateResult, canPortalAccessResult } from "../../artifacts/api-server/src/lib/result-access";
import {
  canAssignPhysicians,
  canCreatePatients,
  canDeletePatients,
  canDeleteResult,
  canEditPatients,
  canRegenerateAccessCode,
  canUploadResults,
} from "../../artifacts/api-server/src/lib/rbac";
import { canMessageRole } from "../../artifacts/api-server/src/lib/messaging-rbac";
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

function physician(userId = 5): AuthUser {
  return { userId, username: "dr.test", role: "physician" };
}

test("physician cannot create/edit/delete patients or assign physicians", () => {
  assert.equal(canCreatePatients("physician"), false);
  assert.equal(canEditPatients("physician"), false);
  assert.equal(canDeletePatients("physician"), false);
  assert.equal(canAssignPhysicians("physician"), false);
  assert.equal(canRegenerateAccessCode("physician"), false);
});

test("physician cannot upload or delete results", () => {
  assert.equal(canUploadResults("physician"), false);
  assert.equal(canDeleteResult("physician"), false);
});

test("physician cannot mutate result metadata", async () => {
  assert.equal(await canMutateResult(physician(), fakeResult()), false);
});

test("portal access remains own released only", () => {
  const released = fakeResult({ patientId: 5, status: "released" });
  const pending = fakeResult({ patientId: 5, status: "pending" });
  assert.equal(canPortalAccessResult(released, 5), true);
  assert.equal(canPortalAccessResult(pending, 5), false);
});

test("physician messaging RBAC", () => {
  assert.equal(canMessageRole("physician", "laboratory"), true);
  assert.equal(canMessageRole("physician", "radiology"), true);
  assert.equal(canMessageRole("physician", "medical_records"), true);
  assert.equal(canMessageRole("physician", "super_admin"), true);
  assert.equal(canMessageRole("physician", "physician"), false);
  // Role gate allows physician→patient; assignment is enforced in message routes.
  assert.equal(canMessageRole("physician", "patient"), true);
});
