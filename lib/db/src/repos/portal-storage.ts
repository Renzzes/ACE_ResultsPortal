import { getPool, request } from "../pool";
import { loadDbConfig } from "../config";

const EXPECTED_DATABASE = "ACE_ResultsPortal";

export type PortalStorageCompactSummary = {
  available: boolean;
  databaseName: string;
  serverTotalGB: number | null;
  serverUsedGB: number | null;
  serverFreeGB: number | null;
  serverUsedPercent: number | null;
  /** Data + log file size allocated to ACE_ResultsPortal */
  databaseAllocatedGB: number | null;
  databaseDataAllocatedGB: number | null;
  databaseDataUsedGB: number | null;
  databaseDataFreeGB: number | null;
  logAllocatedGB: number | null;
  logUsedGB: number | null;
  /** Used % of databaseAllocatedGB (data used + log used) */
  databaseUsedPercent: number | null;
  resultFilesGB: number | null;
  resultFilesBytes: number | null;
  resultFileCount: number | null;
  error: string | null;
};

function roundGb(value: number): number {
  if (value <= 0) return 0;
  if (value < 0.01) return Number(value.toFixed(4));
  if (value < 1) return Number(value.toFixed(3));
  return Number(value.toFixed(2));
}

function pagesToGb(pages: number): number {
  return roundGb((pages * 8) / (1024 * 1024));
}

function bytesToGb(bytes: number): number {
  return roundGb(bytes / (1024 * 1024 * 1024));
}

async function assertPortalDatabase(): Promise<string> {
  const configured = loadDbConfig().database;
  if (configured !== EXPECTED_DATABASE) {
    throw new Error(`Storage audit requires DB_DATABASE=${EXPECTED_DATABASE}.`);
  }
  const result = await request().query(`SELECT DB_NAME() AS dbName`);
  const dbName = String((result.recordset[0] as { dbName: string }).dbName ?? "");
  if (dbName !== EXPECTED_DATABASE) {
    throw new Error(`Storage audit refused: connected database is "${dbName}".`);
  }
  return dbName;
}

/**
 * Read-only SQL Server storage audit for ACE_ResultsPortal.
 * Uses system views only — no INSERT/UPDATE/DELETE/DDL/maintenance.
 */
export async function getPortalStorageCompactSummary(): Promise<PortalStorageCompactSummary> {
  await getPool();

  const empty: PortalStorageCompactSummary = {
    available: false,
    databaseName: EXPECTED_DATABASE,
    serverTotalGB: null,
    serverUsedGB: null,
    serverFreeGB: null,
    serverUsedPercent: null,
    databaseAllocatedGB: null,
    databaseDataAllocatedGB: null,
    databaseDataUsedGB: null,
    databaseDataFreeGB: null,
    logAllocatedGB: null,
    logUsedGB: null,
    databaseUsedPercent: null,
    resultFilesGB: null,
    resultFilesBytes: null,
    resultFileCount: null,
    error: null,
  };

  try {
    const databaseName = await assertPortalDatabase();

    const dbFiles = await request().query(`
      SELECT
        type_desc,
        size AS size_pages,
        FILEPROPERTY(name, 'SpaceUsed') AS used_pages
      FROM sys.database_files
    `);

    let dataAllocatedPages = 0;
    let dataUsedPages = 0;
    let logAllocatedPages = 0;
    for (const row of dbFiles.recordset as Array<{
      type_desc: string;
      size_pages: number;
      used_pages: number | null;
    }>) {
      const sizePages = Number(row.size_pages ?? 0);
      const usedPages = Number(row.used_pages ?? 0);
      if (row.type_desc === "ROWS") {
        dataAllocatedPages += sizePages;
        dataUsedPages += usedPages;
      } else if (row.type_desc === "LOG") {
        logAllocatedPages += sizePages;
      }
    }

    const databaseDataAllocatedGB = pagesToGb(dataAllocatedPages);
    const databaseAllocatedGB = pagesToGb(dataAllocatedPages + logAllocatedPages);
    const databaseDataUsedGB = pagesToGb(dataUsedPages);
    const databaseDataFreeGB = pagesToGb(Math.max(0, dataAllocatedPages - dataUsedPages));
    const logAllocatedGB = pagesToGb(logAllocatedPages);

    let logUsedGB: number | null = null;
    let logUsedBytes = 0;
    try {
      const logUsage = await request().query(`
        SELECT
          total_log_size_in_bytes,
          used_log_space_in_bytes
        FROM sys.dm_db_log_space_usage
      `);
      const logRow = logUsage.recordset[0] as
        | { total_log_size_in_bytes: number; used_log_space_in_bytes: number }
        | undefined;
      if (logRow) {
        logUsedBytes = Number(logRow.used_log_space_in_bytes ?? 0);
        logUsedGB = bytesToGb(logUsedBytes);
      }
    } catch {
      logUsedGB = null;
    }

    const dataUsedBytes = dataUsedPages * 8 * 1024;
    const allocatedBytes = (dataAllocatedPages + logAllocatedPages) * 8 * 1024;
    const usedBytes = dataUsedBytes + (logUsedGB != null ? logUsedBytes : 0);
    const databaseUsedPercent =
      allocatedBytes > 0 ? Number(((usedBytes / allocatedBytes) * 100).toFixed(1)) : 0;

    let serverTotalGB: number | null = null;
    let serverFreeGB: number | null = null;
    let serverUsedGB: number | null = null;
    let serverUsedPercent: number | null = null;
    try {
      const volume = await request().query(`
        SELECT TOP (1)
          vs.total_bytes,
          vs.available_bytes
        FROM sys.master_files AS mf
        CROSS APPLY sys.dm_os_volume_stats(mf.database_id, mf.file_id) AS vs
        WHERE mf.database_id = DB_ID(N'ACE_ResultsPortal')
        ORDER BY vs.total_bytes DESC
      `);
      const vol = volume.recordset[0] as { total_bytes: number; available_bytes: number } | undefined;
      if (vol) {
        const total = Number(vol.total_bytes ?? 0);
        const free = Number(vol.available_bytes ?? 0);
        const used = Math.max(0, total - free);
        serverTotalGB = bytesToGb(total);
        serverFreeGB = bytesToGb(free);
        serverUsedGB = bytesToGb(used);
        serverUsedPercent = total > 0 ? Number(((used / total) * 100).toFixed(1)) : 0;
      }
    } catch {
      /* VIEW SERVER STATE may be denied — leave server metrics null */
    }

    let resultFilesBytes: number | null = null;
    let resultFilesGB: number | null = null;
    let resultFileCount: number | null = null;
    try {
      const files = await request().query(`
        SELECT
          COALESCE(SUM(CAST(file_size_bytes AS BIGINT)), 0) AS total_bytes,
          COUNT(*) AS file_count
        FROM dbo.results
      `);
      const fileRow = files.recordset[0] as { total_bytes: number; file_count: number };
      resultFilesBytes = Number(fileRow.total_bytes ?? 0);
      resultFileCount = Number(fileRow.file_count ?? 0);
      resultFilesGB = bytesToGb(resultFilesBytes);
    } catch {
      resultFilesBytes = null;
      resultFilesGB = null;
      resultFileCount = null;
    }

    return {
      available: true,
      databaseName,
      serverTotalGB,
      serverUsedGB,
      serverFreeGB,
      serverUsedPercent,
      databaseAllocatedGB,
      databaseDataAllocatedGB,
      databaseDataUsedGB,
      databaseDataFreeGB,
      logAllocatedGB,
      logUsedGB,
      databaseUsedPercent,
      resultFilesGB,
      resultFilesBytes,
      resultFileCount,
      error: null,
    };
  } catch (err) {
    return {
      ...empty,
      available: false,
      error: err instanceof Error ? err.message : "Storage information unavailable.",
    };
  }
}
