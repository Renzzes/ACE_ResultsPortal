/**
 * Phase 3: Result upload category is resolved server-side from the staff department.
 * Department roles ignore client category. Global/"all" roles require a valid category.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  resolveServerUploadCategory,
  requestedCategoryWithinScope,
} from "../../artifacts/api-server/src/lib/department-resolver";
import { standardDepartmentLookup } from "./department-test-fixture";

const lookup = standardDepartmentLookup();

test("laboratory uploads resolve to laboratory", async () => {
  const resolved = await resolveServerUploadCategory("laboratory", undefined, lookup);
  assert.deepEqual(resolved, { ok: true, category: "laboratory" });
});

test("radiology uploads resolve to radiology", async () => {
  const resolved = await resolveServerUploadCategory("radiology", "laboratory", lookup);
  assert.deepEqual(resolved, { ok: true, category: "radiology" });
});

test("endoscopy uploads resolve to other (endoscopy scope)", async () => {
  const resolved = await resolveServerUploadCategory("endoscopy", undefined, lookup);
  assert.deepEqual(resolved, { ok: true, category: "other" });
});

test("medical_records and super_admin require a valid client category", async () => {
  const recordsMissing = await resolveServerUploadCategory("medical_records", undefined, lookup);
  const adminMissing = await resolveServerUploadCategory("super_admin", "", lookup);
  assert.equal(recordsMissing.ok, false);
  assert.equal(adminMissing.ok, false);
  if (!recordsMissing.ok) assert.equal(recordsMissing.status, 400);
  if (!adminMissing.ok) assert.equal(adminMissing.status, 400);

  const recordsOk = await resolveServerUploadCategory("medical_records", "laboratory", lookup);
  const adminOk = await resolveServerUploadCategory("super_admin", "radiology", lookup);
  assert.deepEqual(recordsOk, { ok: true, category: "laboratory" });
  assert.deepEqual(adminOk, { ok: true, category: "radiology" });
});

test("physician and patient fail closed for upload category", async () => {
  const physician = await resolveServerUploadCategory("physician", "laboratory", lookup);
  const patient = await resolveServerUploadCategory("patient", "laboratory", lookup);
  assert.equal(physician.ok, false);
  assert.equal(patient.ok, false);
});

test("unknown role fails closed", async () => {
  const resolved = await resolveServerUploadCategory("not_a_role", "laboratory", lookup);
  assert.equal(resolved.ok, false);
});

test("client-supplied category cannot widen laboratory scope", () => {
  const gate = requestedCategoryWithinScope("radiology", ["laboratory"]);
  assert.equal(gate.denied, true);
});

test("upload route derives category via resolveServerUploadCategory", () => {
  const route = fs.readFileSync(
    new URL("../../artifacts/api-server/src/routes/results.ts", import.meta.url),
    "utf8",
  );
  const start = route.indexOf('router.post("/results/upload"');
  const end = route.indexOf('router.get("/results/file/:token"');
  const upload = route.slice(start, end);
  assert.match(upload, /resolveServerUploadCategory\(/);
  assert.match(upload, /requestedCategory/);
  assert.equal(/const category = String\(req\.body\.category/.test(upload), false);
  assert.equal(/req\.body\.category as ResultCategory/.test(upload), false);
});

test("department staff upload UI has no category selector; global roles do", () => {
  const page = fs.readFileSync(
    new URL("../../artifacts/ace-results-portal/src/pages/results/upload.tsx", import.meta.url),
    "utf8",
  );
  const dialog = fs.readFileSync(
    new URL("../../artifacts/ace-results-portal/src/components/staff/upload-result-dialog.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /staffNeedsUploadCategoryUi/);
  assert.match(dialog, /staffNeedsUploadCategoryUi/);
  assert.match(page, /needsCategory/);
  assert.match(dialog, /needsCategory/);
});

test("upload UI permission mirrors Admin upload_results and allows Medical Records", () => {
  const permissions = fs.readFileSync(
    new URL("../../artifacts/ace-results-portal/src/lib/staff-permissions.ts", import.meta.url),
    "utf8",
  );
  assert.match(permissions, /export function canUploadResultFileUi/);
  assert.match(permissions, /uploadResults/);
  assert.equal(/role === "medical_records"\) return false/.test(permissions), false);

  const rolesPage = fs.readFileSync(
    new URL("../../artifacts/ace-results-portal/src/pages/admin/roles.tsx", import.meta.url),
    "utf8",
  );
  assert.match(rolesPage, /upload_results/);
  assert.match(rolesPage, /Upload results/);

  const detail = fs.readFileSync(
    new URL("../../artifacts/ace-results-portal/src/pages/patients/detail.tsx", import.meta.url),
    "utf8",
  );
  const uploadPage = fs.readFileSync(
    new URL("../../artifacts/ace-results-portal/src/pages/results/upload.tsx", import.meta.url),
    "utf8",
  );
  const resultsList = fs.readFileSync(
    new URL("../../artifacts/ace-results-portal/src/pages/results/index.tsx", import.meta.url),
    "utf8",
  );
  const dashboard = fs.readFileSync(
    new URL("../../artifacts/ace-results-portal/src/pages/dashboard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(detail, /canUploadResultFileUi/);
  assert.match(uploadPage, /canUploadResultFileUi/);
  assert.match(resultsList, /canUploadResultFileUi/);
  assert.match(dashboard, /canUploadResultFileUi/);
});
