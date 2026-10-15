import { HospitalQueryError } from "../errors";
import { hisRequest, hisSql as sql } from "../his-pool";
import { isHospitalUnavailableError, loadHospitalDatabaseName } from "../hospital-config";

export { HospitalQueryError };

const FORBIDDEN_SQL = /\b(DROP|TRUNCATE|DELETE|ALTER|UPDATE|INSERT|MERGE|CREATE|EXEC|EXECUTE|sp_executesql)\b/i;

export interface HospitalIdentityMatch {
  pkEmdPatients: number;
  patid: string;
  hasHospitalRecord: boolean;
}

export interface HospitalIdentityQuery {
  firstName: string;
  middleName?: string;
  lastName: string;
  suffix?: string;
  gender: string;
  birthDate: string;
}

/**
 * Verified hospital patient demographics for portal/staff use.
 * Built only from inspected LiveDB_ACE view columns.
 */
export interface HospitalPatientRecord {
  /** Stable hospital patient code stored as ACE_ResultsPortal.patients.patient_his_id */
  patientHisId: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  dateOfBirth: string;
  /** Internal HIS PK — never send to the browser */
  pkEmdPatients: number;
  isDeceased: boolean;
}

export interface HospitalHisIdentityQuery {
  patientHisId: string;
  lastName: string;
  dateOfBirth: string;
}

function assertReadOnlySelect(sqlText: string): void {
  if (!/^\s*SELECT\b/i.test(sqlText)) {
    throw new HospitalQueryError();
  }
  if (FORBIDDEN_SQL.test(sqlText)) {
    throw new HospitalQueryError();
  }
}

function normalizeGender(value: string): { gender: string; genderInitial: string } {
  const trimmed = value.trim().toUpperCase();
  if (trimmed === "M" || trimmed === "MALE" || trimmed === "MAN") {
    return { gender: "MALE", genderInitial: "M" };
  }
  if (trimmed === "F" || trimmed === "FEMALE" || trimmed === "WOMAN") {
    return { gender: "FEMALE", genderInitial: "F" };
  }
  return { gender: trimmed, genderInitial: trimmed.slice(0, 1) };
}

function optionalText(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function toIsoDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  return null;
}

function mapHospitalPatientRow(row: Record<string, unknown>): HospitalPatientRecord | undefined {
  const patid = row.patid == null ? "" : String(row.patid).trim();
  const lastName = row.PatientLastName == null ? "" : String(row.PatientLastName).trim();
  const firstName = row.PatientFirstName == null ? "" : String(row.PatientFirstName).trim();
  const middleRaw = row.PatientMiddleName == null ? "" : String(row.PatientMiddleName).trim();
  const pk = Number(row.PK_emdpatients);
  const dob = toIsoDate(row.BirthDate);
  if (!patid || !lastName || !firstName || !dob || !Number.isFinite(pk)) return undefined;
  return {
    patientHisId: patid,
    firstName,
    middleName: middleRaw || null,
    lastName,
    dateOfBirth: dob,
    pkEmdPatients: pk,
    isDeceased: Number(row.isDied) === 1,
  };
}

/**
 * Read-only hospital identity lookup by demographics (legacy registration path).
 * Source: dbo.vwReportPatientProfile (confirmed columns).
 */
export async function findHospitalPatientIdentity(
  input: HospitalIdentityQuery,
): Promise<HospitalIdentityMatch | undefined> {
  // Ensure hospital DB name is configured (also validates separation from portal DB).
  try {
    loadHospitalDatabaseName();
  } catch (err) {
    if (isHospitalUnavailableError(err)) throw new HospitalQueryError();
    throw err;
  }

  const gender = normalizeGender(input.gender);
  const middleName = optionalText(input.middleName);
  const suffix = optionalText(input.suffix);

  const sqlText = `
SELECT TOP (1)
    p.PK_emdpatients AS pkEmdPatients,
    p.patid AS patid,
    CASE
        WHEN EXISTS (
            SELECT 1
            FROM dbo.psPatRegisters r
            WHERE r.FK_emdPatients = p.PK_emdpatients
        )
        THEN 1
        ELSE 0
    END AS HasHospitalRecord
FROM dbo.vwReportPatientProfile p
WHERE
    UPPER(LTRIM(RTRIM(p.PatientFirstName))) =
        UPPER(LTRIM(RTRIM(@FirstName)))
    AND UPPER(LTRIM(RTRIM(p.PatientLastName))) =
        UPPER(LTRIM(RTRIM(@LastName)))
    AND CAST(p.BirthDate AS DATE) = @BirthDate
    AND (
        UPPER(LTRIM(RTRIM(p.Gender))) = @Gender
        OR UPPER(LTRIM(RTRIM(p.Gender))) = @GenderInitial
        OR UPPER(LEFT(LTRIM(RTRIM(p.Gender)), 1)) = @GenderInitial
    )
    AND (
        @MiddleName IS NULL
        OR UPPER(LTRIM(RTRIM(p.PatientMiddleName))) =
           UPPER(LTRIM(RTRIM(@MiddleName)))
    )
    AND (
        @Suffix IS NULL
        OR UPPER(LTRIM(RTRIM(p.SuffixName))) =
           UPPER(LTRIM(RTRIM(@Suffix)))
    )
ORDER BY p.registrydate DESC
`;

  assertReadOnlySelect(sqlText);

  try {
    const req = await hisRequest();
    const result = await req
      .input("FirstName", sql.NVarChar(100), input.firstName.trim())
      .input("LastName", sql.NVarChar(100), input.lastName.trim())
      .input("MiddleName", sql.NVarChar(100), middleName)
      .input("Suffix", sql.NVarChar(50), suffix)
      .input("Gender", sql.NVarChar(32), gender.gender)
      .input("GenderInitial", sql.NVarChar(8), gender.genderInitial)
      .input("BirthDate", sql.Date, input.birthDate)
      .query(sqlText);

    const row = result.recordset[0] as
      | { pkEmdPatients?: unknown; patid?: unknown; HasHospitalRecord?: unknown }
      | undefined;
    if (!row) return undefined;

    const pk = Number(row.pkEmdPatients);
    const patid = row.patid == null ? "" : String(row.patid).trim();
    if (!Number.isFinite(pk) || !patid) return undefined;

    return {
      pkEmdPatients: pk,
      patid,
      hasHospitalRecord: Number(row.HasHospitalRecord) === 1,
    };
  } catch (err) {
    if (err instanceof HospitalQueryError) throw err;
    throw new HospitalQueryError(err);
  }
}

/**
 * Read-only verification by Hospital Patient ID (patid or PatientID) + last name + DOB.
 *
 * Canonical sources (inspected):
 * - dbo.vwReportPatientProfile: patid, PatientFirstName, PatientLastName, PatientMiddleName, BirthDate, PK_emdpatients
 * - dbo.vwPatientMstrList: patid, PatientID, isDied
 *
 * patient_his_id for the portal is always the verified patid (never an arbitrary client value).
 */
export async function verifyHospitalPatientByHisIdentity(
  input: HospitalHisIdentityQuery,
): Promise<HospitalPatientRecord | undefined> {
  try {
    loadHospitalDatabaseName();
  } catch (err) {
    if (isHospitalUnavailableError(err)) throw new HospitalQueryError();
    throw err;
  }

  const hisId = input.patientHisId.trim();
  const lastName = input.lastName.trim();
  const dateOfBirth = input.dateOfBirth.trim();
  if (!hisId || !lastName || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
    return undefined;
  }
  if (hisId.length > 64 || lastName.length > 100) {
    return undefined;
  }

  const sqlText = `
SELECT TOP (1)
    p.patid,
    p.PatientFirstName,
    p.PatientLastName,
    p.PatientMiddleName,
    p.BirthDate,
    p.PK_emdpatients,
    ISNULL(m.isDied, 0) AS isDied
FROM dbo.vwReportPatientProfile p
LEFT JOIN dbo.vwPatientMstrList m
  ON LTRIM(RTRIM(CONVERT(nvarchar(64), m.patid))) =
     LTRIM(RTRIM(CONVERT(nvarchar(64), p.patid)))
WHERE
    (
      LTRIM(RTRIM(CONVERT(nvarchar(64), p.patid))) = LTRIM(RTRIM(@HisId))
      OR LTRIM(RTRIM(CONVERT(nvarchar(64), m.PatientID))) = LTRIM(RTRIM(@HisId))
    )
    AND UPPER(LTRIM(RTRIM(p.PatientLastName))) = UPPER(LTRIM(RTRIM(@LastName)))
    AND CAST(p.BirthDate AS DATE) = @BirthDate
ORDER BY p.registrydate DESC
`;

  assertReadOnlySelect(sqlText);

  try {
    const req = await hisRequest();
    const result = await req
      .input("HisId", sql.NVarChar(64), hisId)
      .input("LastName", sql.NVarChar(100), lastName)
      .input("BirthDate", sql.Date, dateOfBirth)
      .query(sqlText);

    const row = result.recordset[0] as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return mapHospitalPatientRow(row);
  } catch (err) {
    if (err instanceof HospitalQueryError) throw err;
    throw new HospitalQueryError(err);
  }
}

/**
 * Read-only lookup by hospital patient id alone (staff populate from HIS).
 * Accepts patid or vwPatientMstrList.PatientID; returns demographics keyed by patid.
 */
export async function getHospitalPatientByHisId(
  patientHisId: string,
): Promise<HospitalPatientRecord | undefined> {
  try {
    loadHospitalDatabaseName();
  } catch (err) {
    if (isHospitalUnavailableError(err)) throw new HospitalQueryError();
    throw err;
  }

  const hisId = patientHisId.trim();
  if (!hisId || hisId.length > 64) return undefined;

  const sqlText = `
SELECT TOP (1)
    p.patid,
    p.PatientFirstName,
    p.PatientLastName,
    p.PatientMiddleName,
    p.BirthDate,
    p.PK_emdpatients,
    ISNULL(m.isDied, 0) AS isDied
FROM dbo.vwReportPatientProfile p
LEFT JOIN dbo.vwPatientMstrList m
  ON LTRIM(RTRIM(CONVERT(nvarchar(64), m.patid))) =
     LTRIM(RTRIM(CONVERT(nvarchar(64), p.patid)))
WHERE
    LTRIM(RTRIM(CONVERT(nvarchar(64), p.patid))) = LTRIM(RTRIM(@HisId))
    OR LTRIM(RTRIM(CONVERT(nvarchar(64), m.PatientID))) = LTRIM(RTRIM(@HisId))
ORDER BY p.registrydate DESC
`;

  assertReadOnlySelect(sqlText);

  try {
    const req = await hisRequest();
    const result = await req
      .input("HisId", sql.NVarChar(64), hisId)
      .query(sqlText);

    const row = result.recordset[0] as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return mapHospitalPatientRow(row);
  } catch (err) {
    if (err instanceof HospitalQueryError) throw err;
    throw new HospitalQueryError(err);
  }
}

/**
 * Read-only staff lookup. Distinct hospital patid values are not collapsed.
 * More than one distinct patid is ambiguous and must not be auto-selected.
 */
export async function findHospitalPatientMatches(
  patientHisId: string,
): Promise<
  | { status: "none" }
  | { status: "one"; record: HospitalPatientRecord }
  | { status: "ambiguous" }
> {
  try {
    loadHospitalDatabaseName();
  } catch (err) {
    if (isHospitalUnavailableError(err)) throw new HospitalQueryError();
    throw err;
  }

  const hisId = patientHisId.trim();
  if (!hisId || hisId.length > 64) return { status: "none" };

  const sqlText = `
SELECT TOP (25)
    p.patid,
    p.PatientFirstName,
    p.PatientLastName,
    p.PatientMiddleName,
    p.BirthDate,
    p.PK_emdpatients,
    ISNULL(m.isDied, 0) AS isDied
FROM dbo.vwReportPatientProfile p
LEFT JOIN dbo.vwPatientMstrList m
  ON LTRIM(RTRIM(CONVERT(nvarchar(64), m.patid))) =
     LTRIM(RTRIM(CONVERT(nvarchar(64), p.patid)))
WHERE
    LTRIM(RTRIM(CONVERT(nvarchar(64), p.patid))) = LTRIM(RTRIM(@HisId))
    OR LTRIM(RTRIM(CONVERT(nvarchar(64), m.PatientID))) = LTRIM(RTRIM(@HisId))
ORDER BY p.registrydate DESC
`;

  assertReadOnlySelect(sqlText);

  try {
    const req = await hisRequest();
    const result = await req.input("HisId", sql.NVarChar(64), hisId).query(sqlText);
    const byPatid = new Map<string, HospitalPatientRecord>();
    for (const raw of result.recordset as Record<string, unknown>[]) {
      const mapped = mapHospitalPatientRow(raw);
      if (!mapped) continue;
      if (!byPatid.has(mapped.patientHisId)) byPatid.set(mapped.patientHisId, mapped);
    }
    if (byPatid.size === 0) return { status: "none" };
    if (byPatid.size > 1) return { status: "ambiguous" };
    const record = [...byPatid.values()][0];
    if (!record) return { status: "none" };
    return { status: "one", record };
  } catch (err) {
    if (err instanceof HospitalQueryError) throw err;
    throw new HospitalQueryError(err);
  }
}

export async function pingHospitalDatabase(): Promise<void> {
  try {
    loadHospitalDatabaseName();
    const req = await hisRequest();
    await req.query("SELECT 1 AS ok");
  } catch (err) {
    if (err instanceof HospitalQueryError) throw err;
    throw new HospitalQueryError(err);
  }
}
