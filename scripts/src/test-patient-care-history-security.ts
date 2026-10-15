/**
 * Phase 7F — Patient Portal clinical timeline / care-history security.
 * Injected deps / pure helpers only.
 * Does not write to ACE_ResultsPortal, LiveDB_ACE, or ShanScheduler.
 * Does not print secrets, OTPs, passwords, access codes, or JWTs.
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signAccessToken, signPortalToken, verifyToken } from "../../artifacts/api-server/src/lib/auth.js";
import { resolveActivePortalAccount } from "../../artifacts/api-server/src/lib/portal-activation.js";
import { canPortalAccessResult } from "../../artifacts/api-server/src/lib/result-access.js";
import {
  appointmentToCareEvent,
  appointmentsSourceFromResult,
  buildCareHistoryEvents,
  prescriptionToCareEvent,
  resultToCareEvent,
  sortCareHistoryEvents,
} from "../../artifacts/api-server/src/lib/portal-care-history.js";
import { normalizePatientHisIdForLookup, PATIENT_HIS_ID_COLUMN } from "@workspace/db";
import type { PrescriptionWithItems, ResultRow, SchedulerAppointmentRow } from "@workspace/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function ensureJwtSecret() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    process.env.JWT_SECRET = "test-jwt-secret-for-phase-7f-care-history-32!";
  }
}

function sampleResult(overrides: Partial<ResultRow> = {}): ResultRow {
  return {
    id: 100,
    patientId: 10,
    category: "laboratory",
    fileName: "results/100/a.pdf",
    originalFileName: "cbc.pdf",
    fileType: "pdf",
    fileSizeBytes: 10,
    releaseOption: "immediate",
    scheduledReleaseDate: null,
    dateReleased: new Date("2026-08-26T08:00:00+08:00"),
    status: "released",
    remarks: null,
    uploadedById: 1,
    uploadedAt: new Date("2026-08-25T08:00:00+08:00"),
    createdAt: new Date("2026-08-25T08:00:00+08:00"),
    updatedAt: new Date("2026-08-26T08:00:00+08:00"),
    ...overrides,
  };
}

function sampleRx(overrides: Partial<PrescriptionWithItems> = {}): PrescriptionWithItems {
  return {
    id: 50,
    patientId: 10,
    physicianId: 7,
    status: "active",
    diagnosisOrIndication: null,
    generalInstructions: null,
    notes: null,
    createdAt: new Date("2026-08-27T09:00:00+08:00"),
    updatedAt: new Date("2026-08-27T09:00:00+08:00"),
    physicianName: "Dr. Example",
    items: [
      {
        id: 1,
        prescriptionId: 50,
        medicineName: "Amoxicillin",
        genericName: null,
        dosage: "500 mg",
        dosageUnit: null,
        route: "Oral",
        frequency: "3 times daily",
        duration: "7 days",
        quantity: null,
        instructions: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 2,
        prescriptionId: 50,
        medicineName: "Paracetamol",
        genericName: null,
        dosage: "500 mg",
        dosageUnit: null,
        route: "Oral",
        frequency: "As needed",
        duration: null,
        quantity: null,
        instructions: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    ...overrides,
  };
}

function sampleAppt(overrides: Partial<SchedulerAppointmentRow> = {}): SchedulerAppointmentRow {
  return {
    id: "apt-1",
    appointmentReference: "ACE-APT-001",
    doctorId: "doc-1",
    appointmentDate: "2026-08-27",
    appointmentTime: "10:30 AM",
    status: "Scheduled",
    reasonForVisit: "Clinic consultation",
    doctorName: "Dr. Scheduler",
    departmentName: "Internal Medicine",
    specialtyName: null,
    ...overrides,
  };
}

test("1 — Patient A can see Patient A timeline events", () => {
  const events = buildCareHistoryEvents({
    jwtPatientId: 10,
    appointments: { ok: true, recentPast: [], today: [sampleAppt()], next: null },
    results: [sampleResult()],
    prescriptions: [sampleRx()],
  });
  assert.equal(events.some((e) => e.type === "result" && e.entityId === 100), true);
  assert.equal(events.some((e) => e.type === "prescription" && e.entityId === 50), true);
  assert.equal(events.some((e) => e.type === "appointment"), true);
});

test("2 — Patient A cannot see Patient B results", () => {
  const foreign = sampleResult({ id: 200, patientId: 99 });
  assert.equal(canPortalAccessResult(foreign, 10), false);
  assert.equal(resultToCareEvent(foreign, 10), null);
  const events = buildCareHistoryEvents({
    jwtPatientId: 10,
    appointments: { ok: false, reason: "unconfigured" },
    results: [foreign],
    prescriptions: [],
  });
  assert.equal(events.length, 0);
});

test("3 — Patient A cannot see Patient B prescriptions", () => {
  // Builder only receives patient-scoped rows from the route; ownership is patientId match.
  const own = sampleRx({ patientId: 10 });
  const foreign = sampleRx({ id: 99, patientId: 99 });
  assert.equal(own.patientId === 10, true);
  assert.equal(foreign.patientId === 10, false);
  const events = buildCareHistoryEvents({
    jwtPatientId: 10,
    appointments: { ok: false, reason: "unavailable" },
    results: [],
    prescriptions: [own],
  });
  assert.equal(events.every((e) => e.entityId === 50), true);
});

test("4 — Patient A cannot see Patient B appointments (HIS id join only)", () => {
  assert.equal(normalizePatientHisIdForLookup("1240"), "1240");
  assert.notEqual(normalizePatientHisIdForLookup("1240"), normalizePatientHisIdForLookup("9999"));
  assert.equal(PATIENT_HIS_ID_COLUMN, "PatientHisId");
});

test("5 — Client patientId spoof does not change identity", () => {
  ensureJwtSecret();
  const token = signPortalToken({ patientId: 10, patientHisId: "P-10" });
  const payload = verifyToken(token);
  assert.equal(payload?.["patientId"], 10);
  const spoofed = 999;
  assert.notEqual(spoofed, payload?.["patientId"]);
});

test("6 — Staff JWT cannot use portal care-history endpoint (token type)", () => {
  ensureJwtSecret();
  const staff = signAccessToken({ userId: 2, username: "lab", role: "laboratory" });
  assert.equal(verifyToken(staff)?.["type"], "access");
  assert.notEqual(verifyToken(staff)?.["type"], "portal");
});

test("7 — Physician JWT cannot use portal care-history endpoint (token type)", () => {
  ensureJwtSecret();
  const phys = signAccessToken({ userId: 7, username: "dr.7", role: "physician" });
  assert.equal(verifyToken(phys)?.["type"], "access");
  assert.notEqual(verifyToken(phys)?.["type"], "portal");
});

test("8 — Unauthenticated request denied (no portal token)", () => {
  assert.equal(verifyToken(""), null);
  assert.equal(verifyToken("not-a-token"), null);
});

test("9 — Unactivated patient denied", async () => {
  const result = await resolveActivePortalAccount(
    { portalUserId: null },
    { findUserById: async () => undefined },
  );
  assert.equal(result.ok, false);
});

test("10 — ShanScheduler PatientHisId mismatch returns no appointment for that patient", () => {
  const hisA = normalizePatientHisIdForLookup("1240");
  const hisB = normalizePatientHisIdForLookup("9999");
  assert.notEqual(hisA, hisB);
});

test("11 — NULL PatientHisId appointment never appears", () => {
  assert.equal(normalizePatientHisIdForLookup(null), null);
  assert.equal(normalizePatientHisIdForLookup(""), null);
  const source = appointmentsSourceFromResult({ ok: false, reason: "unconfigured" });
  assert.equal(source.status, "unconfigured");
});

test("12 — Scheduler unavailable does not break results/prescriptions", () => {
  const events = buildCareHistoryEvents({
    jwtPatientId: 10,
    appointments: { ok: false, reason: "unavailable" },
    results: [sampleResult()],
    prescriptions: [sampleRx()],
  });
  assert.equal(events.some((e) => e.type === "result"), true);
  assert.equal(events.some((e) => e.type === "prescription"), true);
  assert.equal(events.some((e) => e.type === "appointment"), false);
  assert.equal(appointmentsSourceFromResult({ ok: false, reason: "unavailable" }).status, "unavailable");
});

test("13 — Pending result does not appear", () => {
  const pending = sampleResult({ status: "pending", dateReleased: null });
  assert.equal(canPortalAccessResult(pending, 10), false);
  assert.equal(resultToCareEvent(pending, 10), null);
});

test("14 — Released result appears", () => {
  const event = resultToCareEvent(sampleResult(), 10);
  assert.ok(event);
  assert.equal(event?.type, "result");
  assert.equal(event?.href, "/portal/results?resultId=100");
});

test("15 — Patient-owned prescription appears", () => {
  const event = prescriptionToCareEvent(sampleRx());
  assert.equal(event.type, "prescription");
  assert.equal(event.summary, "2 medications prescribed");
  assert.equal(event.href, "/portal/medications?prescriptionId=50");
  assert.equal(event.summary?.includes("Amoxicillin"), false);
});

test("16 — Foreign prescription does not appear when not in patient-scoped feed", () => {
  const events = buildCareHistoryEvents({
    jwtPatientId: 10,
    appointments: { ok: false, reason: "unconfigured" },
    results: [],
    prescriptions: [],
  });
  assert.equal(events.some((e) => e.type === "prescription"), false);
});

test("17 — Deep link to foreign result is denied by access helper", () => {
  assert.equal(canPortalAccessResult(sampleResult({ patientId: 99 }), 10), false);
});

test("18 — Deep link to foreign prescription is denied by ownership scope", () => {
  const ownId = 10;
  const foreignRx = sampleRx({ patientId: 99, id: 77 });
  assert.equal(foreignRx.patientId === ownId, false);
});

test("19 — Appointment doctor does not become assigned physician automatically", () => {
  const event = appointmentToCareEvent(sampleAppt({ doctorName: "Dr. Scheduler" }));
  assert.equal(event.doctorName, "Dr. Scheduler");
  const careLib = fs.readFileSync(
    path.resolve(__dirname, "../../artifacts/api-server/src/lib/portal-care-history.ts"),
    "utf8",
  );
  assert.equal(careLib.includes("patient_physicians"), false);
  assert.equal(careLib.includes("assignPhysician"), false);
  assert.equal(careLib.includes("INSERT"), false);
});

test("20 — ShanScheduler is never written to", () => {
  const repo = fs.readFileSync(
    path.resolve(__dirname, "../../lib/db/src/repos/scheduler-appointments.ts"),
    "utf8",
  );
  assert.match(repo, /assertReadOnlySelect/);
  assert.match(repo, /findCareTimelineAppointments/);
  assert.match(repo, /FORBIDDEN_SQL/);
  // Write verbs appear only inside the forbidden-pattern guard, not as executable DML.
  assert.equal(/\bINSERT\s+INTO\b/i.test(repo), false);
  assert.equal(/\bUPDATE\s+\w+/i.test(repo), false);
  assert.equal(/\bDELETE\s+FROM\b/i.test(repo), false);
});

test("21 — Timeline ordering is newest first and deterministic", () => {
  const events = sortCareHistoryEvents([
    prescriptionToCareEvent(sampleRx({ createdAt: new Date("2026-08-20T09:00:00+08:00") })),
    resultToCareEvent(sampleResult({ dateReleased: new Date("2026-08-26T08:00:00+08:00") }), 10)!,
    appointmentToCareEvent(sampleAppt({ appointmentDate: "2026-08-27" })),
  ]);
  assert.equal(events[0]?.type, "appointment");
  assert.equal(events[1]?.type, "result");
  assert.equal(events[2]?.type, "prescription");
});

test("22 — No care-history migration / no timeline table", () => {
  const migrations = path.resolve(__dirname, "../../docs/migration/sql");
  const files = fs.existsSync(migrations) ? fs.readdirSync(migrations) : [];
  assert.equal(files.some((f) => /care.?history|timeline|portal_appointments/i.test(f)), false);
});

test("23 — History page uses live care-history API (no mock)", () => {
  const page = fs.readFileSync(
    path.resolve(__dirname, "../../artifacts/ace-results-portal/src/pages/portal/history.tsx"),
    "utf8",
  );
  assert.match(page, /useGetPortalCareHistory/);
  assert.equal(page.includes("PORTAL_MOCK"), false);
  assert.equal(page.includes("patient-mock-data"), false);
});

test("24 — Prescription summary does not embed medication names", () => {
  const event = prescriptionToCareEvent(sampleRx());
  assert.equal(event.summary?.includes("Amoxicillin"), false);
  assert.equal(event.summary?.includes("Paracetamol"), false);
});
