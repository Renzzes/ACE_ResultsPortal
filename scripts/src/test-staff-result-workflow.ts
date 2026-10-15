import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { finalRelativeName, resultsRepo } from "@workspace/db";
import { assertAssignablePhysician } from "../../artifacts/api-server/src/lib/result-access";
import { createMemoryPatientDepartmentStore } from "../../artifacts/api-server/src/lib/patient-department-access";
import {
  evaluateStaffUploadAccess,
  isVisibleOnStaffActiveList,
  parseAssignmentPhysicianSelection,
  parseUploadPhysicianSelection,
  reconcilePhysicianIds,
  statusAfterRestore,
} from "../../artifacts/api-server/src/lib/staff-result-workflow";
import { preselectAttendingPhysicians, selectPreviewFile } from "../../artifacts/ace-results-portal/src/lib/result-upload-physicians";
import { standardDepartmentLookup } from "./department-test-fixture";

const lookup = standardDepartmentLookup();
const store = createMemoryPatientDepartmentStore([
  { patientId: 2, departmentId: 2, registeredById: 9 },
  { patientId: 5, departmentId: 4, registeredById: 7 },
]);

test("laboratory member can upload a laboratory result", async () => {
  const access = await evaluateStaffUploadAccess("laboratory", 2, "laboratory", lookup, store);
  assert.deepEqual(access, { ok: true });
});

test("laboratory staff cannot upload for a radiology-only patient", async () => {
  const access = await evaluateStaffUploadAccess("laboratory", 5, "laboratory", lookup, store);
  assert.equal(access.ok, false);
  if (!access.ok) assert.equal(access.status, 403);
});

test("radiology staff cannot upload for a laboratory-only patient", async () => {
  const access = await evaluateStaffUploadAccess("radiology", 2, "radiology", lookup, store);
  assert.equal(access.ok, false);
  if (!access.ok) assert.equal(access.status, 403);
});

test("physician and patient cannot upload", async () => {
  const physician = await evaluateStaffUploadAccess("physician", 2, "laboratory", lookup, store);
  const patient = await evaluateStaffUploadAccess("patient", 2, "laboratory", lookup, store);
  assert.equal(physician.ok, false);
  assert.equal(patient.ok, false);
  if (!physician.ok) assert.equal(physician.status, 403);
  if (!patient.ok) assert.equal(patient.status, 403);
});

test("medical records and super_admin keep global upload access", async () => {
  const records = await evaluateStaffUploadAccess("medical_records", 5, "laboratory", lookup, store);
  const admin = await evaluateStaffUploadAccess("super_admin", 2, "radiology", lookup, store);
  assert.deepEqual(records, { ok: true });
  assert.deepEqual(admin, { ok: true });
});

test("a second upload creates a new result and leaves the first unchanged", () => {
  type Stored = {
    id: number;
    patientId: number;
    status: string;
    remarks: string;
    fileName: string;
    physicianIds: number[];
  };
  const rows: Stored[] = [];
  const upload = (input: Omit<Stored, "id" | "fileName">): Stored => {
    const id = (rows.at(-1)?.id ?? 39) + 1;
    const row: Stored = { ...input, id, fileName: finalRelativeName(id, "pdf"), physicianIds: [...input.physicianIds] };
    rows.push(row);
    return { ...row, physicianIds: [...row.physicianIds] };
  };
  const first = upload({ patientId: 1240, status: "pending", remarks: "Result A note", physicianIds: [10] });
  const snapshot = structuredClone(first);
  const second = upload({ patientId: 1240, status: "released", remarks: "Result B note", physicianIds: [3] });
  const storedFirst = rows.find((row) => row.id === first.id);
  assert.deepEqual(storedFirst, snapshot);
  assert.notEqual(second.id, first.id);
  assert.notEqual(second.fileName, first.fileName);
  assert.equal(first.fileName, "results/40/result.pdf");
  assert.equal(second.fileName, "results/41/result.pdf");
  assert.deepEqual(storedFirst?.physicianIds, [10]);
  assert.equal(storedFirst?.remarks, "Result A note");
});

test("upload route inserts a new result instead of updating one by patient", () => {
  const route = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../artifacts/api-server/src/routes/results.ts"),
    "utf8",
  );
  const start = route.indexOf('router.post("/results/upload"');
  const end = route.indexOf('router.get("/results/file/:token"');
  const upload = route.slice(start, end);
  assert.match(upload, /resultsRepo\.insertResult\(/);
  assert.match(upload, /resultsRepo\.updateResultFileName\(/);
  assert.equal(upload.includes("resultsRepo.updateResult("), false);
  assert.match(upload, /reconcileAssignments\(/);
  assert.match(upload, /evaluateStaffUploadAccess\(/);
});

test("each document keeps its own result file path", () => {
  assert.equal(finalRelativeName(40, "pdf"), "results/40/result.pdf");
  assert.equal(finalRelativeName(41, "jpeg"), "results/41/result.jpeg");
  assert.notEqual(finalRelativeName(40, "pdf"), finalRelativeName(41, "pdf"));
});

test("attending physicians are preselected without dropping any", () => {
  const one = preselectAttendingPhysicians([{ id: 10, name: "Dr. A" }]);
  const many = preselectAttendingPhysicians([
    { id: 10, name: "Dr. A" },
    { id: 3, name: "Dr. B" },
    { id: 10, name: "Dr. A duplicate" },
  ]);
  assert.deepEqual(one.map((row) => row.id), [10]);
  assert.deepEqual(many.map((row) => row.id), [10, 3]);
  const page = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../artifacts/ace-results-portal/src/pages/results/upload.tsx"),
    "utf8",
  );
  assert.match(page, /\/api\/patients\/\$\{selectedPatient\.id\}\/physicians/);
  assert.match(page, /preselectAttendingPhysicians/);
});

test("result physician sets reconcile without duplicates", () => {
  const same = reconcilePhysicianIds([10, 3, 2011], [10, 3, 2011]);
  assert.deepEqual(same.finalIds, [10, 3, 2011]);
  assert.deepEqual(same.inserted, []);
  assert.deepEqual(same.removed, []);

  const changed = reconcilePhysicianIds([10, 3], [3, 2011]);
  assert.deepEqual(changed.preserved, [3]);
  assert.deepEqual(changed.inserted, [2011]);
  assert.deepEqual(changed.removed, [10]);
  assert.deepEqual(changed.finalIds, [3, 2011]);

  const cleared = reconcilePhysicianIds([10, 3], []);
  assert.deepEqual(cleared.finalIds, []);
  assert.deepEqual(cleared.removed, [10, 3]);
});

test("omitted physician fields do not clear assignments, and an explicit empty set does", () => {
  assert.equal(parseAssignmentPhysicianSelection({}).selection.kind, "omit");
  const cleared = parseAssignmentPhysicianSelection({ physicianIds: [] });
  assert.deepEqual(cleared.selection, { kind: "set", ids: [] });
  const legacy = parseAssignmentPhysicianSelection({ physicianId: 10 });
  assert.deepEqual(legacy.selection, { kind: "set", ids: [10] });
  const legacyClear = parseAssignmentPhysicianSelection({ physicianId: null });
  assert.deepEqual(legacyClear.selection, { kind: "set", ids: [] });
  const uploadMany = parseUploadPhysicianSelection({ physicianIds: ["10", "3", "2011"] });
  assert.deepEqual(uploadMany.selection, { kind: "set", ids: [10, 3, 2011] });
  const uploadOne = parseUploadPhysicianSelection({ physicianId: "10" });
  assert.deepEqual(uploadOne.selection, { kind: "set", ids: [10] });
  const uploadNone = parseUploadPhysicianSelection({});
  assert.equal(uploadNone.selection.kind, "omit");
  const invalid = parseUploadPhysicianSelection({ physicianIds: ["abc"] });
  assert.equal(invalid.ok, false);
});

test("an invalid physician is rejected", async () => {
  const rejected = await assertAssignablePhysician(9, {
    findUserById: async () => undefined,
  });
  assert.equal(rejected.ok, false);
});

test("active staff results exclude archived rows and stay inside department membership", () => {
  assert.equal(resultsRepo.staffResultsStatusClause(), "status <> N'archived'");
  assert.equal(resultsRepo.staffResultsStatusClause("pending"), "status = @status");
  const rows = [
    { id: 40, patientId: 2, status: "pending" },
    { id: 41, patientId: 2, status: "archived" },
    { id: 42, patientId: 5, status: "released" },
  ];
  const allowed = new Set([2]);
  const active = rows.filter((row) => allowed.has(row.patientId) && isVisibleOnStaffActiveList(row.status));
  const archived = rows.filter((row) => allowed.has(row.patientId) && row.status === "archived");
  assert.deepEqual(active.map((row) => row.id), [40]);
  assert.deepEqual(archived.map((row) => row.id), [41]);
  assert.equal(active.some((row) => row.patientId === 5), false);
});

test("restore returns a result to the active list and keeps its file and physicians", () => {
  const archived = {
    id: 40,
    status: "archived",
    fileName: "results/40/result.pdf",
    physicianIds: [10, 3],
    remarks: "Result A note",
  };
  const restored = { ...archived, status: statusAfterRestore() };
  assert.equal(restored.status, "pending");
  assert.equal(isVisibleOnStaffActiveList(restored.status), true);
  assert.equal(isVisibleOnStaffActiveList(archived.status), false);
  assert.equal(restored.fileName, archived.fileName);
  assert.deepEqual(restored.physicianIds, [10, 3]);
  assert.equal(restored.remarks, "Result A note");
  const archiveRoute = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../artifacts/api-server/src/routes/archive.ts"),
    "utf8",
  );
  assert.match(archiveRoute, /statusAfterRestore\(\)/);
  assert.equal(archiveRoute.includes("deleteStoredFile"), false);
});

test("selecting another file replaces only the temporary preview", () => {
  const revoked: string[] = [];
  const first = selectPreviewFile(null, "blob:a.pdf", (url) => revoked.push(url));
  const second = selectPreviewFile(first, "blob:b.pdf", (url) => revoked.push(url));
  assert.equal(first, "blob:a.pdf");
  assert.equal(second, "blob:b.pdf");
  assert.deepEqual(revoked, ["blob:a.pdf"]);
});
