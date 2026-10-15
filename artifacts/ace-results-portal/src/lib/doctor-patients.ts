/**
 * Doctor Portal — My Patients data helpers.
 * Reuses authorized patient list / result APIs. No fabricated clinical fields.
 */

import { listPatients, type Patient, type Result } from "@workspace/api-client-react";

/** Doctors never register patients — Staff Desk owns registration. UI does not show Add Patient. */
export const PHYSICIAN_CAN_ADD_PATIENT = false;

export type PatientPortalRow = Patient & {
  portalActive?: boolean;
};

export type PatientStatusFilter = "all" | "active" | "inactive" | "with_released" | "no_released";

export type PatientSortKey = "name_asc" | "name_desc" | "his_asc" | "dob_desc";

export const PATIENT_STATUS_OPTIONS: Array<{ value: PatientStatusFilter; label: string }> = [
  { value: "all", label: "All Statuses" },
  { value: "active", label: "Portal Active" },
  { value: "inactive", label: "Portal Inactive" },
  { value: "with_released", label: "With Released Results" },
  { value: "no_released", label: "No Released Results" },
];

export const PATIENT_SORT_OPTIONS: Array<{ value: PatientSortKey; label: string }> = [
  { value: "name_asc", label: "Sort by Name (A–Z)" },
  { value: "name_desc", label: "Sort by Name (Z–A)" },
  { value: "his_asc", label: "Sort by HIS ID" },
  { value: "dob_desc", label: "Sort by Date of Birth" },
];

export type DoctorPatientStats = {
  total: number;
  withReleasedResults: number;
  /** Portal-inactive assigned patients. Null when the list could not be fully counted. */
  inactiveOther: number | null;
  /** Physician appointment integration is not available. */
  upcomingAppointments: "unavailable";
};

export function patientDisplayName(patient: Pick<Patient, "lastName" | "firstName" | "middleName">): string {
  const middle = patient.middleName?.trim();
  return `${patient.lastName}, ${patient.firstName}${middle ? ` ${middle}` : ""}`;
}

export function isPortalActive(patient: PatientPortalRow): boolean {
  return patient.portalActive === true;
}

export function patientStatusLabel(patient: PatientPortalRow): "Active" | "Inactive" {
  return isPortalActive(patient) ? "Active" : "Inactive";
}

export function formatPatientDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatResultDateTime(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function resultReleasedAt(result: Result): string | null {
  return result.dateReleased ?? result.uploadedAt ?? null;
}

export function sortPatients(rows: PatientPortalRow[], sort: PatientSortKey): PatientPortalRow[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    if (sort === "his_asc") {
      return a.patientHisId.localeCompare(b.patientHisId, undefined, { numeric: true });
    }
    if (sort === "dob_desc") {
      return new Date(b.dateOfBirth).getTime() - new Date(a.dateOfBirth).getTime();
    }
    const nameA = patientDisplayName(a).toLowerCase();
    const nameB = patientDisplayName(b).toLowerCase();
    const cmp = nameA.localeCompare(nameB);
    return sort === "name_desc" ? -cmp : cmp;
  });
  return copy;
}

export function filterPatientsByStatus(
  rows: PatientPortalRow[],
  status: PatientStatusFilter,
): PatientPortalRow[] {
  if (status === "all") return rows;
  return rows.filter((row) => {
    const released = (row.resultCount ?? 0) > 0;
    if (status === "with_released") return released;
    if (status === "no_released") return !released;
    if (status === "active") return isPortalActive(row);
    if (status === "inactive") return !isPortalActive(row);
    return true;
  });
}

const STATS_PAGE_SIZE = 100;
const STATS_MAX_PAGES = 10;

/**
 * Aggregate KPI counts from the physician-scoped patient list.
 * Does not invent appointments. Caps paging so large directories stay bounded.
 */
export async function fetchDoctorPatientStats(): Promise<DoctorPatientStats> {
  const first = await listPatients({ page: 1, limit: STATS_PAGE_SIZE });
  const total = first.total ?? 0;
  const pages = Math.min(STATS_MAX_PAGES, Math.max(1, Math.ceil(total / STATS_PAGE_SIZE) || 1));
  let rows: PatientPortalRow[] = [...(first.data as PatientPortalRow[])];

  for (let page = 2; page <= pages; page += 1) {
    const next = await listPatients({ page, limit: STATS_PAGE_SIZE });
    rows = rows.concat(next.data as PatientPortalRow[]);
  }

  const scannedAll = rows.length >= total || total === 0;
  let withReleasedResults = 0;
  let inactiveOther = 0;
  for (const row of rows) {
    if ((row.resultCount ?? 0) > 0) withReleasedResults += 1;
    if (!isPortalActive(row)) inactiveOther += 1;
  }

  return {
    total,
    withReleasedResults,
    inactiveOther: scannedAll ? inactiveOther : null,
    upcomingAppointments: "unavailable",
  };
}

export function recentReleasedResults(results: readonly Result[], limit = 5): Result[] {
  return [...results]
    .filter((r) => (r.status ?? "released") === "released")
    .sort((a, b) => {
      const ta = new Date(resultReleasedAt(a) ?? 0).getTime();
      const tb = new Date(resultReleasedAt(b) ?? 0).getTime();
      return tb - ta;
    })
    .slice(0, limit);
}

export function latestReleasedDate(results: readonly Result[]): string | null {
  const recent = recentReleasedResults(results, 1)[0];
  return recent ? resultReleasedAt(recent) : null;
}
