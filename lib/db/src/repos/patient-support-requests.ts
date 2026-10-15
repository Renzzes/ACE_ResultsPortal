import type {
  PatientSupportRequest,
  SupportRequestCategory,
  SupportRequestStatus,
} from "../types";
import { getPool, request, sql } from "../pool";
import { asDate, asNumber, asRequiredDate, asRequiredNumber, asRequiredString, asString } from "../sql-helpers";

const COLUMNS = `
  id, category, patient_his_id, last_name, contact_email, details, status,
  matched_patient_id, processed_by_id, processed_at, admin_notes, requester_ip_hash,
  created_at, updated_at
`;

function mapRow(row: Record<string, unknown>): PatientSupportRequest {
  return {
    id: asRequiredNumber(row.id),
    category: asRequiredString(row.category) as SupportRequestCategory,
    patientHisId: asRequiredString(row.patient_his_id),
    lastName: asRequiredString(row.last_name),
    contactEmail: asString(row.contact_email),
    details: asString(row.details),
    status: asRequiredString(row.status) as SupportRequestStatus,
    matchedPatientId: asNumber(row.matched_patient_id),
    processedById: asNumber(row.processed_by_id),
    processedAt: asDate(row.processed_at),
    adminNotes: asString(row.admin_notes),
    requesterIpHash: asString(row.requester_ip_hash),
    createdAt: asRequiredDate(row.created_at),
    updatedAt: asRequiredDate(row.updated_at),
  };
}

export async function schemaReady(): Promise<boolean> {
  await getPool();
  const result = await request().query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.patient_support_requests', N'U') IS NULL THEN 0 ELSE 1 END AS present
  `);
  return Number((result.recordset[0] as { present: number }).present) === 1;
}

export async function mustChangePasswordColumnsReady(): Promise<boolean> {
  await getPool();
  const result = await request().query(`
    SELECT
      CASE WHEN COL_LENGTH(N'dbo.users', N'must_change_password') IS NULL THEN 0 ELSE 1 END AS mustChange,
      CASE WHEN COL_LENGTH(N'dbo.users', N'password_expires_at') IS NULL THEN 0 ELSE 1 END AS expires
  `);
  const row = result.recordset[0] as { mustChange: number; expires: number };
  return Number(row.mustChange) === 1 && Number(row.expires) === 1;
}

export async function insertSupportRequest(input: {
  category: SupportRequestCategory;
  patientHisId: string;
  lastName: string;
  contactEmail: string | null;
  details: string | null;
  requesterIpHash: string | null;
}): Promise<PatientSupportRequest> {
  await getPool();
  const result = await request()
    .input("category", sql.NVarChar(64), input.category)
    .input("patientHisId", sql.NVarChar(64), input.patientHisId)
    .input("lastName", sql.NVarChar(100), input.lastName)
    .input("contactEmail", sql.NVarChar(255), input.contactEmail)
    .input("details", sql.NVarChar(1000), input.details)
    .input("requesterIpHash", sql.NVarChar(64), input.requesterIpHash)
    .query(`
      INSERT INTO dbo.patient_support_requests
        (category, patient_his_id, last_name, contact_email, details, status, requester_ip_hash)
      OUTPUT INSERTED.id, INSERTED.category, INSERTED.patient_his_id, INSERTED.last_name,
             INSERTED.contact_email, INSERTED.details, INSERTED.status, INSERTED.matched_patient_id,
             INSERTED.processed_by_id, INSERTED.processed_at, INSERTED.admin_notes,
             INSERTED.requester_ip_hash, INSERTED.created_at, INSERTED.updated_at
      VALUES (@category, @patientHisId, @lastName, @contactEmail, @details, N'pending', @requesterIpHash)
    `);
  return mapRow(result.recordset[0] as Record<string, unknown>);
}

export async function countRecentByIpHash(ipHash: string, since: Date): Promise<number> {
  await getPool();
  const result = await request()
    .input("ipHash", sql.NVarChar(64), ipHash)
    .input("since", sql.DateTimeOffset, since)
    .query(`
      SELECT COUNT(*) AS total
      FROM dbo.patient_support_requests
      WHERE requester_ip_hash = @ipHash AND created_at >= @since
    `);
  return Number((result.recordset[0] as { total: number }).total ?? 0);
}

export async function countRecentByHisId(patientHisId: string, since: Date): Promise<number> {
  await getPool();
  const result = await request()
    .input("patientHisId", sql.NVarChar(64), patientHisId)
    .input("since", sql.DateTimeOffset, since)
    .query(`
      SELECT COUNT(*) AS total
      FROM dbo.patient_support_requests
      WHERE patient_his_id = @patientHisId AND created_at >= @since
    `);
  return Number((result.recordset[0] as { total: number }).total ?? 0);
}

export async function listSupportRequests(filters: {
  status?: SupportRequestStatus;
  page: number;
  limit: number;
}): Promise<{ data: PatientSupportRequest[]; total: number }> {
  await getPool();
  const where: string[] = ["1 = 1"];
  const bind = (req: ReturnType<typeof request>) => {
    if (filters.status) req.input("status", sql.NVarChar(32), filters.status);
    req.input("offset", sql.Int, (filters.page - 1) * filters.limit);
    req.input("limit", sql.Int, filters.limit);
  };
  if (filters.status) where.push("status = @status");
  const whereSql = where.join(" AND ");

  const countReq = request();
  bind(countReq);
  const count = await countReq.query(
    `SELECT COUNT(*) AS total FROM dbo.patient_support_requests WHERE ${whereSql}`,
  );

  const listReq = request();
  bind(listReq);
  const rows = await listReq.query(`
    SELECT ${COLUMNS}
    FROM dbo.patient_support_requests
    WHERE ${whereSql}
    ORDER BY created_at DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
  `);

  return {
    data: (rows.recordset as Record<string, unknown>[]).map(mapRow),
    total: Number((count.recordset[0] as { total: number }).total ?? 0),
  };
}

export async function findSupportRequestById(id: number): Promise<PatientSupportRequest | undefined> {
  await getPool();
  const result = await request()
    .input("id", sql.Int, id)
    .query(`SELECT ${COLUMNS} FROM dbo.patient_support_requests WHERE id = @id`);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapRow(row) : undefined;
}

/**
 * Atomically claim a pending support request for processing.
 * Returns the claimed row only when this caller wins (status was pending).
 */
export async function claimPendingSupportRequest(input: {
  id: number;
  processedById: number;
  matchedPatientId?: number | null;
}): Promise<PatientSupportRequest | undefined> {
  await getPool();
  const result = await request()
    .input("id", sql.Int, input.id)
    .input("processedById", sql.Int, input.processedById)
    .input("matchedPatientId", sql.Int, input.matchedPatientId ?? null)
    .query(`
      UPDATE dbo.patient_support_requests
      SET status = N'processing',
          processed_by_id = @processedById,
          matched_patient_id = COALESCE(@matchedPatientId, matched_patient_id),
          updated_at = SYSDATETIMEOFFSET()
      OUTPUT INSERTED.id, INSERTED.category, INSERTED.patient_his_id, INSERTED.last_name,
             INSERTED.contact_email, INSERTED.details, INSERTED.status, INSERTED.matched_patient_id,
             INSERTED.processed_by_id, INSERTED.processed_at, INSERTED.admin_notes,
             INSERTED.requester_ip_hash, INSERTED.created_at, INSERTED.updated_at
      WHERE id = @id AND status = N'pending'
    `);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapRow(row) : undefined;
}

/**
 * Transition from processing only — refuses to overwrite completed/rejected/pending.
 */
export async function updateSupportRequestIfProcessing(
  id: number,
  patch: {
    status: SupportRequestStatus;
    matchedPatientId?: number | null;
    processedById?: number | null;
    processedAt?: Date | null;
    adminNotes?: string | null;
  },
): Promise<PatientSupportRequest | undefined> {
  await getPool();
  // Conditional UPDATE only — never overwrite a non-processing row.
  // Unspecified patch fields keep their current values via CASE expressions.
  const result = await request()
    .input("id", sql.Int, id)
    .input("status", sql.NVarChar(32), patch.status)
    .input("matchedPatientId", sql.Int, patch.matchedPatientId ?? null)
    .input("setMatched", sql.Bit, patch.matchedPatientId !== undefined ? 1 : 0)
    .input("processedById", sql.Int, patch.processedById ?? null)
    .input("setProcessedBy", sql.Bit, patch.processedById !== undefined ? 1 : 0)
    .input("processedAt", sql.DateTimeOffset, patch.processedAt ?? null)
    .input("setProcessedAt", sql.Bit, patch.processedAt !== undefined ? 1 : 0)
    .input("adminNotes", sql.NVarChar(500), patch.adminNotes ?? null)
    .input("setAdminNotes", sql.Bit, patch.adminNotes !== undefined ? 1 : 0)
    .query(`
      UPDATE dbo.patient_support_requests
      SET status = @status,
          matched_patient_id = CASE WHEN @setMatched = 1 THEN @matchedPatientId ELSE matched_patient_id END,
          processed_by_id = CASE WHEN @setProcessedBy = 1 THEN @processedById ELSE processed_by_id END,
          processed_at = CASE WHEN @setProcessedAt = 1 THEN @processedAt ELSE processed_at END,
          admin_notes = CASE WHEN @setAdminNotes = 1 THEN @adminNotes ELSE admin_notes END,
          updated_at = SYSDATETIMEOFFSET()
      OUTPUT INSERTED.id, INSERTED.category, INSERTED.patient_his_id, INSERTED.last_name,
             INSERTED.contact_email, INSERTED.details, INSERTED.status, INSERTED.matched_patient_id,
             INSERTED.processed_by_id, INSERTED.processed_at, INSERTED.admin_notes,
             INSERTED.requester_ip_hash, INSERTED.created_at, INSERTED.updated_at
      WHERE id = @id AND status = N'processing'
    `);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapRow(row) : undefined;
}

export async function updateSupportRequest(
  id: number,
  patch: {
    status?: SupportRequestStatus;
    matchedPatientId?: number | null;
    processedById?: number | null;
    processedAt?: Date | null;
    adminNotes?: string | null;
  },
): Promise<PatientSupportRequest | undefined> {
  await getPool();
  const existing = await findSupportRequestById(id);
  if (!existing) return undefined;

  const result = await request()
    .input("id", sql.Int, id)
    .input("status", sql.NVarChar(32), patch.status ?? existing.status)
    .input(
      "matchedPatientId",
      sql.Int,
      patch.matchedPatientId !== undefined ? patch.matchedPatientId : existing.matchedPatientId,
    )
    .input(
      "processedById",
      sql.Int,
      patch.processedById !== undefined ? patch.processedById : existing.processedById,
    )
    .input(
      "processedAt",
      sql.DateTimeOffset,
      patch.processedAt !== undefined ? patch.processedAt : existing.processedAt,
    )
    .input(
      "adminNotes",
      sql.NVarChar(500),
      patch.adminNotes !== undefined ? patch.adminNotes : existing.adminNotes,
    )
    .query(`
      UPDATE dbo.patient_support_requests
      SET status = @status,
          matched_patient_id = @matchedPatientId,
          processed_by_id = @processedById,
          processed_at = @processedAt,
          admin_notes = @adminNotes,
          updated_at = SYSDATETIMEOFFSET()
      OUTPUT INSERTED.id, INSERTED.category, INSERTED.patient_his_id, INSERTED.last_name,
             INSERTED.contact_email, INSERTED.details, INSERTED.status, INSERTED.matched_patient_id,
             INSERTED.processed_by_id, INSERTED.processed_at, INSERTED.admin_notes,
             INSERTED.requester_ip_hash, INSERTED.created_at, INSERTED.updated_at
      WHERE id = @id
    `);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapRow(row) : undefined;
}

export async function deleteSupportRequest(id: number): Promise<void> {
  await getPool();
  await request().input("id", sql.Int, id).query(`DELETE FROM dbo.patient_support_requests WHERE id = @id`);
}
