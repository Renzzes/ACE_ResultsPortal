/**
 * Doctor Portal appointments UI helpers — no fake clinical records.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  APPOINTMENT_CREATE_AVAILABLE,
  buildMonthGrid,
  filterAppointments,
  summarizeDay,
  summarizePeriod,
  toIsoDate,
  type DoctorAppointment,
} from "../../artifacts/ace-results-portal/src/lib/doctor-appointments";

test("buildMonthGrid produces 42 Sunday-first cells for October 2026", () => {
  const cells = buildMonthGrid(new Date(2026, 9, 1), new Date(2026, 9, 15));
  assert.equal(cells.length, 42);
  assert.equal(cells[0]?.date.getDay(), 0);
  const fifteenth = cells.find((c) => c.iso === "2026-10-15");
  assert.ok(fifteenth);
  assert.equal(fifteenth?.isToday, true);
  assert.equal(fifteenth?.inCurrentMonth, true);
});

test("summaries and filters operate only on provided appointments", () => {
  const rows: DoctorAppointment[] = [
    {
      id: "1",
      date: "2026-10-15",
      time: "09:00 AM",
      patientName: "SAMPLE, ONE",
      patientHisId: "1",
      departmentName: "Laboratory",
      appointmentType: "consultation",
      status: "scheduled",
    },
    {
      id: "2",
      date: "2026-10-15",
      time: "10:00 AM",
      patientName: "SAMPLE, TWO",
      patientHisId: "2",
      departmentName: "Radiology",
      appointmentType: "procedure",
      status: "completed",
    },
    {
      id: "3",
      date: "2026-10-16",
      time: "11:00 AM",
      patientName: "SAMPLE, THREE",
      patientHisId: "3",
      departmentName: "Laboratory",
      appointmentType: "follow_up",
      status: "cancelled",
    },
  ];
  const day = summarizeDay(rows, "2026-10-15");
  assert.deepEqual(day, {
    total: 2,
    scheduled: 1,
    inProgress: 0,
    completed: 1,
    cancelled: 0,
  });
  const period = summarizePeriod(rows, "2026-10-15");
  assert.equal(period.todayTotal, 2);
  assert.equal(period.completedToday, 1);
  assert.equal(period.cancelled, 1);

  const filtered = filterAppointments(rows, {
    search: "radiology",
    status: "all",
    department: "all",
    appointmentType: "all",
    selectedIso: "2026-10-15",
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.id, "2");
});

test("appointment creation remains unavailable until a real API exists", () => {
  assert.equal(APPOINTMENT_CREATE_AVAILABLE, false);
  assert.equal(toIsoDate(new Date(2026, 9, 15)), "2026-10-15");
});

test("appointments page uses typed fetch and does not hardcode patient rows", () => {
  const page = fs.readFileSync(
    new URL("../../artifacts/ace-results-portal/src/pages/physician/appointments.tsx", import.meta.url),
    "utf8",
  );
  const lib = fs.readFileSync(
    new URL("../../artifacts/ace-results-portal/src/lib/doctor-appointments.ts", import.meta.url),
    "utf8",
  );
  assert.match(page, /fetchDoctorAppointments/);
  assert.match(page, /No appointments for this date/);
  assert.equal(/Add Appointment/.test(page), false);
  assert.match(lib, /status: "unavailable"/);
  assert.match(lib, /APPOINTMENT_CREATE_AVAILABLE = false/);
  assert.equal(/ABAYATA|Dr\. test test|fake appointment/i.test(page), false);
  assert.equal(/localStorage/.test(lib), false);
});
