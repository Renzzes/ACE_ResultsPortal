import type { SchedulerAppointmentRow } from "@workspace/db";
import { EXCLUDED_APPOINTMENT_STATUSES } from "@workspace/db";

export const HOSPITAL_TIME_ZONE = "Asia/Manila";

export type PortalAppointmentView = {
  id: string;
  reference: string;
  date: string;
  time: string | null;
  status: string;
  doctorName: string | null;
  departmentName: string | null;
  specialtyName: string | null;
  reasonForVisit: string;
};

export type PortalAppointmentsPayload = {
  status: "ok" | "unavailable" | "unconfigured";
  today: PortalAppointmentView[];
  next: PortalAppointmentView | null;
  message?: string;
};

/** Hospital-local calendar date (YYYY-MM-DD) in Asia/Manila. */
export function hospitalTodayIso(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: HOSPITAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function formatPortalAppointment(row: SchedulerAppointmentRow): PortalAppointmentView {
  return {
    id: row.id,
    reference: row.appointmentReference,
    date: row.appointmentDate,
    time: row.appointmentTime,
    status: row.status,
    doctorName: row.doctorName?.trim() ? row.doctorName.trim() : null,
    departmentName: row.departmentName?.trim() ? row.departmentName.trim() : null,
    specialtyName: row.specialtyName?.trim() ? row.specialtyName.trim() : null,
    reasonForVisit: row.reasonForVisit,
  };
}

export function buildPortalAppointmentsPayload(
  result:
    | { ok: true; today: SchedulerAppointmentRow[]; next: SchedulerAppointmentRow | null }
    | { ok: false; reason: "unconfigured" | "unavailable" },
): PortalAppointmentsPayload {
  if (!result.ok) {
    if (result.reason === "unconfigured") {
      return {
        status: "unconfigured",
        today: [],
        next: null,
        message: "Appointment information is temporarily unavailable.",
      };
    }
    return {
      status: "unavailable",
      today: [],
      next: null,
      message: "Appointment information is temporarily unavailable.",
    };
  }

  return {
    status: "ok",
    today: result.today.map(formatPortalAppointment),
    next: result.next ? formatPortalAppointment(result.next) : null,
  };
}

export { EXCLUDED_APPOINTMENT_STATUSES };
