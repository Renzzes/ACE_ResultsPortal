/**
 * Read-only ShanScheduler schema discovery.
 * SELECT against INFORMATION_SCHEMA / sys only. Never modifies scheduler data.
 *
 * Usage: pnpm --filter @workspace/scripts exec tsx ./src/inspect-shanscheduler-schema.ts
 */
import {
  loadRootEnv,
  getPool,
  closePool,
  loadSchedulerDatabaseName,
  sql,
} from "@workspace/db";

loadRootEnv();

const TABLES = [
  "Appointments",
  "Doctors",
  "Schedules",
  "Departments",
  "Events",
  "Admins",
  "Announcements",
  "DoctorInsurances",
  "Floors",
  "Logs",
  "Secretaries",
  "SecretaryDoctors",
  "Specialties",
  "WeeklyTemplates",
] as const;

function bracketId(name: string): string {
  return `[${name.replace(/]/g, "")}]`;
}

async function listColumns(schedulerDb: string, objectName: string) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("table", sql.NVarChar(128), objectName)
    .query(`
SELECT
  c.COLUMN_NAME AS columnName,
  c.DATA_TYPE AS dataType,
  c.CHARACTER_MAXIMUM_LENGTH AS maxLength,
  c.IS_NULLABLE AS isNullable,
  c.ORDINAL_POSITION AS ordinal
FROM ${schedulerDb}.INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_SCHEMA = N'dbo' AND c.TABLE_NAME = @table
ORDER BY c.ORDINAL_POSITION
`);
  return result.recordset as Array<{
    columnName: string;
    dataType: string;
    maxLength: number | null;
    isNullable: string;
    ordinal: number;
  }>;
}

async function objectExists(schedulerDb: string, objectName: string): Promise<"BASE TABLE" | "VIEW" | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("name", sql.NVarChar(128), objectName)
    .query(`
SELECT TABLE_TYPE AS tableType
FROM ${schedulerDb}.INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = @name
`);
  const row = result.recordset[0] as { tableType?: string } | undefined;
  if (!row?.tableType) return null;
  return row.tableType === "VIEW" ? "VIEW" : "BASE TABLE";
}

async function listForeignKeys(schedulerDb: string, tableName: string) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("table", sql.NVarChar(128), tableName)
    .query(`
SELECT
  fk.name AS fkName,
  OBJECT_NAME(fk.parent_object_id) AS parentTable,
  COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS parentColumn,
  OBJECT_NAME(fk.referenced_object_id) AS referencedTable,
  COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS referencedColumn
FROM ${schedulerDb}.sys.foreign_keys fk
INNER JOIN ${schedulerDb}.sys.foreign_key_columns fkc
  ON fkc.constraint_object_id = fk.object_id
WHERE OBJECT_NAME(fk.parent_object_id) = @table
   OR OBJECT_NAME(fk.referenced_object_id) = @table
ORDER BY fk.name
`);
  return result.recordset;
}

async function listPatientLikeColumns(schedulerDb: string) {
  const pool = await getPool();
  const result = await pool.request().query(`
SELECT
  t.TABLE_NAME AS tableName,
  c.COLUMN_NAME AS columnName,
  c.DATA_TYPE AS dataType
FROM ${schedulerDb}.INFORMATION_SCHEMA.COLUMNS c
INNER JOIN ${schedulerDb}.INFORMATION_SCHEMA.TABLES t
  ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
WHERE t.TABLE_SCHEMA = N'dbo'
  AND t.TABLE_TYPE = N'BASE TABLE'
  AND (
    c.COLUMN_NAME LIKE '%Patient%'
    OR c.COLUMN_NAME LIKE '%HIS%'
    OR c.COLUMN_NAME LIKE '%Hospital%'
    OR c.COLUMN_NAME LIKE '%PatID%'
    OR c.COLUMN_NAME LIKE '%PatNo%'
    OR c.COLUMN_NAME LIKE '%PatId%'
    OR c.COLUMN_NAME LIKE '%Medical%Record%'
  )
ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION
`);
  return result.recordset;
}

async function sampleDistinctStatuses(schedulerDb: string) {
  const pool = await getPool();
  const cols = await listColumns(schedulerDb, "Appointments");
  const statusCol = cols.find((c) => /status/i.test(c.columnName));
  if (!statusCol) return { statusColumn: null, values: [] as string[] };
  const result = await pool.request().query(`
SELECT DISTINCT TOP (50) ${bracketId(statusCol.columnName)} AS statusValue
FROM ${schedulerDb}.dbo.Appointments
WHERE ${bracketId(statusCol.columnName)} IS NOT NULL
ORDER BY ${bracketId(statusCol.columnName)}
`);
  return {
    statusColumn: statusCol.columnName,
    values: (result.recordset as Array<{ statusValue: unknown }>).map((r) => String(r.statusValue)),
  };
}

async function main() {
  const schedulerDbName = loadSchedulerDatabaseName();
  const schedulerDb = bracketId(schedulerDbName);
  console.log(JSON.stringify({ phase: "7A", schedulerDatabase: schedulerDbName }, null, 2));

  await getPool();

  const report: Record<string, unknown> = {
    schedulerDatabase: schedulerDbName,
    tables: {},
    foreignKeys: {},
    patientLikeColumns: await listPatientLikeColumns(schedulerDb),
    appointmentStatuses: await sampleDistinctStatuses(schedulerDb),
  };

  for (const name of TABLES) {
    const kind = await objectExists(schedulerDb, name);
    if (!kind) {
      (report.tables as Record<string, unknown>)[name] = { exists: false };
      continue;
    }
    const columns = await listColumns(schedulerDb, name);
    const fks = await listForeignKeys(schedulerDb, name);
    (report.tables as Record<string, unknown>)[name] = {
      exists: true,
      kind,
      columns: columns.map((c) => ({
        name: c.columnName,
        type: c.dataType,
        maxLength: c.maxLength,
        nullable: c.isNullable,
      })),
    };
    (report.foreignKeys as Record<string, unknown>)[name] = fks;
  }

  console.log(JSON.stringify(report, null, 2));
  await closePool();
}

main().catch(async (err) => {
  console.error(
    JSON.stringify(
      {
        error: "SCHEDULER_SCHEMA_INSPECTION_FAILED",
        message: err instanceof Error ? err.message : String(err),
      },
      null,
      2,
    ),
  );
  try {
    await closePool();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
