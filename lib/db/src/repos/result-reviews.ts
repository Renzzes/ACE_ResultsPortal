import type { Transaction } from "mssql";
import type { ResultCategory } from "../types";
import { getPool, request, sql } from "../pool";
import { bindInInts, bindInStrings } from "../sql-helpers";

export class ResultReviewSchemaError extends Error {
  constructor() {
    super("dbo.result_reviews is not installed");
    this.name = "ResultReviewSchemaError";
  }
}

export type ResultReview = {
  id: number;
  resultId: number;
  physicianId: number;
  comment: string | null;
  reviewedAt: Date;
};

function mapRow(row: Record<string, unknown>): ResultReview {
  return {
    id: Number(row.id),
    resultId: Number(row.result_id),
    physicianId: Number(row.physician_id),
    comment: row.comment == null ? null : String(row.comment),
    reviewedAt: row.reviewed_at instanceof Date ? row.reviewed_at : new Date(String(row.reviewed_at)),
  };
}

export async function schemaReady(): Promise<boolean> {
  await getPool();
  const result = await request().query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.result_reviews', N'U') IS NULL THEN 0 ELSE 1 END AS present
  `);
  return Number((result.recordset[0] as { present: number }).present) === 1;
}

export async function getReviewForPhysician(
  resultId: number,
  physicianId: number,
  tx?: Transaction,
): Promise<ResultReview | undefined> {
  if (!(await schemaReady())) throw new ResultReviewSchemaError();
  if (!tx) await getPool();
  const result = await request(tx)
    .input("resultId", sql.Int, resultId)
    .input("physicianId", sql.Int, physicianId)
    .query(`
      SELECT id, result_id, physician_id, comment, reviewed_at
      FROM dbo.result_reviews
      WHERE result_id = @resultId AND physician_id = @physicianId
    `);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapRow(row) : undefined;
}

export async function getReviewsForResult(
  resultId: number,
  tx?: Transaction,
): Promise<ResultReview[]> {
  if (!(await schemaReady())) throw new ResultReviewSchemaError();
  if (!tx) await getPool();
  const result = await request(tx)
    .input("resultId", sql.Int, resultId)
    .query(`
      SELECT id, result_id, physician_id, comment, reviewed_at
      FROM dbo.result_reviews
      WHERE result_id = @resultId
      ORDER BY physician_id ASC, id ASC
    `);
  return (result.recordset as Record<string, unknown>[]).map(mapRow);
}

/**
 * Insert or update the one review for this result and physician.
 * reviewed_at is always SYSDATETIMEOFFSET() in the database.
 */
export async function upsertReview(
  input: {
    resultId: number;
    physicianId: number;
    comment: string | null;
  },
  tx?: Transaction,
): Promise<ResultReview> {
  if (!(await schemaReady())) throw new ResultReviewSchemaError();
  if (!tx) await getPool();
  const result = await request(tx)
    .input("resultId", sql.Int, input.resultId)
    .input("physicianId", sql.Int, input.physicianId)
    .input("comment", sql.NVarChar(sql.MAX), input.comment)
    .query(`
      DECLARE @saved TABLE (
        id INT,
        result_id INT,
        physician_id INT,
        comment NVARCHAR(MAX),
        reviewed_at DATETIMEOFFSET(7)
      );

      MERGE dbo.result_reviews WITH (HOLDLOCK) AS target
      USING (SELECT @resultId AS result_id, @physicianId AS physician_id) AS source
        ON target.result_id = source.result_id
       AND target.physician_id = source.physician_id
      WHEN MATCHED THEN
        UPDATE SET comment = @comment, reviewed_at = SYSDATETIMEOFFSET()
      WHEN NOT MATCHED THEN
        INSERT (result_id, physician_id, comment)
        VALUES (@resultId, @physicianId, @comment)
      OUTPUT INSERTED.id, INSERTED.result_id, INSERTED.physician_id, INSERTED.comment, INSERTED.reviewed_at
        INTO @saved (id, result_id, physician_id, comment, reviewed_at);

      SELECT id, result_id, physician_id, comment, reviewed_at FROM @saved;
    `);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error("RESULT_REVIEW_UPSERT_FAILED");
  return mapRow(row);
}

export type DeskReviewActivity = {
  id: number;
  resultId: number;
  physicianId: number;
  physicianName: string;
  comment: string | null;
  reviewedAt: Date;
  patientId: number;
  patientHisId: string;
  patientName: string;
  category: ResultCategory;
  originalFileName: string;
};

/**
 * Count physician reviews recorded today (local calendar day boundary via @today).
 * Department-scoped through result category / patient membership filters.
 */
export async function countReviewedToday(
  categories?: ResultCategory[],
  patientIds?: number[],
): Promise<number> {
  if (!(await schemaReady())) return 0;
  if (patientIds && patientIds.length === 0) return 0;
  await getPool();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const req = request().input("today", sql.DateTimeOffset, today);
  const categorySql =
    categories && categories.length > 0
      ? `AND r.category IN (${bindInStrings(req, "cat", categories)})`
      : "";
  const patientSql =
    patientIds && patientIds.length > 0
      ? `AND r.patient_id IN (${bindInInts(req, "pid", patientIds)})`
      : "";
  const result = await req.query(`
    SELECT COUNT(*) AS total
    FROM dbo.result_reviews rr
    INNER JOIN dbo.results r ON r.id = rr.result_id
    WHERE rr.reviewed_at >= @today
      AND r.status <> N'archived'
      ${categorySql}
      ${patientSql}
  `);
  return Number((result.recordset[0] as { total: number }).total ?? 0);
}

/** Recent physician reviews for Staff Desk timeline (newest first). */
export async function listRecentReviewsForDesk(
  limit: number,
  categories?: ResultCategory[],
  patientIds?: number[],
): Promise<DeskReviewActivity[]> {
  if (!(await schemaReady())) return [];
  if (patientIds && patientIds.length === 0) return [];
  await getPool();
  const req = request().input("limit", sql.Int, Math.max(1, Math.min(50, limit)));
  const categorySql =
    categories && categories.length > 0
      ? `AND r.category IN (${bindInStrings(req, "cat", categories)})`
      : "";
  const patientSql =
    patientIds && patientIds.length > 0
      ? `AND r.patient_id IN (${bindInInts(req, "pid", patientIds)})`
      : "";
  const result = await req.query(`
    SELECT TOP (@limit)
      rr.id,
      rr.result_id,
      rr.physician_id,
      rr.comment,
      rr.reviewed_at,
      r.patient_id,
      r.category,
      r.original_file_name,
      p.patient_his_id,
      p.last_name AS patient_last_name,
      p.first_name AS patient_first_name,
      u.first_name AS physician_first_name,
      u.last_name AS physician_last_name
    FROM dbo.result_reviews rr
    INNER JOIN dbo.results r ON r.id = rr.result_id
    INNER JOIN dbo.patients p ON p.id = r.patient_id
    INNER JOIN dbo.users u ON u.id = rr.physician_id
    WHERE r.status <> N'archived'
      ${categorySql}
      ${patientSql}
    ORDER BY rr.reviewed_at DESC, rr.id DESC
  `);
  return (result.recordset as Record<string, unknown>[]).map((row) => {
    const physicianFirst = String(row.physician_first_name ?? "").trim();
    const physicianLast = String(row.physician_last_name ?? "").trim();
    const physicianName = `Dr. ${physicianFirst} ${physicianLast}`.trim().replace(/\s+/g, " ");
    const patientLast = String(row.patient_last_name ?? "").trim();
    const patientFirst = String(row.patient_first_name ?? "").trim();
    return {
      id: Number(row.id),
      resultId: Number(row.result_id),
      physicianId: Number(row.physician_id),
      physicianName: physicianName === "Dr." ? "Physician" : physicianName,
      comment: row.comment == null ? null : String(row.comment),
      reviewedAt: row.reviewed_at instanceof Date ? row.reviewed_at : new Date(String(row.reviewed_at)),
      patientId: Number(row.patient_id),
      patientHisId: String(row.patient_his_id ?? ""),
      patientName: `${patientLast}, ${patientFirst}`.replace(/^,\s*|,\s*$/g, "").trim() || `Patient #${row.patient_id}`,
      category: String(row.category) as ResultCategory,
      originalFileName: String(row.original_file_name ?? ""),
    };
  });
}
