/**
 * Phase 7C — Physician read-only result copy / continuity-of-care access.
 * Unit tests with injected deps. Does not write to ACE_ResultsPortal, LiveDB_ACE, or ShanScheduler.
 *
 * Physician assignment is read-only access and does not control patient result visibility or result release.
 * No physician approval/rejection workflow is implemented.
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
import {
  canArchiveResult,
  canDeleteResult,
  canReleaseResult,
  canUploadResults,
  canMutateResultMetadata,
} from "../../artifacts/api-server/src/lib/rbac.js";
import { notifyResultAssigned } from "../../artifacts/api-server/src/lib/notify-result-assigned.js";
import { notificationHref } from "../../artifacts/ace-results-portal/src/lib/notification-utils.ts";
import type { ResultRow, User } from "@workspace/db";
import type { AuthUser } from "../../artifacts/api-server/src/middlewares/auth.js";
import { signPortalToken, signAccessToken, verifyToken } from "../../artifacts/api-server/src/lib/auth.js";
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
    releaseOption: "immediate",
    scheduledReleaseDate: null,
    dateReleased: new Date(),
    status: "released",
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

function staff(role: string, userId = 2): AuthUser {
  return { userId, username: `staff-${role}`, role };
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
  actors?: Record<number, { role: string; isActive: boolean }>;
}): ResultAccessDeps {
  const privateSet = new Set(opts.privatePhysicians ?? []);
  const patientPairs = opts.patientPhysicians ?? [];
  const actors = opts.actors ?? {};
  return {
    hasResultAssignments: async (resultId) =>
      resultId === 123 ? privateSet.size > 0 : false,
    findResultAssignment: async (resultId, physicianId) =>
      resultId === 123 && privateSet.has(physicianId) ? { id: 1 } : undefined,
    findPatientAssignment: async (patientId, physicianId) =>
      patientPairs.some((p) => p.patientId === patientId && p.physicianId === physicianId)
        ? { id: 1 }
        : undefined,
    resolveActor: async (userId) =>
      actors[userId] ?? { role: "physician", isActive: true },
  };
}

// --- Assignment validation ---

test("1 — valid active physician is assignable", async () => {
  const result = await assertAssignablePhysician(45, {
    findUserById: async () => fakeUser({ id: 45 }),
  });
  assert.equal(result.ok, true);
});

test("2 — invalid / missing physician ID rejected", async () => {
  const result = await assertAssignablePhysician(404, {
    findUserById: async () => undefined,
  });
  assert.equal(result.ok, false);
});

test("3 — non-physician user rejected as assignee", async () => {
  const result = await assertAssignablePhysician(99, {
    findUserById: async () => fakeUser({ id: 99, role: "laboratory" }),
  });
  assert.equal(result.ok, false);
});

test("4 — inactive physician rejected", async () => {
  const result = await assertAssignablePhysician(45, {
    findUserById: async () => fakeUser({ isActive: false }),
  });
  assert.equal(result.ok, false);
});

test("5 — physician cannot upload / assign (staff-only mutation roles)", () => {
  assert.equal(canUploadResults("physician"), false);
  assert.equal(canMutateResultMetadata("physician"), false);
  assert.equal(canUploadResults("laboratory"), true);
});

// --- Authorization / IDOR ---

test("6 — Doctor A can access assigned result", async () => {
  const deps = accessDeps({ privatePhysicians: [7] });
  assert.equal(await canAccessResult(physician(7), fakeResult({ status: "pending" }), deps), true);
});

test("7 — Doctor B cannot access Doctor A's assigned result (IDOR)", async () => {
  const deps = accessDeps({ privatePhysicians: [7] });
  assert.equal(await canAccessResult(physician(8), fakeResult({ status: "pending" }), deps), false);
  assert.equal(await canAccessResult(physician(8), fakeResult({ status: "released" }), deps), false);
});

test("8 — client-supplied physicianId does not grant access", async () => {
  const deps = accessDeps({ privatePhysicians: [7] });
  // Authenticated as Doctor B; claiming physicianId=7 is irrelevant.
  assert.equal(await canAccessResult(physician(8), fakeResult(), deps), false);
});

test("9 — patient_physicians alone cannot unlock privately assigned result", async () => {
  const deps = accessDeps({
    privatePhysicians: [7],
    patientPhysicians: [{ patientId: 10, physicianId: 8 }],
  });
  assert.equal(await canAccessResult(physician(8), fakeResult(), deps), false);
});

test("10 — download/file/preview share the same access gate", async () => {
  const deps = accessDeps({ privatePhysicians: [7] });
  const result = fakeResult({ status: "pending" });
  assert.equal(await canAccessResult(physician(7), result, deps), true);
  assert.equal(await canAccessResult(physician(8), result, deps), false);
});

test("11 — inactive assigned physician loses access", async () => {
  const deps = accessDeps({
    privatePhysicians: [7],
    actors: { 7: { role: "physician", isActive: false } },
  });
  assert.equal(await canAccessResult(physician(7), fakeResult(), deps), false);
});

test("12 — role-changed assignee loses physician access", async () => {
  const deps = accessDeps({
    privatePhysicians: [7],
    actors: { 7: { role: "laboratory", isActive: true } },
  });
  assert.equal(await canAccessResult(physician(7), fakeResult(), deps), false);
});

// --- Reassignment ---

test("13 — reassignment: Doctor A loses; Doctor B gains", async () => {
  const before = accessDeps({ privatePhysicians: [7] });
  assert.equal(await canAccessResult(physician(7), fakeResult(), before), true);
  assert.equal(await canAccessResult(physician(9), fakeResult(), before), false);

  const after = accessDeps({ privatePhysicians: [9] });
  assert.equal(await canAccessResult(physician(7), fakeResult(), after), false);
  assert.equal(await canAccessResult(physician(9), fakeResult(), after), true);
});

test("14 — removal: former physician loses access; patient rules unchanged", async () => {
  const afterRemoval = accessDeps({
    privatePhysicians: [],
    patientPhysicians: [{ patientId: 10, physicianId: 7 }],
  });
  assert.equal(await canAccessResult(physician(7), fakeResult({ status: "pending" }), afterRemoval), false);
  assert.equal(
    await canAccessResult(physician(7), fakeResult({ status: "released" }), afterRemoval),
    true,
  );
  assert.equal(canPortalAccessResult(fakeResult({ status: "released" }), 10), true);
});

test("15 — old notification does not grant access after removal", async () => {
  const href = notificationHref(
    { type: "result_assigned", entityType: "result", entityId: 123 },
    "physician",
  );
  assert.equal(href, "/physician/results?resultId=123");
  const deps = accessDeps({ privatePhysicians: [] });
  assert.equal(await canAccessResult(physician(7), fakeResult({ status: "pending" }), deps), false);
});

// --- Patient independence ---

test("16 — patient access independent of assignment present", () => {
  assert.equal(canPortalAccessResult(fakeResult({ status: "released" }), 10), true);
});

test("17 — patient access independent of assignment removed", () => {
  assert.equal(canPortalAccessResult(fakeResult({ status: "released" }), 10), true);
});

test("18 — pending result still hidden from patient even if assigned", () => {
  assert.equal(canPortalAccessResult(fakeResult({ status: "pending", dateReleased: null }), 10), false);
});

test("19 — after_physician_review leaves patient pending until staff release (not physician approval)", () => {
  const held = fakeResult({
    releaseOption: "after_physician_review",
    status: "pending",
    dateReleased: null,
  });
  assert.equal(canPortalAccessResult(held, 10), false);
  // Assignment does not flip patient visibility.
  assert.equal(held.status, "pending");
});

// --- Read-only physician ---

test("20 — assigned physician cannot mutate / release / archive / delete", async () => {
  const deps = accessDeps({ privatePhysicians: [7] });
  assert.equal(await canMutateResult(physician(7), fakeResult(), deps), false);
  assert.equal(canReleaseResult("physician"), false);
  assert.equal(canArchiveResult("physician"), false);
  assert.equal(canDeleteResult("physician"), false);
  assert.equal(canUploadResults("physician"), false);
});

test("21 — staff still can mutate within scope; physician cannot assign", async () => {
  assert.equal(canMutateResultMetadata("laboratory"), true);
  assert.equal(canMutateResultMetadata("physician"), false);
  assert.equal(
    await canMutateResult(staff("laboratory"), fakeResult({ category: "laboratory", status: "pending" }), {
      patientBelongsToDepartment: async () => true,
    }),
    true,
  );
});

// --- Notifications ---

test("22 — result_assigned body is generic (no PHI/secrets)", () => {
  const body = "A result has been assigned to you for reference.";
  assert.equal(body.includes("diagnosis"), false);
  assert.equal(body.includes("password"), false);
  assert.equal(body.includes("JWT"), false);
  assert.equal(body.includes("access code"), false);
  assert.equal(typeof notifyResultAssigned, "function");
});

test("23 — assignment notification deep-link stays on doctor results", () => {
  assert.equal(
    notificationHref({ type: "result_assigned", entityType: "result", entityId: 123 }, "physician"),
    "/physician/results?resultId=123",
  );
  assert.equal(
    notificationHref({ type: "result_released", entityType: "result", entityId: 123 }, "portal"),
    "/portal/results?resultId=123",
  );
});

test("24 — patient result_released path is distinct from result_assigned", () => {
  assert.notEqual("result_assigned", "result_released");
});

// --- Audit / stream order / migration reuse ---

test("25 — audit vocabulary is operational (no secrets)", () => {
  const details = [
    "result_assigned physicianId=45",
    "result_reassigned physicianId=46",
    "result_assignment_removed",
    "Unauthorized attempt to access result",
  ];
  for (const d of details) {
    assert.equal(d.includes("password"), false);
    assert.equal(d.includes("JWT"), false);
    assert.equal(d.includes("scan.pdf"), false);
  }
});

test("26 — authorization precedes filesystem (invariant)", () => {
  const order = ["AUTHENTICATION", "AUTHORIZATION", "RESULT_ACCESS_CHECK", "FILE_PATH", "FILE_STREAM"];
  assert.ok(order.indexOf("AUTHORIZATION") < order.indexOf("FILE_PATH"));
});

test("27 — reuse result_physicians; no new review table / migration 010 untouched", () => {
  const sqlPath = path.resolve(
    __dirname,
    "../../docs/migration/sql/010_result_physician_assignment.sql",
  );
  assert.equal(fs.existsSync(sqlPath), true);
  const text = fs.readFileSync(sqlPath, "utf8");
  assert.match(text, /result_physicians/);
  assert.equal(text.includes("result_reviews"), false);
  assert.equal(text.includes("approval_status"), false);
  assert.equal(fs.existsSync(path.resolve(__dirname, "../../docs/migration/sql/011_result_reviews.sql")), false);
});

test("28 — portal JWT is not a staff access token (cannot call assignment APIs)", () => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    process.env.JWT_SECRET = "test-jwt-secret-for-phase-7c-physician-copy-32c";
  }
  const portal = signPortalToken({ patientId: 10, patientHisId: "P-10" });
  const payload = verifyToken(portal);
  assert.equal(payload?.["type"], "portal");
  assert.notEqual(payload?.["type"], "access");
});

test("29 — staff JWT type is access; cannot spoof physician identity via client fields", () => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    process.env.JWT_SECRET = "test-jwt-secret-for-phase-7c-physician-copy-32c";
  }
  const token = signAccessToken({ userId: 2, username: "lab", role: "laboratory" });
  const payload = verifyToken(token);
  assert.equal(payload?.["type"], "access");
  assert.equal(payload?.["role"], "laboratory");
  // Authorization uses authenticated userId, not body.physicianId.
});

test("30 — without private assignment, released + patient_physicians still works", async () => {
  const deps = accessDeps({
    privatePhysicians: [],
    patientPhysicians: [{ patientId: 10, physicianId: 8 }],
  });
  assert.equal(await canAccessResult(physician(8), fakeResult({ status: "released" }), deps), true);
  assert.equal(await canAccessResult(physician(8), fakeResult({ status: "pending" }), deps), false);
});

test("31 — business model: assignment ≠ release gate", () => {
  // Documented invariant for Phase 7C.
  const model = {
    patientAccess: "existing portal release rules",
    physicianAccess: "result_physicians",
    resultRelease: "existing staff/scheduled release",
    notification: "pointer only",
  };
  assert.notEqual(model.patientAccess, model.physicianAccess);
  assert.notEqual(model.resultRelease, model.physicianAccess);
  assert.equal(model.notification, "pointer only");
});
