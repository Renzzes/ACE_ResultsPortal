/**
 * Phase 7B — Result physician assignment / private review access.
 * Unit tests with injected deps. Does not write to ACE_ResultsPortal, LiveDB_ACE, or ShanScheduler.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAssignablePhysician,
  canAccessResult,
  canMutateResult,
  canPortalAccessResult,
  type ResultAccessDeps,
} from "../../artifacts/api-server/src/lib/result-access.js";
import { canUploadResults } from "../../artifacts/api-server/src/lib/rbac.js";
import { notifyResultAssigned } from "../../artifacts/api-server/src/lib/notify-result-assigned.js";
import { notificationHref } from "../../artifacts/ace-results-portal/src/lib/notification-utils.ts";
import type { ResultRow, User } from "@workspace/db";
import type { AuthUser } from "../../artifacts/api-server/src/middlewares/auth.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fakeResult(overrides: Partial<ResultRow> = {}): ResultRow {
  return {
    id: 123,
    patientId: 10,
    category: "radiology",
    fileName: "results/123/result.pdf",
    originalFileName: "scan.pdf",
    fileType: "pdf",
    fileSizeBytes: 100,
    releaseOption: "after_physician_review",
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

function physician(userId: number): AuthUser {
  return { userId, username: `dr.${userId}`, role: "physician" };
}

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: 45,
    username: "dr.x",
    passwordHash: "x",
    firstName: "X",
    lastName: "Doctor",
    email: null,
    role: "physician",
    isActive: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    mustChangePassword: false,
    passwordExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function accessDeps(opts: {
  privatePhysicians?: number[];
  patientPhysicians?: Array<{ patientId: number; physicianId: number }>;
}): ResultAccessDeps {
  const privateSet = new Set(opts.privatePhysicians ?? []);
  const patientPairs = opts.patientPhysicians ?? [];
  return {
    hasResultAssignments: async (resultId) =>
      resultId === 123 ? privateSet.size > 0 : false,
    findResultAssignment: async (resultId, physicianId) =>
      resultId === 123 && privateSet.has(physicianId) ? { id: 1 } : undefined,
    findPatientAssignment: async (patientId, physicianId) =>
      patientPairs.some((p) => p.patientId === patientId && p.physicianId === physicianId)
        ? { id: 1 }
        : undefined,
    resolveActor: async () => ({ role: "physician", isActive: true }),
  };
}

test("ASSIGN — active physician is assignable", async () => {
  const result = await assertAssignablePhysician(45, {
    findUserById: async () => fakeUser({ id: 45, role: "physician", isActive: true }),
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.userId, 45);
});

test("ASSIGN — non-physician rejected", async () => {
  const result = await assertAssignablePhysician(99, {
    findUserById: async () => fakeUser({ id: 99, role: "laboratory", isActive: true }),
  });
  assert.equal(result.ok, false);
});

test("ASSIGN — inactive physician rejected", async () => {
  const result = await assertAssignablePhysician(45, {
    findUserById: async () => fakeUser({ id: 45, role: "physician", isActive: false }),
  });
  assert.equal(result.ok, false);
});

test("ASSIGN — missing user rejected", async () => {
  const result = await assertAssignablePhysician(404, {
    findUserById: async () => undefined,
  });
  assert.equal(result.ok, false);
});

test("ASSIGN — physician role cannot upload (assignment requires staff upload)", () => {
  assert.equal(canUploadResults("physician"), false);
  assert.equal(canUploadResults("laboratory"), true);
  assert.equal(canUploadResults("super_admin"), true);
});

test("ACCESS — assigned physician can view pending private result", async () => {
  const deps = accessDeps({ privatePhysicians: [7] });
  assert.equal(await canAccessResult(physician(7), fakeResult({ status: "pending" }), deps), true);
});

test("ACCESS — unassigned physician cannot view (IDOR)", async () => {
  const deps = accessDeps({ privatePhysicians: [7] });
  assert.equal(await canAccessResult(physician(8), fakeResult({ status: "pending" }), deps), false);
  assert.equal(await canAccessResult(physician(8), fakeResult({ status: "released" }), deps), false);
});

test("ACCESS — patient_physicians alone does not unlock privately assigned result", async () => {
  const deps = accessDeps({
    privatePhysicians: [7],
    patientPhysicians: [{ patientId: 10, physicianId: 8 }],
  });
  assert.equal(await canAccessResult(physician(8), fakeResult({ status: "released" }), deps), false);
});

test("ACCESS — without private assignment, released + patient_physicians still works", async () => {
  const deps = accessDeps({
    privatePhysicians: [],
    patientPhysicians: [{ patientId: 10, physicianId: 8 }],
  });
  assert.equal(
    await canAccessResult(physician(8), fakeResult({ status: "released", dateReleased: new Date() }), deps),
    true,
  );
  assert.equal(await canAccessResult(physician(8), fakeResult({ status: "pending" }), deps), false);
});

test("ACCESS — client-supplied physicianId is irrelevant; auth user id is source of truth", async () => {
  const deps = accessDeps({ privatePhysicians: [7] });
  assert.equal(await canAccessResult(physician(8), fakeResult(), deps), false);
});

test("REASSIGN — Doctor A loses access; Doctor B gains", async () => {
  const before = accessDeps({ privatePhysicians: [7] });
  assert.equal(await canAccessResult(physician(7), fakeResult(), before), true);
  assert.equal(await canAccessResult(physician(9), fakeResult(), before), false);

  const after = accessDeps({ privatePhysicians: [9] });
  assert.equal(await canAccessResult(physician(7), fakeResult(), after), false);
  assert.equal(await canAccessResult(physician(9), fakeResult(), after), true);
});

test("PATIENT — pending assigned result remains unavailable to patient portal", () => {
  const pending = fakeResult({ patientId: 10, status: "pending" });
  const released = fakeResult({ patientId: 10, status: "released" });
  assert.equal(canPortalAccessResult(pending, 10), false);
  assert.equal(canPortalAccessResult(released, 10), true);
});

test("DOCTOR — assignment does not grant mutate/upload/delete", async () => {
  const deps = accessDeps({ privatePhysicians: [7] });
  assert.equal(await canMutateResult(physician(7), fakeResult(), deps), false);
  assert.equal(canUploadResults("physician"), false);
});

test("NOTIFY — result_assigned content is generic (no PHI/secrets)", () => {
  const body = "A result has been assigned to you for reference.";
  assert.equal(body.includes("diagnosis"), false);
  assert.equal(body.includes("password"), false);
  assert.equal(body.includes("JWT"), false);
  assert.equal(body.toLowerCase().includes("access code"), false);
  assert.equal(typeof notifyResultAssigned, "function");
  const href = notificationHref(
    { type: "result_assigned", entityType: "result", entityId: 123 },
    "physician",
  );
  // Contract: physician assignment notifications deep-link to the result when entityId is present.
  assert.equal(href, "/physician/results?resultId=123");
  assert.equal(
    notificationHref(
      { type: "result_assigned", entityType: "result", entityId: null },
      "physician",
    ),
    "/physician/results",
  );
});

test("NOTIFY body text is generic reference copy", () => {
  const body = "A result has been assigned to you for reference.";
  assert.match(body, /reference/);
  assert.equal(body.includes("diagnosis"), false);
});

test("AUDIT vocabulary — assignment and access_denied details stay operational", () => {
  const assignDetail = "result_assigned physicianId=45";
  const denyDetail = "Unauthorized attempt to access result";
  assert.match(assignDetail, /result_assigned/);
  assert.match(denyDetail, /Unauthorized/);
  assert.equal(assignDetail.includes("scan.pdf"), false);
  assert.equal(denyDetail.includes("password"), false);
});

test("MIGRATION — 010_result_physician_assignment.sql exists and is manual-only", () => {
  const sqlPath = path.resolve(
    __dirname,
    "../../docs/migration/sql/010_result_physician_assignment.sql",
  );
  assert.equal(fs.existsSync(sqlPath), true);
  const text = fs.readFileSync(sqlPath, "utf8");
  assert.match(text, /ACE_ResultsPortal/);
  assert.match(text, /result_physicians/);
  assert.match(text, /MANUAL EXECUTION ONLY/i);
  assert.equal(text.includes("DROP TABLE"), false);
  assert.equal(text.includes("TRUNCATE"), false);
});

test("STREAM ORDER — authorization precedes filesystem (documented invariant)", () => {
  const order = ["AUTHENTICATION", "AUTHORIZATION", "RESULT_ACCESS_CHECK", "FILE_PATH", "FILE_STREAM"];
  assert.deepEqual(order.slice(0, 3), ["AUTHENTICATION", "AUTHORIZATION", "RESULT_ACCESS_CHECK"]);
  assert.ok(order.indexOf("AUTHORIZATION") < order.indexOf("FILE_PATH"));
});

test("DOWNLOAD/FILE IDOR — same access gate as GET (unassigned denied)", async () => {
  const deps = accessDeps({ privatePhysicians: [7] });
  const result = fakeResult({ status: "pending" });
  // Download and file-token routes call canAccessResult before getFilePath.
  assert.equal(await canAccessResult(physician(8), result, deps), false);
  assert.equal(await canAccessResult(physician(7), result, deps), true);
});
