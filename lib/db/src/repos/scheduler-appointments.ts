import { schedulerRequest, schedulerSql as sql } from "../scheduler-pool";
import { isSchedulerUnavailableError, loadSchedulerDatabaseName } from "../scheduler-config";
import { getPool } from "../pool";

const FORBIDDEN_SQL = /\b(DROP|TRUNCATE|DELETE|ALTER|UPDATE|INSERT|MERGE|CREATE|EXEC|EXECUTE|sp_executesql)\b/i;

/** Contract column added by ShanScheduler team — only deterministic patient join key. */
export const PATIENT_HIS_ID_COLUMN = "PatientHisId";

export class SchedulerQueryError extends Error {
  readonly cause?: unknown;

  constructor(cause?: unknown) {
    super("SCHEDULER_DB_UNAVAILABLE");
    this.name = "SchedulerQueryError";
    this.cause = cause;
  }
}

export type SchedulerAppointmentRow = {
  id: string;
  appointmentReference: string;
  doctorId: string;
  appointmentDate: string;
  appointmentTime: string | null;
  status: string;
  reasonForVisit: string;
  doctorName: string | null;
  departmentName: string | null;
  specialtyName: string | null;
};

function assertReadOnlySelect(sqlText: string): void {
  if (!/^\s*SELECT\b/is.test(sqlText)) {
    throw new SchedulerQueryError();
  }
  if (FORBIDDEN_SQL.test(sqlText)) {
    throw new SchedulerQueryError();
  }
}

function bracketId(name: string): string {
  return `[${name.replace(/]/g, "")}]`;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value === "") return undefined;
  return value.trim();
}

/**
 * Appointments column that equals ACE_ResultsPortal.patients.patient_his_id.
 * Defaults to PatientHisId (ShanScheduler contract). Optional env override for renaming only.
 * Never uses name/email/mobile/DOB/AppointmentReference.
 */
export function configuredPatientHisIdColumn(): string {
  const raw =
    optionalEnv("SCHEDULER_PATIENT_HIS_ID_COLUMN") ??
    optionalEnv("SHANSCHEDULER_PATIENT_HIS_ID_COLUMN");
  if (!raw) return PATIENT_HIS_ID_COLUMN;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw)) return PATIENT_HIS_ID_COLUMN;
  return raw;
}

/**
 * Preserve HIS ID characters including leading zeros. Only trim surrounding whitespace.
 */
export function normalizePatientHisIdForLookup(patientHisId: string | null | undefined): string | null {
  if (patientHisId == null) return null;
  const trimmed = String(patientHisId).trim();
  if (!trimmed) return null;
  if (trimmed.length > 64) return null;
  return trimmed;
}

export async function appointmentPatientHisIdColumnExists(): Promise<boolean> {
  const column = configuredPatientHisIdColumn();
  try {
    const req = await schedulerRequest();
    const result = await req
      .input("column", sql.NVarChar(128), column)
      .query(`
SELECT TOP (1) c.COLUMN_NAME AS columnName
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_SCHEMA = N'dbo'
  AND c.TABLE_NAME = N'Appointments'
  AND c.COLUMN_NAME = @column
`);
    return Boolean((result.recordset[0] as { columnName?: string } | undefined)?.columnName);
  } catch {
    return false;
  }
}

/** Status values excluded from patient upcoming/today views (lowercase). */
export const EXCLUDED_APPOINTMENT_STATUSES = [
  "cancelled",
  "canceled",
  "no-show",
  "no show",
  "rescheduled",
] as const;

function buildAppointmentSelect(patientColumn: string): string {
  const pc = bracketId(patientColumn);
  return `
SELECT
  a.ID AS id,
  a.AppointmentReference AS appointmentReference,
  a.DoctorID AS doctorId,
  CONVERT(varchar(10), a.AppointmentDate, 23) AS appointmentDate,
  a.AppointmentTime AS appointmentTime,
  a.Status AS status,
  a.ReasonForVisit AS reasonForVisit,
  d.FullName AS doctorName,
  dept.Name AS departmentName,
  sp.Name AS specialtyName
FROM dbo.Appointments a
LEFT JOIN dbo.Doctors d ON d.ID = a.DoctorID
LEFT JOIN dbo.Departments dept ON dept.ID = d.DepartmentID
LEFT JOIN dbo.Specialties sp ON sp.ID = d.SpecialtyID
WHERE a.${pc} = @patientHisId
  AND LOWER(LTRIM(RTRIM(a.Status))) NOT IN (${EXCLUDED_APPOINTMENT_STATUSES.map((s) => `'${s}'`).join(", ")})
`;
}

function mapRow(row: Record<string, unknown>): SchedulerAppointmentRow {
  return {
    id: String(row.id),
    appointmentReference: String(row.appointmentReference),
    doctorId: String(row.doctorId ?? ""),
    appointmentDate: String(row.appointmentDate),
    appointmentTime: row.appointmentTime != null ? String(row.appointmentTime) : null,
    status: String(row.status),
    reasonForVisit: String(row.reasonForVisit),
    doctorName: row.doctorName != null ? String(row.doctorName) : null,
    departmentName: row.departmentName != null ? String(row.departmentName) : null,
    specialtyName: row.specialtyName != null ? String(row.specialtyName) : null,
  };
}

export type SchedulerPatientAppointmentsResult =
  | {
      ok: true;
      today: SchedulerAppointmentRow[];
      next: SchedulerAppointmentRow | null;
    }
  | { ok: false; reason: "unconfigured" | "unavailable" };

/**
 * Read-only: today's + next appointment for one portal patient HIS id.
 * Matching key ONLY: Appointments.PatientHisId = patients.patient_his_id
 */
export async function findPatientAppointments(
  patientHisId: string | null | undefined,
  hospitalToday: string,
): Promise<SchedulerPatientAppointmentsResult> {
  const hisId = normalizePatientHisIdForLookup(patientHisId);
  if (!hisId) {
    return { ok: false, reason: "unconfigured" };
  }

  const columnReady = await appointmentPatientHisIdColumnExists();
  if (!columnReady) {
    return { ok: false, reason: "unconfigured" };
  }

  const patientColumn = configuredPatientHisIdColumn();
  const base = buildAppointmentSelect(patientColumn);
  const todaySql = `${base}
  AND a.AppointmentDate = @hospitalToday
  ORDER BY a.AppointmentTime ASC, a.AppointmentReference ASC`;

  const nextSql = `${base}
  AND a.AppointmentDate > @hospitalToday
  ORDER BY a.AppointmentDate ASC, a.AppointmentTime ASC, a.AppointmentReference ASC
  OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY`;

  assertReadOnlySelect(todaySql);
  assertReadOnlySelect(nextSql);

  try {
    const todayReq = await schedulerRequest();
    const todayResult = await todayReq
      .input("patientHisId", sql.NVarChar(64), hisId)
      .input("hospitalToday", sql.Date, hospitalToday)
      .query(todaySql);
    const today = (todayResult.recordset as Record<string, unknown>[]).map(mapRow);

    const nextReq = await schedulerRequest();
    const nextResult = await nextReq
      .input("patientHisId", sql.NVarChar(64), hisId)
      .input("hospitalToday", sql.Date, hospitalToday)
      .query(nextSql);
    const nextRow = (nextResult.recordset[0] as Record<string, unknown> | undefined) ?? null;

    return {
      ok: true,
      today,
      next: nextRow ? mapRow(nextRow) : null,
    };
  } catch (err) {
    if (isSchedulerUnavailableError(err)) {
      return { ok: false, reason: "unavailable" };
    }
    return { ok: false, reason: "unavailable" };
  }
}

/**
 * Read-only: recent past + today + next appointments for care timeline.
 * Matching key ONLY: Appointments.PatientHisId = patients.patient_his_id
 * Does not invent patients or write to ShanScheduler.
 */
export async function findCareTimelineAppointments(
  patientHisId: string | null | undefined,
  hospitalToday: string,
  options: { pastDays?: number; pastLimit?: number } = {},
): Promise<
  | {
      ok: true;
      recentPast: SchedulerAppointmentRow[];
      today: SchedulerAppointmentRow[];
      next: SchedulerAppointmentRow | null;
    }
  | { ok: false; reason: "unconfigured" | "unavailable" }
> {
  const hisId = normalizePatientHisIdForLookup(patientHisId);
  if (!hisId) {
    return { ok: false, reason: "unconfigured" };
  }

  const columnReady = await appointmentPatientHisIdColumnExists();
  if (!columnReady) {
    return { ok: false, reason: "unconfigured" };
  }

  const pastDays = Math.min(Math.max(options.pastDays ?? 30, 1), 90);
  const pastLimit = Math.min(Math.max(options.pastLimit ?? 10, 1), 20);
  const patientColumn = configuredPatientHisIdColumn();
  const base = buildAppointmentSelect(patientColumn);

  const pastSql = `${base}
  AND a.AppointmentDate >= DATEADD(day, -@pastDays, @hospitalToday)
  AND a.AppointmentDate < @hospitalToday
  ORDER BY a.AppointmentDate DESC, a.AppointmentTime DESC, a.AppointmentReference DESC
  OFFSET 0 ROWS FETCH NEXT @pastLimit ROWS ONLY`;

  const todaySql = `${base}
  AND a.AppointmentDate = @hospitalToday
  ORDER BY a.AppointmentTime ASC, a.AppointmentReference ASC`;

  const nextSql = `${base}
  AND a.AppointmentDate > @hospitalToday
  ORDER BY a.AppointmentDate ASC, a.AppointmentTime ASC, a.AppointmentReference ASC
  OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY`;

  assertReadOnlySelect(pastSql);
  assertReadOnlySelect(todaySql);
  assertReadOnlySelect(nextSql);

  try {
    const pastReq = await schedulerRequest();
    const pastResult = await pastReq
      .input("patientHisId", sql.NVarChar(64), hisId)
      .input("hospitalToday", sql.Date, hospitalToday)
      .input("pastDays", sql.Int, pastDays)
      .input("pastLimit", sql.Int, pastLimit)
      .query(pastSql);
    const recentPast = (pastResult.recordset as Record<string, unknown>[]).map(mapRow);

    const todayReq = await schedulerRequest();
    const todayResult = await todayReq
      .input("patientHisId", sql.NVarChar(64), hisId)
      .input("hospitalToday", sql.Date, hospitalToday)
      .query(todaySql);
    const today = (todayResult.recordset as Record<string, unknown>[]).map(mapRow);

    const nextReq = await schedulerRequest();
    const nextResult = await nextReq
      .input("patientHisId", sql.NVarChar(64), hisId)
      .input("hospitalToday", sql.Date, hospitalToday)
      .query(nextSql);
    const nextRow = (nextResult.recordset[0] as Record<string, unknown> | undefined) ?? null;

    return {
      ok: true,
      recentPast,
      today,
      next: nextRow ? mapRow(nextRow) : null,
    };
  } catch (err) {
    if (isSchedulerUnavailableError(err)) {
      return { ok: false, reason: "unavailable" };
    }
    return { ok: false, reason: "unavailable" };
  }
}

export async function checkSchedulerSchemaReady(): Promise<boolean> {
  try {
    await getPool();
    const schedulerDb = bracketId(loadSchedulerDatabaseName());
    const pool = await getPool();
    const result = await pool.request().query(`
SELECT TOP (1) TABLE_NAME AS tableName
FROM ${schedulerDb}.INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'Appointments'
`);
    return Boolean((result.recordset[0] as { tableName?: string } | undefined)?.tableName);
  } catch {
    return false;
  }
}
