import type { Transaction } from "mssql";
import type { ReleaseOption, ResultCategory, ResultRow, ResultStatus } from "../types";
import { mapResult } from "../mappers";
import { getPool, request, sql } from "../pool";
import { bindInInts, bindInStrings } from "../sql-helpers";
import { schemaReady as resultPhysiciansSchemaReady } from "./result-physicians";

const RESULT_COLUMNS = `
  id, patient_id, category, file_name, original_file_name, file_type, file_size_bytes,
  release_option, scheduled_release_date, date_released, status, remarks,
  uploaded_by_id, uploaded_at, created_at, updated_at
`;

export async function findResultById(id: number): Promise<ResultRow | undefined> {
  await getPool();
  const result = await request()
    .input("id", sql.Int, id)
    .query(`SELECT ${RESULT_COLUMNS} FROM dbo.results WHERE id = @id`);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapResult(row) : undefined;
}

export async function countResultsForPatient(
  patientId: number,
  options: { status?: ResultStatus } = {},
): Promise<number> {
  await getPool();
  const req = request().input("patientId", sql.Int, patientId);
  const where = ["patient_id = @patientId"];
  if (options.status) {
    req.input("status", sql.NVarChar(16), options.status);
    where.push("status = @status");
  }
  const result = await req.query(
    `SELECT COUNT(*) AS total FROM dbo.results WHERE ${where.join(" AND ")}`,
  );
  return Number((result.recordset[0] as { total: number }).total ?? 0);
}

export async function countResultsByPatientIds(
  patientIds: number[],
  options: { status?: ResultStatus } = {},
): Promise<Record<number, number>> {
  const counts: Record<number, number> = {};
  if (patientIds.length === 0) return counts;
  await getPool();
  const req = request();
  const list = bindInInts(req, "pid", patientIds);
  const where = [`patient_id IN (${list})`];
  if (options.status) {
    req.input("status", sql.NVarChar(16), options.status);
    where.push("status = @status");
  }
  const result = await req.query(
    `SELECT patient_id, COUNT(*) AS total FROM dbo.results WHERE ${where.join(" AND ")} GROUP BY patient_id`,
  );
  for (const row of result.recordset as Array<{ patient_id: number; total: number }>) {
    counts[Number(row.patient_id)] = Number(row.total);
  }
  return counts;
}

export async function listResultsForPatient(
  patientId: number,
  options: { status?: ResultStatus; categories?: ResultCategory[] } = {},
): Promise<ResultRow[]> {
  await getPool();
  const req = request();
  req.input("patientId", sql.Int, patientId);
  const where = ["patient_id = @patientId"];
  if (options.status) {
    req.input("status", sql.NVarChar(16), options.status);
    where.push("status = @status");
  }
  if (options.categories && options.categories.length > 0) {
    where.push(`category IN (${bindInStrings(req, "cat", options.categories)})`);
  }
  const result = await req.query(
    `SELECT ${RESULT_COLUMNS} FROM dbo.results WHERE ${where.join(" AND ")} ORDER BY uploaded_at DESC`,
  );
  return (result.recordset as Record<string, unknown>[]).map(mapResult);
}

/** Active staff lists omit archived rows unless a status was requested explicitly. */
export function staffResultsStatusClause(status?: ResultStatus): string {
  return status ? "status = @status" : "status <> N'archived'";
}

export async function listResults(filters: {
  patientIds?: number[];
  categories?: ResultCategory[];
  patientId?: number;
  category?: ResultCategory;
  status?: ResultStatus;
  uploadedBy?: number;
  dateFrom?: Date;
  dateTo?: Date;
  /** When set with physicianReviewResultIds, applies physician visibility union. */
  physicianId?: number;
  physicianReviewResultIds?: number[];
  page: number;
  limit: number;
}): Promise<{ data: ResultRow[]; total: number }> {
  await getPool();
  if (filters.patientIds && filters.patientIds.length === 0 && !filters.physicianReviewResultIds?.length) {
    return { data: [], total: 0 };
  }
  const assignmentTableReady =
    filters.physicianId != null ? await resultPhysiciansSchemaReady() : false;

  const build = (req: ReturnType<typeof request>) => {
    const where: string[] = ["1 = 1"];

    if (filters.physicianId != null) {
      const reviewIds = assignmentTableReady ? (filters.physicianReviewResultIds ?? []) : [];
      const patientIds = filters.patientIds ?? [];
      const parts: string[] = [];
      if (reviewIds.length > 0) {
        parts.push(`id IN (${bindInInts(req, "rev", reviewIds)})`);
      }
      if (patientIds.length > 0) {
        // Released results for assigned patients. When result_physicians exists,
        // privately-assigned results are only visible via membership above.
        if (assignmentTableReady) {
          parts.push(`(
            patient_id IN (${bindInInts(req, "asg", patientIds)})
            AND status = N'released'
            AND NOT EXISTS (
              SELECT 1 FROM dbo.result_physicians rp WHERE rp.result_id = dbo.results.id
            )
          )`);
        } else {
          parts.push(`(
            patient_id IN (${bindInInts(req, "asg", patientIds)})
            AND status = N'released'
          )`);
        }
      }
      if (parts.length === 0) {
        where.push("1 = 0");
      } else {
        where.push(`(${parts.join(" OR ")})`);
        where.push("status <> N'archived'");
      }
    } else {
      if (filters.patientIds && filters.patientIds.length > 0) {
        where.push(`patient_id IN (${bindInInts(req, "asg", filters.patientIds)})`);
      }
      if (filters.status) {
        req.input("status", sql.NVarChar(16), filters.status);
        where.push(staffResultsStatusClause(filters.status));
      } else {
        where.push(staffResultsStatusClause());
      }
    }

    if (filters.categories && filters.categories.length > 0) {
      where.push(`category IN (${bindInStrings(req, "cat", filters.categories)})`);
    }
    if (filters.patientId) {
      req.input("patientId", sql.Int, filters.patientId);
      where.push("patient_id = @patientId");
    }
    if (filters.category) {
      req.input("category", sql.NVarChar(32), filters.category);
      where.push("category = @category");
    }
    if (!filters.physicianId && filters.status) {
      // already handled above for non-physician; physician branch uses fixed status rules
    }
    if (filters.uploadedBy) {
      req.input("uploadedBy", sql.Int, filters.uploadedBy);
      where.push("uploaded_by_id = @uploadedBy");
    }
    if (filters.dateFrom) {
      req.input("dateFrom", sql.DateTimeOffset, filters.dateFrom);
      where.push("uploaded_at >= @dateFrom");
    }
    if (filters.dateTo) {
      req.input("dateTo", sql.DateTimeOffset, filters.dateTo);
      where.push("uploaded_at <= @dateTo");
    }
    req.input("offset", sql.Int, (filters.page - 1) * filters.limit);
    req.input("limit", sql.Int, filters.limit);
    return where.join(" AND ");
  };

  const countReq = request();
  const whereSql = build(countReq);
  const count = await countReq.query(`SELECT COUNT(*) AS total FROM dbo.results WHERE ${whereSql}`);

  const listReq = request();
  build(listReq);
  const rows = await listReq.query(
    `SELECT ${RESULT_COLUMNS} FROM dbo.results WHERE ${whereSql} ORDER BY uploaded_at DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
  );

  return {
    data: (rows.recordset as Record<string, unknown>[]).map(mapResult),
    total: Number((count.recordset[0] as { total: number }).total ?? 0),
  };
}

export async function listResultFileRefs(): Promise<Array<{ id: number; fileName: string }>> {
  await getPool();
  const result = await request().query("SELECT id, file_name FROM dbo.results ORDER BY id");
  return (result.recordset as Array<{ id: number; file_name: string }>).map((row) => ({
    id: Number(row.id),
    fileName: String(row.file_name),
  }));
}

export async function updateResultFileName(
  id: number,
  fileName: string,
  tx?: Transaction,
): Promise<ResultRow | undefined> {
  if (!tx) await getPool();
  const result = await request(tx)
    .input("id", sql.Int, id)
    .input("fileName", sql.NVarChar(255), fileName)
    .query(
      `UPDATE dbo.results
       SET file_name = @fileName, updated_at = SYSDATETIMEOFFSET()
       OUTPUT INSERTED.id, INSERTED.patient_id, INSERTED.category, INSERTED.file_name,
              INSERTED.original_file_name, INSERTED.file_type, INSERTED.file_size_bytes,
              INSERTED.release_option, INSERTED.scheduled_release_date, INSERTED.date_released,
              INSERTED.status, INSERTED.remarks, INSERTED.uploaded_by_id, INSERTED.uploaded_at,
              INSERTED.created_at, INSERTED.updated_at
       WHERE id = @id`,
    );
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapResult(row) : undefined;
}

export async function insertResult(
  input: {
    patientId: number;
    category: ResultCategory;
    fileName: string;
    originalFileName: string;
    fileType: ResultRow["fileType"];
    fileSizeBytes: number;
    releaseOption: ReleaseOption;
    scheduledReleaseDate: string | null;
    dateReleased: Date | null;
    status: ResultStatus;
    remarks: string | null;
    uploadedById: number;
  },
  tx?: Transaction,
): Promise<ResultRow> {
  if (!tx) await getPool();
  const result = await request(tx)
    .input("patientId", sql.Int, input.patientId)
    .input("category", sql.NVarChar(32), input.category)
    .input("fileName", sql.NVarChar(255), input.fileName)
    .input("originalFileName", sql.NVarChar(255), input.originalFileName)
    .input("fileType", sql.NVarChar(8), input.fileType)
    .input("fileSizeBytes", sql.BigInt, input.fileSizeBytes)
    .input("releaseOption", sql.NVarChar(32), input.releaseOption)
    .input("scheduledReleaseDate", sql.Date, input.scheduledReleaseDate)
    .input("dateReleased", sql.DateTimeOffset, input.dateReleased)
    .input("status", sql.NVarChar(16), input.status)
    .input("remarks", sql.NVarChar(sql.MAX), input.remarks)
    .input("uploadedById", sql.Int, input.uploadedById)
    .query(
      `INSERT INTO dbo.results (
         patient_id, category, file_name, original_file_name, file_type, file_size_bytes,
         release_option, scheduled_release_date, date_released, status, remarks, uploaded_by_id
       )
       OUTPUT INSERTED.id, INSERTED.patient_id, INSERTED.category, INSERTED.file_name,
              INSERTED.original_file_name, INSERTED.file_type, INSERTED.file_size_bytes,
              INSERTED.release_option, INSERTED.scheduled_release_date, INSERTED.date_released,
              INSERTED.status, INSERTED.remarks, INSERTED.uploaded_by_id, INSERTED.uploaded_at,
              INSERTED.created_at, INSERTED.updated_at
       VALUES (
         @patientId, @category, @fileName, @originalFileName, @fileType, @fileSizeBytes,
         @releaseOption, @scheduledReleaseDate, @dateReleased, @status, @remarks, @uploadedById
       )`,
    );
  return mapResult(result.recordset[0] as Record<string, unknown>);
}

export async function updateResult(
  id: number,
  patch: Partial<{
    category: ResultCategory;
    releaseOption: ReleaseOption;
    scheduledReleaseDate: string | null;
    remarks: string | null;
    status: ResultStatus;
    dateReleased: Date | null;
  }>,
  tx?: Transaction,
): Promise<ResultRow | undefined> {
  const existing = await findResultById(id);
  if (!existing) return undefined;
  if (!tx) await getPool();
  const result = await request(tx)
    .input("id", sql.Int, id)
    .input("category", sql.NVarChar(32), patch.category ?? existing.category)
    .input("releaseOption", sql.NVarChar(32), patch.releaseOption ?? existing.releaseOption)
    .input(
      "scheduledReleaseDate",
      sql.Date,
      patch.scheduledReleaseDate !== undefined ? patch.scheduledReleaseDate : existing.scheduledReleaseDate,
    )
    .input("remarks", sql.NVarChar(sql.MAX), patch.remarks !== undefined ? patch.remarks : existing.remarks)
    .input("status", sql.NVarChar(16), patch.status ?? existing.status)
    .input(
      "dateReleased",
      sql.DateTimeOffset,
      patch.dateReleased !== undefined ? patch.dateReleased : existing.dateReleased,
    )
    .query(
      `UPDATE dbo.results
       SET category = @category, release_option = @releaseOption,
           scheduled_release_date = @scheduledReleaseDate, remarks = @remarks,
           status = @status, date_released = @dateReleased, updated_at = SYSDATETIMEOFFSET()
       OUTPUT INSERTED.id, INSERTED.patient_id, INSERTED.category, INSERTED.file_name,
              INSERTED.original_file_name, INSERTED.file_type, INSERTED.file_size_bytes,
              INSERTED.release_option, INSERTED.scheduled_release_date, INSERTED.date_released,
              INSERTED.status, INSERTED.remarks, INSERTED.uploaded_by_id, INSERTED.uploaded_at,
              INSERTED.created_at, INSERTED.updated_at
       WHERE id = @id`,
    );
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapResult(row) : undefined;
}

export async function deleteResult(id: number, tx?: Transaction): Promise<ResultRow | undefined> {
  if (!tx) await getPool();
  const result = await request(tx)
    .input("id", sql.Int, id)
    .query(
      `DELETE FROM dbo.results
       OUTPUT DELETED.id, DELETED.patient_id, DELETED.category, DELETED.file_name,
              DELETED.original_file_name, DELETED.file_type, DELETED.file_size_bytes,
              DELETED.release_option, DELETED.scheduled_release_date, DELETED.date_released,
              DELETED.status, DELETED.remarks, DELETED.uploaded_by_id, DELETED.uploaded_at,
              DELETED.created_at, DELETED.updated_at
       WHERE id = @id`,
    );
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapResult(row) : undefined;
}

export async function listArchivedResults(filters: {
  patientIds?: number[] | null;
  categories?: ResultCategory[];
  page: number;
  limit: number;
}): Promise<{ data: ResultRow[]; total: number }> {
  await getPool();
  if (filters.patientIds && filters.patientIds.length === 0) {
    return { data: [], total: 0 };
  }
  if (filters.categories && filters.categories.length === 0) {
    return { data: [], total: 0 };
  }
  const build = (req: ReturnType<typeof request>) => {
    const where = ["status = N'archived'"];
    if (filters.patientIds && filters.patientIds.length > 0) {
      where.push(`patient_id IN (${bindInInts(req, "pid", filters.patientIds)})`);
    }
    if (filters.categories && filters.categories.length > 0) {
      where.push(`category IN (${bindInStrings(req, "cat", filters.categories)})`);
    }
    req.input("offset", sql.Int, (filters.page - 1) * filters.limit);
    req.input("limit", sql.Int, filters.limit);
    return where.join(" AND ");
  };
  const countReq = request();
  const whereSql = build(countReq);
  const count = await countReq.query(`SELECT COUNT(*) AS total FROM dbo.results WHERE ${whereSql}`);
  const listReq = request();
  build(listReq);
  const rows = await listReq.query(
    `SELECT ${RESULT_COLUMNS} FROM dbo.results WHERE ${whereSql} ORDER BY updated_at DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
  );
  return {
    data: (rows.recordset as Record<string, unknown>[]).map(mapResult),
    total: Number((count.recordset[0] as { total: number }).total ?? 0),
  };
}

export async function getResultStats(
  categories?: ResultCategory[],
  patientIds?: number[],
): Promise<{
  total: number;
  released: number;
  pending: number;
  archived: number;
  uploadsToday: number;
  uploadsThisMonth: number;
}> {
  if (patientIds && patientIds.length === 0) {
    return { total: 0, released: 0, pending: 0, archived: 0, uploadsToday: 0, uploadsThisMonth: 0 };
  }
  await getPool();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const req = request()
    .input("today", sql.DateTimeOffset, today)
    .input("firstOfMonth", sql.DateTimeOffset, firstOfMonth);
  const categorySql =
    categories && categories.length > 0
      ? `AND category IN (${bindInStrings(req, "cat", categories)})`
      : "";
  const patientSql =
    patientIds && patientIds.length > 0
      ? `AND patient_id IN (${bindInInts(req, "pid", patientIds)})`
      : "";
  const result = await req.query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = N'released' THEN 1 ELSE 0 END) AS released,
        SUM(CASE WHEN status = N'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = N'archived' THEN 1 ELSE 0 END) AS archived,
        SUM(CASE WHEN uploaded_at >= @today THEN 1 ELSE 0 END) AS uploadsToday,
        SUM(CASE WHEN uploaded_at >= @firstOfMonth THEN 1 ELSE 0 END) AS uploadsThisMonth
      FROM dbo.results
      WHERE 1 = 1 ${categorySql} ${patientSql}
    `);
  const row = result.recordset[0] as Record<string, unknown>;
  return {
    total: Number(row.total ?? 0),
    released: Number(row.released ?? 0),
    pending: Number(row.pending ?? 0),
    archived: Number(row.archived ?? 0),
    uploadsToday: Number(row.uploadsToday ?? 0),
    uploadsThisMonth: Number(row.uploadsThisMonth ?? 0),
  };
}

export async function getUploadsByDepartment(
  categories?: ResultCategory[],
  patientIds?: number[],
): Promise<Array<{ category: ResultCategory; count: number }>> {
  if (patientIds && patientIds.length === 0) return [];
  await getPool();
  const req = request();
  const where: string[] = [];
  if (categories && categories.length > 0) {
    where.push(`category IN (${bindInStrings(req, "cat", categories)})`);
  }
  if (patientIds && patientIds.length > 0) {
    where.push(`patient_id IN (${bindInInts(req, "pid", patientIds)})`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const result = await req.query(`
    SELECT category, COUNT(*) AS count
    FROM dbo.results
    ${whereSql}
    GROUP BY category
    ORDER BY COUNT(*) DESC
  `);
  return (result.recordset as Array<{ category: ResultCategory; count: number }>).map((row) => ({
    category: row.category,
    count: Number(row.count),
  }));
}

export async function getDailyUploads(
  since: Date,
  categories?: ResultCategory[],
  patientIds?: number[],
): Promise<Array<{ date: string; count: number }>> {
  if (patientIds && patientIds.length === 0) return [];
  await getPool();
  const req = request().input("since", sql.DateTimeOffset, since);
  const categorySql =
    categories && categories.length > 0
      ? `AND category IN (${bindInStrings(req, "cat", categories)})`
      : "";
  const patientSql =
    patientIds && patientIds.length > 0
      ? `AND patient_id IN (${bindInInts(req, "pid", patientIds)})`
      : "";
  const result = await req.query(`
      SELECT CONVERT(char(10), SWITCHOFFSET(uploaded_at, 0), 23) AS [date], COUNT(*) AS [count]
      FROM dbo.results
      WHERE uploaded_at >= @since ${categorySql} ${patientSql}
      GROUP BY CONVERT(char(10), SWITCHOFFSET(uploaded_at, 0), 23)
      ORDER BY [date]
    `);
  return (result.recordset as Array<{ date: string; count: number }>).map((row) => ({
    date: String(row.date),
    count: Number(row.count),
  }));
}

export async function getTopUploaders(limit = 10): Promise<Array<{ userId: number; uploadCount: number }>> {
  await getPool();
  const result = await request()
    .input("limit", sql.Int, limit)
    .query(`
      SELECT TOP (@limit) uploaded_by_id AS userId, COUNT(*) AS uploadCount
      FROM dbo.results
      GROUP BY uploaded_by_id
      ORDER BY COUNT(*) DESC
    `);
  return (result.recordset as Array<{ userId: number; uploadCount: number }>).map((row) => ({
    userId: Number(row.userId),
    uploadCount: Number(row.uploadCount),
  }));
}

export async function releaseDueScheduledResults(): Promise<ResultRow[]> {
  await getPool();
  const result = await request().query(`
    UPDATE dbo.results
    SET status = N'released',
        date_released = SYSDATETIMEOFFSET(),
        updated_at = SYSDATETIMEOFFSET()
    OUTPUT INSERTED.id, INSERTED.patient_id, INSERTED.category, INSERTED.file_name,
           INSERTED.original_file_name, INSERTED.file_type, INSERTED.file_size_bytes,
           INSERTED.release_option, INSERTED.scheduled_release_date, INSERTED.date_released,
           INSERTED.status, INSERTED.remarks, INSERTED.uploaded_by_id, INSERTED.uploaded_at,
           INSERTED.created_at, INSERTED.updated_at
    WHERE status = N'pending'
      AND release_option = N'scheduled'
      AND scheduled_release_date IS NOT NULL
      AND scheduled_release_date <= CAST(SYSUTCDATETIME() AS date)
  `);
  return (result.recordset as Record<string, unknown>[]).map(mapResult);
}
