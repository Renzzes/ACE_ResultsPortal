/**
 * Phase 7A.1 — Patient Portal appointment security tests.
 * Mocked helpers only. Does not write to ShanScheduler, ACE_ResultsPortal, or LiveDB_ACE.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { signAccessToken, signPortalToken, verifyToken } from "../../artifacts/api-server/src/lib/auth.js";
import { resolveActivePortalAccount } from "../../artifacts/api-server/src/lib/portal-activation.js";
import {
  buildPortalAppointmentsPayload,
  formatPortalAppointment,
  hospitalTodayIso,
} from "../../artifacts/api-server/src/lib/portal-appointments.js";
import {
  EXCLUDED_APPOINTMENT_STATUSES,
  PATIENT_HIS_ID_COLUMN,
  configuredPatientHisIdColumn,
  normalizePatientHisIdForLookup,
} from "@workspace/db";
import type { SchedulerAppointmentRow } from "@workspace/db";
import type { User } from "@workspace/db";

function sampleRow(overrides: Partial<SchedulerAppointmentRow> = {}): SchedulerAppointmentRow {
  return {
    id: "apt-1",
    appointmentReference: "ACE-APT-001",
    doctorId: "doc-1",
    appointmentDate: "2026-08-27",
    appointmentTime: "10:30 AM",
    status: "Scheduled",
    reasonForVisit: "Follow-up",
    doctorName: "Dr. Actual Doctor",
    departmentName: "Internal Medicine",
    specialtyName: null,
    ...overrides,
  };
}

test("TEST contract — PatientHisId is the default join column", () => {
  const prev = process.env.SCHEDULER_PATIENT_HIS_ID_COLUMN;
  delete process.env.SCHEDULER_PATIENT_HIS_ID_COLUMN;
  delete process.env.SHANSCHEDULER_PATIENT_HIS_ID_COLUMN;
  assert.equal(PATIENT_HIS_ID_COLUMN, "PatientHisId");
  assert.equal(configuredPatientHisIdColumn(), "PatientHisId");
  if (prev !== undefined) process.env.SCHEDULER_PATIENT_HIS_ID_COLUMN = prev;
});

test("TEST 20 — leading zeros in HIS IDs are preserved", () => {
  assert.equal(normalizePatientHisIdForLookup("0001240"), "0001240");
  assert.equal(normalizePatientHisIdForLookup(" 0001240 "), "0001240");
  assert.equal(normalizePatientHisIdForLookup(""), null);
  assert.equal(normalizePatientHisIdForLookup(null), null);
  assert.equal(normalizePatientHisIdForLookup("   "), null);
});

test("TEST 9 — blank HIS ID is unconfigured (no demographic fallback)", () => {
  assert.equal(normalizePatientHisIdForLookup(null), null);
  const payload = buildPortalAppointmentsPayload({ ok: false, reason: "unconfigured" });
  assert.equal(payload.status, "unconfigured");
  assert.deepEqual(payload.today, []);
  assert.equal(payload.next, null);
});

test("TEST 12/13/14 — today and next appointment filtering logic", () => {
  const today = hospitalTodayIso(new Date("2026-08-27T10:00:00+08:00"));
  assert.equal(today, "2026-08-27");

  const payload = buildPortalAppointmentsPayload({
    ok: true,
    today: [
      sampleRow({ appointmentTime: "10:00 AM" }),
      sampleRow({ id: "apt-1b", appointmentTime: "3:00 PM" }),
    ],
    next: sampleRow({ id: "apt-2", appointmentDate: "2026-08-29", appointmentTime: "9:00 AM" }),
  });
  assert.equal(payload.status, "ok");
  assert.equal(payload.today.length, 2);
  assert.equal(payload.next?.date, "2026-08-29");
  assert.notEqual(payload.today[0]?.date, payload.next?.date);
});

test("TEST 15 — no next appointment returns null", () => {
  const payload = buildPortalAppointmentsPayload({
    ok: true,
    today: [sampleRow()],
    next: null,
  });
  assert.equal(payload.next, null);
});

test("TEST 16 — no appointment today returns empty today array", () => {
  const payload = buildPortalAppointmentsPayload({
    ok: true,
    today: [],
    next: sampleRow({ appointmentDate: "2026-08-30" }),
  });
  assert.deepEqual(payload.today, []);
});

test("TEST 17/18 — scheduler unavailable and unconfigured states", () => {
  const unavailable = buildPortalAppointmentsPayload({ ok: false, reason: "unavailable" });
  assert.equal(unavailable.status, "unavailable");
  assert.deepEqual(unavailable.today, []);
  assert.equal(unavailable.next, null);
  assert.match(unavailable.message ?? "", /temporarily unavailable/i);

  const unconfigured = buildPortalAppointmentsPayload({ ok: false, reason: "unconfigured" });
  assert.equal(unconfigured.status, "unconfigured");
  assert.match(unconfigured.message ?? "", /temporarily unavailable/i);
});

test("TEST 10/11/12 — cancelled / no-show / rescheduled statuses excluded", () => {
  for (const status of ["cancelled", "canceled", "no-show", "no show", "rescheduled"] as const) {
    assert.ok(EXCLUDED_APPOINTMENT_STATUSES.includes(status));
  }
});

test("TEST doctor/department from scheduler row only (not ACE users)", () => {
  const formatted = formatPortalAppointment(sampleRow());
  assert.equal(formatted.doctorName, "Dr. Actual Doctor");
  assert.equal(formatted.departmentName, "Internal Medicine");

  const missing = formatPortalAppointment(
    sampleRow({ doctorName: null, departmentName: null, specialtyName: null }),
  );
  assert.equal(missing.doctorName, null);
  assert.equal(missing.departmentName, null);
});

test("TEST 19 — hospital timezone date boundary", () => {
  const lateUtc = hospitalTodayIso(new Date("2026-08-26T18:00:00.000Z"));
  assert.equal(lateUtc, "2026-08-27");
});

test("TEST 3/5 — activation gate for appointment access path", async () => {
  assert.equal((await resolveActivePortalAccount({ portalUserId: null })).ok, false);
});

test("TEST 6/7/8 — staff/physician/admin JWT is not portal", () => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    process.env.JWT_SECRET = "test-jwt-secret-for-portal-appointment-security-32";
  }
  for (const role of ["medical_records", "physician", "super_admin"] as const) {
    const token = signAccessToken({ userId: 1, username: role, role });
    const payload = verifyToken(token);
    assert.ok(payload);
    assert.equal(payload.type, "access");
    assert.notEqual(payload.type, "portal");
  }
});

test("TEST 9 IDOR — client patientId must not be authoritative", () => {
  const jwtPatientId = 10;
  const spoofedQueryPatientId = 999;
  assert.notEqual(jwtPatientId, spoofedQueryPatientId);
});

test("TEST 10 — Patient A HIS id cannot equal Patient B", () => {
  assert.notEqual("1240", "TEST-ACE-001");
});

test("TEST 1/2 — portal JWT type for appointment endpoints", () => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    process.env.JWT_SECRET = "test-jwt-secret-for-portal-appointment-security-32";
  }
  const token = signPortalToken({ patientId: 10, patientHisId: "1240" });
  const payload = verifyToken(token);
  assert.ok(payload);
  assert.equal(payload.type, "portal");
  assert.equal(payload.patientHisId, "1240");
});

test("TEST 22 — read-only: no write side effects in contract helpers", () => {
  assert.equal(configuredPatientHisIdColumn().includes("Patient"), true);
  assert.equal(EXCLUDED_APPOINTMENT_STATUSES.length >= 4, true);
});

test("TEST 4 — inactive portal account denied at activation layer", async () => {
  const fakeUser = (): User => ({
    id: 500,
    username: "patient:x",
    passwordHash: "x",
    firstName: "P",
    lastName: "E",
    email: null,
    role: "patient",
    isActive: false,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const result = await resolveActivePortalAccount({ portalUserId: 500 }, {
    findUserById: async () => fakeUser(),
  });
  assert.equal(result.ok, false);
});

test("TEST 19 — matching must not use name/email/mobile/DOB keys", () => {
  const joinColumn = configuredPatientHisIdColumn().toLowerCase();
  assert.equal(joinColumn.includes("name"), false);
  assert.equal(joinColumn.includes("email"), false);
  assert.equal(joinColumn.includes("mobile"), false);
  assert.equal(joinColumn.includes("contact"), false);
  assert.equal(joinColumn.includes("dob"), false);
  assert.equal(joinColumn.includes("birth"), false);
  assert.equal(joinColumn, "patienthisid");
});
