/**
 * Probe confirmed LiveDB_ACE views with parameterized SELECTs only.
 * Does not print full demographics beyond column presence checks.
 */
import {
  loadRootEnv,
  getPool,
  closePool,
  loadHospitalDatabaseName,
  sql,
} from "@workspace/db";

loadRootEnv();

function bracketId(name: string): string {
  return `[${name.replace(/]/g, "")}]`;
}

async function main() {
  const hospitalDb = bracketId(loadHospitalDatabaseName());
  const pool = await getPool();
  const patid = "1240";

  const profile = await pool
    .request()
    .input("patid", sql.NVarChar(64), patid)
    .query(`
SELECT TOP (3)
  p.patid,
  p.PatientLastName,
  p.PatientFirstName,
  p.PatientMiddleName,
  p.BirthDate,
  SQL_VARIANT_PROPERTY(p.BirthDate, 'BaseType') AS birthDateBaseType,
  p.PK_emdpatients,
  p.registrydate
FROM ${hospitalDb}.dbo.vwReportPatientProfile p
WHERE LTRIM(RTRIM(CONVERT(nvarchar(64), p.patid))) = LTRIM(RTRIM(@patid))
ORDER BY p.registrydate DESC
`);

  const master = await pool
    .request()
    .input("patid", sql.NVarChar(64), patid)
    .query(`
SELECT TOP (3)
  m.patid,
  m.PatientID,
  m.PatientName,
  m.birthdate,
  SQL_VARIANT_PROPERTY(m.birthdate, 'BaseType') AS birthDateBaseType,
  m.gender,
  m.isDied
FROM ${hospitalDb}.dbo.vwPatientMstrList m
WHERE LTRIM(RTRIM(CONVERT(nvarchar(64), m.patid))) = LTRIM(RTRIM(@patid))
   OR LTRIM(RTRIM(CONVERT(nvarchar(64), m.PatientID))) = LTRIM(RTRIM(@patid))
`);

  const demog = await pool
    .request()
    .input("patid", sql.NVarChar(64), patid)
    .query(`
SELECT TOP (3)
  d.PK_EipPatientDemographics,
  d.patientid,
  d.nameLast,
  d.nameFirst,
  d.nameMiddle,
  d.dateofbirth,
  d.active
FROM ${hospitalDb}.dbo.EipPatientDemographics d
WHERE LTRIM(RTRIM(CONVERT(nvarchar(64), d.patientid))) = LTRIM(RTRIM(@patid))
`);

  console.log(
    JSON.stringify(
      {
        vwReportPatientProfile: profile.recordset.map((row) => ({
          patid: String(row.patid),
          lastNameLen: String(row.PatientLastName ?? "").length,
          firstNameLen: String(row.PatientFirstName ?? "").length,
          birthDate: row.BirthDate,
          birthDateBaseType: row.birthDateBaseType,
          pk: row.PK_emdpatients,
        })),
        vwPatientMstrList: master.recordset.map((row) => ({
          patid: String(row.patid),
          patientId: String(row.PatientID),
          nameLen: String(row.PatientName ?? "").length,
          birthdate: row.birthdate,
          birthDateBaseType: row.birthDateBaseType,
          isDied: row.isDied,
        })),
        EipPatientDemographics: demog.recordset.map((row) => ({
          pk: row.PK_EipPatientDemographics,
          patientid: String(row.patientid ?? ""),
          nameLastLen: String(row.nameLast ?? "").length,
          dateofbirth: row.dateofbirth,
          active: row.active,
        })),
      },
      null,
      2,
    ),
  );

  await closePool();
}

main().catch(async (err) => {
  console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  try {
    await closePool();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
