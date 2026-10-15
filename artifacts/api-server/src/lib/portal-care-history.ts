import type { PrescriptionWithItems, ResultRow, SchedulerAppointmentRow } from "@workspace/db";
import { canPortalAccessResult } from "./result-access";
import { formatPortalAppointment, type PortalAppointmentView } from "./portal-appointments";

export const CARE_HISTORY_EVENT_LIMIT = 20;
export const CARE_HISTORY_SOURCE_LIMIT = 20;

export type CareHistoryEventType = "appointment" | "result" | "prescription";

export type CareHistoryEvent = {
  type: CareHistoryEventType;
  /** ISO datetime (or date) used for ordering and display. */
  date: string;
  title: string;
  subtitle: string | null;
  summary: string | null;
  href: string | null;
  /** Result / prescription id when applicable. */
  entityId: number | null;
  /** Scheduler appointment opaque id when applicable (already used by overview). */
  appointmentId: string | null;
  doctorName: string | null;
  status: string | null;
  appointment: PortalAppointmentView | null;
};

export type CareHistorySourceStatus = "ok" | "unavailable" | "unconfigured";

export type CareHistorySources = {
  appointments: { status: CareHistorySourceStatus; message?: string };
  results: { status: CareHistorySourceStatus; message?: string };
  prescriptions: { status: CareHistorySourceStatus; message?: string };
};

export type CareHistoryPayload = {
  events: CareHistoryEvent[];
  sources: CareHistorySources;
};

const TYPE_RANK: Record<CareHistoryEventType, number> = {
  result: 0,
  prescription: 1,
  appointment: 2,
};

function appointmentSortIso(row: SchedulerAppointmentRow): string {
  // Stable date-first key; time stays in summary/display via appointment payload.
  return `${row.appointmentDate}T12:00:00.000+08:00`;
}

function resultSortIso(row: ResultRow): string {
  if (row.dateReleased) return row.dateReleased.toISOString();
  return row.uploadedAt.toISOString();
}

function categoryTitle(category: string): string {
  const labels: Record<string, string> = {
    laboratory: "Laboratory",
    radiology: "Radiology",
    cardiology: "Cardiology",
    other: "Clinical",
  };
  return labels[category] ?? category;
}

export function appointmentToCareEvent(row: SchedulerAppointmentRow): CareHistoryEvent {
  const view = formatPortalAppointment(row);
  const reason = view.reasonForVisit?.trim() || "Clinic appointment";
  return {
    type: "appointment",
    date: appointmentSortIso(row),
    title: "Appointment",
    subtitle: reason,
    summary: [view.time, view.doctorName, view.departmentName || view.specialtyName]
      .filter(Boolean)
      .join(" · ") || null,
    href: null,
    entityId: null,
    appointmentId: view.id,
    doctorName: view.doctorName,
    status: view.status,
    appointment: view,
  };
}

export function resultToCareEvent(row: ResultRow, jwtPatientId: number): CareHistoryEvent | null {
  if (!canPortalAccessResult(row, jwtPatientId)) return null;
  return {
    type: "result",
    date: resultSortIso(row),
    title: "Result",
    subtitle: `${categoryTitle(row.category)} result released`,
    summary: row.originalFileName || null,
    href: `/portal/results?resultId=${row.id}`,
    entityId: row.id,
    appointmentId: null,
    doctorName: null,
    status: row.status,
    appointment: null,
  };
}

export function prescriptionToCareEvent(row: PrescriptionWithItems): CareHistoryEvent {
  const count = row.items.length;
  return {
    type: "prescription",
    date: row.createdAt.toISOString(),
    title: "Prescription",
    subtitle: "New prescription",
    summary: `${count} medication${count === 1 ? "" : "s"} prescribed`,
    href: `/portal/medications?prescriptionId=${row.id}`,
    entityId: row.id,
    appointmentId: null,
    doctorName: row.physicianName ?? null,
    status: row.status,
    appointment: null,
  };
}

export function sortCareHistoryEvents(events: CareHistoryEvent[]): CareHistoryEvent[] {
  return [...events].sort((a, b) => {
    const da = Date.parse(a.date) || 0;
    const db = Date.parse(b.date) || 0;
    if (db !== da) return db - da;
    // Lexical fallback when Date.parse fails on opaque appointment times.
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    const tr = TYPE_RANK[a.type] - TYPE_RANK[b.type];
    if (tr !== 0) return tr;
    const ea = a.entityId ?? 0;
    const eb = b.entityId ?? 0;
    if (eb !== ea) return eb - ea;
    return String(a.appointmentId ?? "").localeCompare(String(b.appointmentId ?? ""));
  });
}

export function buildCareHistoryEvents(input: {
  jwtPatientId: number;
  appointments:
    | {
        ok: true;
        recentPast: SchedulerAppointmentRow[];
        today: SchedulerAppointmentRow[];
        next: SchedulerAppointmentRow | null;
      }
    | { ok: false; reason: CareHistorySourceStatus };
  results: ResultRow[];
  prescriptions: PrescriptionWithItems[];
  limit?: number;
}): CareHistoryEvent[] {
  const events: CareHistoryEvent[] = [];
  const seenAppointmentIds = new Set<string>();

  if (input.appointments.ok) {
    const rows = [
      ...input.appointments.recentPast,
      ...input.appointments.today,
      ...(input.appointments.next ? [input.appointments.next] : []),
    ];
    for (const row of rows) {
      if (seenAppointmentIds.has(row.id)) continue;
      seenAppointmentIds.add(row.id);
      events.push(appointmentToCareEvent(row));
    }
  }

  for (const row of input.results.slice(0, CARE_HISTORY_SOURCE_LIMIT)) {
    const event = resultToCareEvent(row, input.jwtPatientId);
    if (event) events.push(event);
  }

  for (const row of input.prescriptions.slice(0, CARE_HISTORY_SOURCE_LIMIT)) {
    events.push(prescriptionToCareEvent(row));
  }

  const limit = input.limit ?? CARE_HISTORY_EVENT_LIMIT;
  return sortCareHistoryEvents(events).slice(0, limit);
}

export function appointmentsSourceFromResult(
  result:
    | { ok: true }
    | { ok: false; reason: "unconfigured" | "unavailable" },
): CareHistorySources["appointments"] {
  if (result.ok) return { status: "ok" };
  return {
    status: result.reason,
    message: "Appointment information is temporarily unavailable.",
  };
}
