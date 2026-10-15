/**
 * Doctor Portal appointments — presentation-ready data layer.
 * No physician appointment API exists yet. This module keeps the UI typed and
 * ready for ShanScheduler (or another service) without inventing records.
 */

export type DoctorAppointmentStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled";

export type DoctorAppointmentType =
  | "consultation"
  | "follow_up"
  | "procedure"
  | "other";

export type DoctorAppointment = {
  id: string;
  /** ISO date YYYY-MM-DD */
  date: string;
  /** Display time, e.g. "09:30 AM" */
  time: string | null;
  patientName: string;
  patientHisId: string | null;
  departmentName: string | null;
  appointmentType: DoctorAppointmentType | string | null;
  status: DoctorAppointmentStatus | string;
};

export type DoctorAppointmentsLoadState =
  | { status: "loading" }
  | {
      status: "ready";
      /** Empty array is a successful empty schedule — not an error. */
      appointments: DoctorAppointment[];
    }
  | {
      status: "unavailable";
      message: string;
      appointments: [];
    }
  | {
      status: "error";
      message: string;
      appointments: [];
    };

export const APPOINTMENT_STATUS_OPTIONS: Array<{
  value: "all" | DoctorAppointmentStatus;
  label: string;
}> = [
  { value: "all", label: "All Statuses" },
  { value: "scheduled", label: "Scheduled" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

export const APPOINTMENT_TYPE_OPTIONS: Array<{
  value: "all" | DoctorAppointmentType;
  label: string;
}> = [
  { value: "all", label: "All Appointment Types" },
  { value: "consultation", label: "Consultation" },
  { value: "follow_up", label: "Follow-up" },
  { value: "procedure", label: "Procedure" },
  { value: "other", label: "Other" },
];

export function toIsoDate(value: Date): string {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function addDays(value: Date, delta: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + delta);
  return next;
}

export function addMonths(value: Date, delta: number): Date {
  return new Date(value.getFullYear(), value.getMonth() + delta, 1);
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatLongDate(value: Date): string {
  return value.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatWeekday(value: Date): string {
  return value.toLocaleDateString("en-US", { weekday: "long" });
}

export function formatMonthYear(value: Date): string {
  return value.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export type CalendarCell = {
  date: Date;
  iso: string;
  inCurrentMonth: boolean;
  isToday: boolean;
};

/** 6×7 grid cells for a month view (Sunday-first). */
export function buildMonthGrid(viewMonth: Date, today = new Date()): CalendarCell[] {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const first = new Date(year, month, 1);
  const startOffset = first.getDay(); // 0 = Sunday
  const gridStart = addDays(first, -startOffset);
  const todayStart = startOfDay(today);
  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const date = addDays(gridStart, i);
    cells.push({
      date,
      iso: toIsoDate(date),
      inCurrentMonth: date.getMonth() === month,
      isToday: sameDay(date, todayStart),
    });
  }
  return cells;
}

export function normalizeStatus(status: string | undefined | null): DoctorAppointmentStatus | "unknown" {
  const raw = String(status ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  if (raw === "scheduled" || raw === "confirmed" || raw === "pending") return "scheduled";
  if (raw === "in_progress" || raw === "in-progress" || raw === "ongoing") return "in_progress";
  if (raw === "completed" || raw === "done" || raw === "finished") return "completed";
  if (raw === "cancelled" || raw === "canceled" || raw === "no_show") return "cancelled";
  return "unknown";
}

export type AppointmentFilters = {
  search: string;
  status: "all" | DoctorAppointmentStatus;
  department: string;
  appointmentType: "all" | DoctorAppointmentType | string;
  selectedIso: string;
};

export function filterAppointments(
  appointments: readonly DoctorAppointment[],
  filters: AppointmentFilters,
): DoctorAppointment[] {
  const q = filters.search.trim().toLowerCase();
  return appointments.filter((row) => {
    if (row.date !== filters.selectedIso) return false;
    const status = normalizeStatus(row.status);
    if (filters.status !== "all" && status !== filters.status) return false;
    if (filters.department !== "all") {
      const dept = (row.departmentName ?? "").trim().toLowerCase();
      if (dept !== filters.department.toLowerCase()) return false;
    }
    if (filters.appointmentType !== "all") {
      const type = String(row.appointmentType ?? "").trim().toLowerCase();
      if (type !== String(filters.appointmentType).toLowerCase()) return false;
    }
    if (!q) return true;
    const hay = [row.patientName, row.patientHisId, row.departmentName, row.appointmentType]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export type DaySummary = {
  total: number;
  scheduled: number;
  inProgress: number;
  completed: number;
  cancelled: number;
};

export function summarizeDay(appointments: readonly DoctorAppointment[], iso: string): DaySummary {
  const summary: DaySummary = {
    total: 0,
    scheduled: 0,
    inProgress: 0,
    completed: 0,
    cancelled: 0,
  };
  for (const row of appointments) {
    if (row.date !== iso) continue;
    summary.total += 1;
    const status = normalizeStatus(row.status);
    if (status === "scheduled") summary.scheduled += 1;
    else if (status === "in_progress") summary.inProgress += 1;
    else if (status === "completed") summary.completed += 1;
    else if (status === "cancelled") summary.cancelled += 1;
  }
  return summary;
}

export type PeriodSummary = {
  todayTotal: number;
  inProgress: number;
  completedToday: number;
  cancelled: number;
};

export function summarizePeriod(
  appointments: readonly DoctorAppointment[],
  todayIso: string,
): PeriodSummary {
  let todayTotal = 0;
  let inProgress = 0;
  let completedToday = 0;
  let cancelled = 0;
  for (const row of appointments) {
    const status = normalizeStatus(row.status);
    if (row.date === todayIso) {
      todayTotal += 1;
      if (status === "completed") completedToday += 1;
    }
    if (status === "in_progress") inProgress += 1;
    if (status === "cancelled") cancelled += 1;
  }
  return { todayTotal, inProgress, completedToday, cancelled };
}

export function datesWithAppointments(appointments: readonly DoctorAppointment[]): Set<string> {
  const set = new Set<string>();
  for (const row of appointments) {
    if (row.date) set.add(row.date);
  }
  return set;
}

/**
 * Future integration point. Today there is no physician appointment endpoint.
 * Returns a deterministic unavailable state — never fabricates rows.
 */
export async function fetchDoctorAppointments(): Promise<DoctorAppointmentsLoadState> {
  return {
    status: "unavailable",
    message:
      "Physician appointment scheduling is not connected yet. ShanScheduler integration for doctors will populate this page.",
    appointments: [],
  };
}

/** Doctors never create appointments here — ShanScheduler (secretary) is the source. */
export const APPOINTMENT_CREATE_AVAILABLE = false;
