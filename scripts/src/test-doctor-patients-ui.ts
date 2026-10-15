/**
 * Doctor Portal My Patients helpers — no fabricated clinical fields.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  PHYSICIAN_CAN_ADD_PATIENT,
  filterPatientsByStatus,
  patientDisplayName,
  patientStatusLabel,
  recentReleasedResults,
  sortPatients,
  type PatientPortalRow,
} from "../../artifacts/ace-results-portal/src/lib/doctor-patients";
function samplePatient(partial: Partial<PatientPortalRow> & Pick<PatientPortalRow, "id" | "lastName" | "firstName">): PatientPortalRow {
  return {
    patientHisId: "100",
    dateOfBirth: "1990-01-15",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    resultCount: 0,
    portalActive: true,
    ...partial,
  };
}

test("patient display name and portal status labels use real fields only", () => {
  const active = samplePatient({ id: 1, lastName: "Cruz", firstName: "Ana", middleName: "M", portalActive: true });
  const inactive = samplePatient({ id: 2, lastName: "Santos", firstName: "Ben", portalActive: false });
  assert.equal(patientDisplayName(active), "Cruz, Ana M");
  assert.equal(patientStatusLabel(active), "Active");
  assert.equal(patientStatusLabel(inactive), "Inactive");
  assert.equal(PHYSICIAN_CAN_ADD_PATIENT, false);
});

test("status filter and sort operate on provided rows", () => {
  const rows = [
    samplePatient({ id: 1, lastName: "Zeta", firstName: "A", resultCount: 2, portalActive: true, patientHisId: "200" }),
    samplePatient({ id: 2, lastName: "Alpha", firstName: "B", resultCount: 0, portalActive: false, patientHisId: "100" }),
  ];
  const released = filterPatientsByStatus(rows, "with_released");
  assert.equal(released.length, 1);
  assert.equal(released[0]?.id, 1);
  const sorted = sortPatients(rows, "name_asc");
  assert.equal(sorted[0]?.lastName, "Alpha");
  const byHis = sortPatients(rows, "his_asc");
  assert.equal(byHis[0]?.patientHisId, "100");
});

test("recentReleasedResults keeps released only and sorts newest first", () => {
  const results = [
    {
      id: 1,
      patientId: 9,
      category: "laboratory",
      fileName: "a.pdf",
      originalFileName: "older.pdf",
      fileType: "pdf",
      releaseOption: "immediate",
      status: "released",
      uploadedById: 1,
      uploadedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      dateReleased: "2026-01-01T00:00:00.000Z",
    },
    {
      id: 2,
      patientId: 9,
      category: "radiology",
      fileName: "b.pdf",
      originalFileName: "newer.pdf",
      fileType: "pdf",
      releaseOption: "immediate",
      status: "released",
      uploadedById: 1,
      uploadedAt: "2026-02-01T00:00:00.000Z",
      createdAt: "2026-02-01T00:00:00.000Z",
      dateReleased: "2026-02-01T00:00:00.000Z",
    },
    {
      id: 3,
      patientId: 9,
      category: "laboratory",
      fileName: "c.pdf",
      originalFileName: "pending.pdf",
      fileType: "pdf",
      releaseOption: "immediate",
      status: "pending",
      uploadedById: 1,
      uploadedAt: "2026-03-01T00:00:00.000Z",
      createdAt: "2026-03-01T00:00:00.000Z",
    },
  ] as Parameters<typeof recentReleasedResults>[0];
  const recent = recentReleasedResults(results, 5);
  assert.equal(recent.length, 2);
  assert.equal(recent[0]?.id, 2);
});

test("My Patients page uses authorized APIs and does not hardcode identities", () => {
  const page = fs.readFileSync(
    new URL("../../artifacts/ace-results-portal/src/pages/physician/patients.tsx", import.meta.url),
    "utf8",
  );
  const lib = fs.readFileSync(
    new URL("../../artifacts/ace-results-portal/src/lib/doctor-patients.ts", import.meta.url),
    "utf8",
  );
  assert.match(page, /useListPatients/);
  assert.match(page, /useListPatientResultsPhysician/);
  assert.match(page, /SelectTrigger/);
  assert.equal(/Add Patient/.test(page), false);
  assert.match(page, /Appointment information unavailable/);
  assert.match(lib, /upcomingAppointments: "unavailable"/);
  assert.match(lib, /PHYSICIAN_CAN_ADD_PATIENT = false/);
  assert.equal(/ABAYATA|Dr\. test test|fake patient/i.test(page), false);
  assert.equal(/localStorage/.test(lib), false);
});
