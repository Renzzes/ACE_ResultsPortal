/**
 * Probe ShanScheduler patient linkage — SELECT only.
 */
import { loadRootEnv, getPool, closePool, loadSchedulerDatabaseName, sql, patientsRepo, initDb } from "@workspace/db";

loadRootEnv();
await initDb();

const schedulerDb = `[${loadSchedulerDatabaseName()}]`;
const pool = await getPool();

async function q(label: string, query: string) {
  const result = await pool.request().query(query);
  console.log(JSON.stringify({ label, rows: result.recordset }, null, 2));
}

await q(
  "appointment_reference_samples",
  `SELECT TOP (20) AppointmentReference, PatientFirstName, PatientLastName, PatientMiddleName, PatientContactNumber, PatientEmail, AppointmentDate, Status
   FROM ${schedulerDb}.dbo.Appointments
   ORDER BY CreatedAt DESC`,
);

await q(
  "appointment_reference_patterns",
  `SELECT TOP (20) AppointmentReference, LEN(AppointmentReference) AS refLen
   FROM ${schedulerDb}.dbo.Appointments
   GROUP BY AppointmentReference, LEN(AppointmentReference)
   ORDER BY AppointmentReference`,
);

await q(
  "status_distinct",
  `SELECT Status, COUNT(*) AS cnt FROM ${schedulerDb}.dbo.Appointments GROUP BY Status ORDER BY cnt DESC`,
);

await q(
  "appointment_count",
  `SELECT COUNT(*) AS total FROM ${schedulerDb}.dbo.Appointments`,
);

const portalPatients = await patientsRepo.listPatients({ page: 1, limit: 20 });
for (const p of portalPatients.data) {
  const ref = await pool
    .request()
    .input("his", sql.NVarChar(64), p.patientHisId)
    .query(`
      SELECT TOP (5) AppointmentReference, PatientFirstName, PatientLastName, AppointmentDate, Status
      FROM ${schedulerDb}.dbo.Appointments
      WHERE AppointmentReference = @his
         OR AppointmentReference LIKE @his + '%'
         OR CAST(AppointmentReference AS nvarchar(40)) = @his
    `);
  console.log(
    JSON.stringify(
      {
        patientHisId: p.patientHisId,
        refMatches: ref.recordset.length,
        samples: ref.recordset,
      },
      null,
      2,
    ),
  );
}

await closePool();
