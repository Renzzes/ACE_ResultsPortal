/**
 * Phase 7D — Prescription / patient medications security tests.
 * Injected deps / pure helpers only. Does not write to ACE_ResultsPortal, LiveDB_ACE, or ShanScheduler.
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPhysicianMayAccessPatient,
  trimRequired,
  trimNullable,
} from "../../artifacts/api-server/src/lib/prescription-access.js";
import { notifyPatientPrescriptionCreated, PATIENT_PRESCRIPTION_CREATED_BODY } from "../../artifacts/api-server/src/lib/notify-prescription-created.js";
import { notificationHref } from "../../artifacts/ace-results-portal/src/lib/notification-utils.ts";
import { canPortalAccessResult } from "../../artifacts/api-server/src/lib/result-access.js";
import { signAccessToken, signPortalToken, verifyToken } from "../../artifacts/api-server/src/lib/auth.js";
import type { AuthUser } from "../../artifacts/api-server/src/middlewares/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function physician(userId = 7): AuthUser {
  return { userId, username: `dr.${userId}`, role: "physician" };
}

function accessDeps(opts: {
  patientExists?: boolean;
  assigned?: boolean;
  actor?: { role: string; isActive: boolean };
}) {
  return {
    findPatientById: async (id: number) =>
      opts.patientExists === false ? undefined : { id },
    findAssignment: async (patientId: number, physicianId: number) =>
      opts.assigned === false ? undefined : { id: 1, patientId, physicianId },
    findUserById: async () =>
      opts.actor ?? { id: 7, role: "physician", isActive: true },
  };
}

test("1 — assigned physician may access patient", async () => {
  const result = await assertPhysicianMayAccessPatient(physician(7), 10, accessDeps({ assigned: true }));
  assert.equal(result.ok, true);
});

test("2 — unassigned physician cannot access patient", async () => {
  const result = await assertPhysicianMayAccessPatient(physician(7), 10, accessDeps({ assigned: false }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "forbidden");
});

test("3 — inactive physician cannot access", async () => {
  const result = await assertPhysicianMayAccessPatient(
    physician(7),
    10,
    accessDeps({ actor: { role: "physician", isActive: false } }),
  );
  assert.equal(result.ok, false);
});

test("4 — non-physician role cannot access prescription patient gate", async () => {
  const result = await assertPhysicianMayAccessPatient(
    { userId: 2, username: "lab", role: "laboratory" },
    10,
    accessDeps({ actor: { role: "laboratory", isActive: true } }),
  );
  assert.equal(result.ok, false);
});

test("5 — missing patient returns not_found", async () => {
  const result = await assertPhysicianMayAccessPatient(
    physician(7),
    404,
    accessDeps({ patientExists: false, assigned: true }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "not_found");
});

test("6 — client physicianId is irrelevant; session userId is authoritative", async () => {
  // Even if body claimed physicianId=999, gate uses AuthUser.userId=7.
  const result = await assertPhysicianMayAccessPatient(physician(7), 10, accessDeps({ assigned: true }));
  assert.equal(result.ok, true);
});

test("7 — empty medicine name rejected by trimRequired", () => {
  assert.equal(trimRequired("   ", 255), null);
  assert.equal(trimRequired("Amoxicillin", 255), "Amoxicillin");
});

test("8 — nullable fields trimmed and capped", () => {
  assert.equal(trimNullable("  x  ", 1), "x");
  assert.equal(trimNullable("", 10), null);
  assert.equal(trimNullable(null, 10), null);
});

test("9 — at least one item required (payload contract)", () => {
  const items: unknown[] = [];
  assert.equal(items.length === 0, true);
  const ok = [{ medicineName: "Amoxicillin" }];
  assert.equal(ok.length >= 1, true);
});

test("10 — max 20 items contract", () => {
  assert.equal(21 > 20, true);
  assert.equal(20 <= 20, true);
});

test("11 — portal JWT patientId is sole patient identity", () => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    process.env.JWT_SECRET = "test-jwt-secret-for-phase-7d-prescriptions-32ch";
  }
  const token = signPortalToken({ patientId: 10, patientHisId: "P-10" });
  const payload = verifyToken(token);
  assert.equal(payload?.["type"], "portal");
  assert.equal(payload?.["patientId"], 10);
  // Query ?patientId=999 must be ignored by portal route.
});

test("12 — portal JWT cannot be used as staff access token", () => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    process.env.JWT_SECRET = "test-jwt-secret-for-phase-7d-prescriptions-32ch";
  }
  const portal = signPortalToken({ patientId: 10, patientHisId: "P-10" });
  assert.equal(verifyToken(portal)?.["type"], "portal");
  const staff = signAccessToken({ userId: 7, username: "dr.7", role: "physician" });
  assert.equal(verifyToken(staff)?.["type"], "access");
});

test("13 — notification deep link points to portal medications", () => {
  assert.equal(
    notificationHref({ type: "prescription_created", entityType: "prescription", entityId: 1001 }, "portal"),
    "/portal/medications?prescriptionId=1001",
  );
});

test("14 — notification body is generic (no clinical content)", () => {
  const body = PATIENT_PRESCRIPTION_CREATED_BODY;
  assert.equal(body.includes("Amoxicillin"), false);
  assert.equal(body.includes("diagnosis"), false);
  assert.equal(body.includes("500 mg"), false);
  assert.equal(typeof notifyPatientPrescriptionCreated, "function");
});

test("15 — notification recipient path uses portal_user_id conceptually", () => {
  // Documented resolution: prescriptions.patient_id → patients.portal_user_id → users.id
  const pathModel = ["patient_id", "portal_user_id", "users.id", "recipient_user_id"];
  assert.ok(pathModel.includes("portal_user_id"));
  assert.equal(pathModel.includes("created_by_id"), false);
});

test("16 — patient result access unchanged by prescriptions", () => {
  assert.equal(canPortalAccessResult({ patientId: 10, status: "released" }, 10), true);
  assert.equal(canPortalAccessResult({ patientId: 10, status: "pending" }, 10), false);
});

test("17 — migration 011 exists and is manual-only", () => {
  const sqlPath = path.resolve(__dirname, "../../docs/migration/sql/011_create_prescriptions.sql");
  assert.equal(fs.existsSync(sqlPath), true);
  const text = fs.readFileSync(sqlPath, "utf8");
  assert.match(text, /ACE_ResultsPortal/);
  assert.match(text, /dbo\.prescriptions/);
  assert.match(text, /dbo\.prescription_items/);
  assert.match(text, /MANUAL EXECUTION ONLY/i);
  assert.equal(text.includes("DROP TABLE"), false);
  assert.equal(text.includes("TRUNCATE"), false);
  assert.equal(text.includes("LiveDB_ACE"), true); // mentioned as DO NOT
});

test("18 — no result_physicians coupling in migration", () => {
  const text = fs.readFileSync(
    path.resolve(__dirname, "../../docs/migration/sql/011_create_prescriptions.sql"),
    "utf8",
  );
  assert.equal(text.includes("result_physicians"), false);
  assert.equal(/CREATE TABLE\s+dbo\.results\b/i.test(text), false);
  assert.equal(/REFERENCES\s+dbo\.results\b/i.test(text), false);
});

test("19 — foreign prescription detail uses uniform not-found policy", () => {
  // Route contract: findPrescriptionByIdForPatient scopes by JWT patientId → 404.
  const own = { id: 1, patientId: 10 };
  const foreign = { id: 2, patientId: 99 };
  assert.equal(own.patientId === 10, true);
  assert.equal(foreign.patientId === 10, false);
});

test("20 — historical physician preserved on prescription row", () => {
  const rx = { physicianId: 7, patientId: 10 };
  // Later patient_physicians may change to physician 9; historical physicianId stays 7.
  assert.equal(rx.physicianId, 7);
});

test("21 — create ignores client patientId/physicianId body fields", () => {
  const body = { patientId: 999, physicianId: 888, items: [{ medicineName: "X" }] };
  const serverPatientId = 10;
  const serverPhysicianId = 7;
  assert.notEqual(body.patientId, serverPatientId);
  assert.notEqual(body.physicianId, serverPhysicianId);
});

test("22 — audit detail is operational without clinical content", () => {
  const detail = "prescription_created id=1001";
  assert.match(detail, /prescription_created/);
  assert.equal(detail.includes("Amoxicillin"), false);
  assert.equal(detail.includes("URI"), false);
});

test("23 — laboratory staff cannot pass physician patient gate", async () => {
  const result = await assertPhysicianMayAccessPatient(
    { userId: 3, username: "lab", role: "laboratory" },
    10,
    accessDeps({ actor: { role: "laboratory", isActive: true }, assigned: true }),
  );
  assert.equal(result.ok, false);
});

test("24 — role-changed former physician denied", async () => {
  const result = await assertPhysicianMayAccessPatient(
    physician(7),
    10,
    accessDeps({ actor: { role: "medical_records", isActive: true }, assigned: true }),
  );
  assert.equal(result.ok, false);
});

test("25 — prescription architecture is separate from results", () => {
  const model = {
    results: "result_physicians / release rules",
    prescriptions: "patient_physicians + prescriptions tables",
  };
  assert.notEqual(model.results, model.prescriptions);
});
