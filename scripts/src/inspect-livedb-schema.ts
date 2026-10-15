/**
 * Read-only LiveDB_ACE schema discovery.
 * SELECT against INFORMATION_SCHEMA / sys only. Never modifies hospital data.
 *
 * Usage: pnpm --filter @workspace/scripts exec tsx ./src/inspect-livedb-schema.ts
 */
import {
  loadRootEnv,
  getPool,
  closePool,
  loadHospitalDatabaseName,
  sql,
} from "@workspace/db";

loadRootEnv();

const TABLES = [
  "EipPatientDemographics",
  "EipPatientNames",
  "EipPatientIdentifiers",
  "EipPatientTelecoms",
  "emdPatients",
] as const;

const VIEWS = [
  "vwPatientMstrList",
  "vwOutPatientsMstrList",
  "vwReportInpatientMstrList",
  "vwReportAdmitDoc",
  "vwReportPatientProfile",
] as const;

function bracketId(name: string): string {
  return `[${name.replace(/]/g, "")}]`;
}

async function listColumns(hospitalDb: string, objectName: string) {
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
FROM ${hospitalDb}.INFORMATION_SCHEMA.COLUMNS c
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

async function objectExists(hospitalDb: string, objectName: string): Promise<"BASE TABLE" | "VIEW" | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("name", sql.NVarChar(128), objectName)
    .query(`
SELECT TABLE_TYPE AS tableType
FROM ${hospitalDb}.INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = @name
`);
  const row = result.recordset[0] as { tableType?: string } | undefined;
  if (!row?.tableType) return null;
  return row.tableType === "VIEW" ? "VIEW" : "BASE TABLE";
}

async function listForeignKeys(hospitalDb: string, tableName: string) {
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
FROM ${hospitalDb}.sys.foreign_keys fk
INNER JOIN ${hospitalDb}.sys.foreign_key_columns fkc
  ON fkc.constraint_object_id = fk.object_id
WHERE OBJECT_NAME(fk.parent_object_id) = @table
   OR OBJECT_NAME(fk.referenced_object_id) = @table
ORDER BY fk.name
`);
  return result.recordset as Array<{
    fkName: string;
    parentTable: string;
    parentColumn: string;
    referencedTable: string;
    referencedColumn: string;
  }>;
}

async function main() {
  const hospitalDbName = loadHospitalDatabaseName();
  const hospitalDb = bracketId(hospitalDbName);
  console.log(JSON.stringify({ phase: "B", hospitalDatabase: hospitalDbName }, null, 2));

  await getPool();

  const report: Record<string, unknown> = {
    hospitalDatabase: hospitalDbName,
    tables: {},
    views: {},
    foreignKeys: {},
  };

  for (const name of TABLES) {
    const kind = await objectExists(hospitalDb, name);
    if (!kind) {
      (report.tables as Record<string, unknown>)[name] = { exists: false };
      continue;
    }
    const columns = await listColumns(hospitalDb, name);
    const fks = await listForeignKeys(hospitalDb, name);
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

  for (const name of VIEWS) {
    const kind = await objectExists(hospitalDb, name);
    if (!kind) {
      (report.views as Record<string, unknown>)[name] = { exists: false };
      continue;
    }
    const columns = await listColumns(hospitalDb, name);
    (report.views as Record<string, unknown>)[name] = {
      exists: true,
      kind,
      columns: columns.map((c) => ({
        name: c.columnName,
        type: c.dataType,
        maxLength: c.maxLength,
        nullable: c.isNullable,
      })),
    };
  }

  console.log(JSON.stringify(report, null, 2));
  await closePool();
}

main().catch(async (err) => {
  console.error(
    JSON.stringify(
      {
        error: "HOSPITAL_SCHEMA_INSPECTION_FAILED",
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
