import type { Transaction } from "mssql";
import type { Patient } from "../types";
import { mapAssignedPhysician, mapPatient } from "../mappers";
import { getPool, request, sql } from "../pool";
import { asBool, bindInInts, likeContains } from "../sql-helpers";

const PATIENT_COLUMNS = `
  id, patient_his_id, last_name, first_name, middle_name, date_of_birth,
  mobile_number, email, access_code_hash, created_by_id, portal_user_id,
  access_code_requested_at, created_at, updated_at
`;

const PATIENT_OUTPUT = `
  INSERTED.id, INSERTED.patient_his_id, INSERTED.last_name, INSERTED.first_name,
  INSERTED.middle_name, INSERTED.date_of_birth, INSERTED.mobile_number, INSERTED.email,
  INSERTED.access_code_hash, INSERTED.created_by_id, INSERTED.portal_user_id,
  INSERTED.access_code_requested_at, INSERTED.created_at, INSERTED.updated_at
`;

const PATIENT_DELETED_OUTPUT = `
  DELETED.id, DELETED.patient_his_id, DELETED.last_name, DELETED.first_name,
  DELETED.middle_name, DELETED.date_of_birth, DELETED.mobile_number, DELETED.email,
  DELETED.access_code_hash, DELETED.created_by_id, DELETED.portal_user_id,
  DELETED.access_code_requested_at, DELETED.created_at, DELETED.updated_at
`;

export async function findPatientById(id: number, tx?: Transaction): Promise<Patient | undefined> {
  if (!tx) await getPool();
  const result = await request(tx)
    .input("id", sql.Int, id)
    .query(`SELECT ${PATIENT_COLUMNS} FROM dbo.patients WHERE id = @id`);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapPatient(row) : undefined;
}

export async function findPatientByHisId(patientHisId: string, tx?: Transaction): Promise<Patient | undefined> {
  if (!tx) await getPool();
  const result = await request(tx)
    .input("patientHisId", sql.NVarChar(64), patientHisId)
    .query(`SELECT ${PATIENT_COLUMNS} FROM dbo.patients WHERE patient_his_id = @patientHisId`);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapPatient(row) : undefined;
}

export async function findPatientByCreatedById(createdById: number, tx?: Transaction): Promise<Patient | undefined> {
  if (!tx) await getPool();
  const result = await request(tx)
    .input("createdById", sql.Int, createdById)
    .query(
      `SELECT TOP (1) ${PATIENT_COLUMNS} FROM dbo.patients WHERE created_by_id = @createdById ORDER BY created_at DESC`,
    );
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapPatient(row) : undefined;
}

export async function findPatientByPortalUserId(portalUserId: number, tx?: Transaction): Promise<Patient | undefined> {
  if (!tx) await getPool();
  const result = await request(tx)
    .input("portalUserId", sql.Int, portalUserId)
    .query(`SELECT TOP (1) ${PATIENT_COLUMNS} FROM dbo.patients WHERE portal_user_id = @portalUserId`);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapPatient(row) : undefined;
}

export async function findPatientByEmail(email: string, tx?: Transaction): Promise<Patient | undefined> {
  if (!tx) await getPool();
  const result = await request(tx)
    .input("email", sql.NVarChar(255), email)
    .query(`SELECT TOP (1) ${PATIENT_COLUMNS} FROM dbo.patients WHERE LOWER(email) = LOWER(@email)`);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapPatient(row) : undefined;
}

export async function findPatientByPortalUsername(username: string, tx?: Transaction): Promise<Patient | undefined> {
  if (!tx) await getPool();
  const escaped = username.replace(/[\\%_[]/g, (ch) => `\\${ch}`);
  const result = await request(tx)
    .input("username", sql.NVarChar(255), username)
    .input("usernamePrefix", sql.NVarChar(255), `${escaped}\n%`)
    .query(
      `SELECT TOP (1) ${PATIENT_COLUMNS}
       FROM dbo.patients
       WHERE email = @username OR email LIKE @usernamePrefix ESCAPE '\\'
       ORDER BY created_at DESC`,
    );
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapPatient(row) : undefined;
}

export async function listPatients(filters: {
  search?: string;
  ids?: number[];
  page: number;
  limit: number;
  /** When true/false, filter patients who have (or lack) at least one non-archived result. */
  hasResults?: boolean;
  /** When true/false, filter patients who have (or lack) an assigned physician. */
  hasPhysician?: boolean;
}): Promise<{ data: Patient[]; total: number }> {
  await getPool();
  const where: string[] = ["1 = 1"];
  const bind = (req: ReturnType<typeof request>) => {
    if (filters.search) {
      req.input("search", sql.NVarChar(200), likeContains(filters.search));
    }
    if (filters.ids && filters.ids.length > 0) {
      bindInInts(req, "pid", filters.ids);
    }
    req.input("offset", sql.Int, (filters.page - 1) * filters.limit);
    req.input("limit", sql.Int, filters.limit);
  };

  if (filters.ids && filters.ids.length === 0) {
    return { data: [], total: 0 };
  }
  if (filters.search) {
    where.push(
      `(patient_his_id LIKE @search ESCAPE '\\'
        OR last_name LIKE @search ESCAPE '\\'
        OR first_name LIKE @search ESCAPE '\\'
        OR middle_name LIKE @search ESCAPE '\\'
        OR email LIKE @search ESCAPE '\\'
        OR mobile_number LIKE @search ESCAPE '\\')`,
    );
  }
  if (filters.ids && filters.ids.length > 0) {
    // Parameter names must match bindInInts(req, "pid", ...) inside bind() below.
    where.push(`id IN (${filters.ids.map((_, index) => `@pid${index}`).join(", ")})`);
  }
  if (filters.hasResults === true) {
    where.push(
      `EXISTS (SELECT 1 FROM dbo.results r WHERE r.patient_id = dbo.patients.id AND r.status <> N'archived')`,
    );
  } else if (filters.hasResults === false) {
    where.push(
      `NOT EXISTS (SELECT 1 FROM dbo.results r WHERE r.patient_id = dbo.patients.id AND r.status <> N'archived')`,
    );
  }
  if (filters.hasPhysician === true) {
    where.push(`EXISTS (SELECT 1 FROM dbo.patient_physicians pp WHERE pp.patient_id = dbo.patients.id)`);
  } else if (filters.hasPhysician === false) {
    where.push(`NOT EXISTS (SELECT 1 FROM dbo.patient_physicians pp WHERE pp.patient_id = dbo.patients.id)`);
  }

  const whereSql = where.join(" AND ");
  const countReq = request();
  bind(countReq);
  const count = await countReq.query(`SELECT COUNT(*) AS total FROM dbo.patients WHERE ${whereSql}`);

  const listReq = request();
  bind(listReq);
  const rows = await listReq.query(
    `SELECT ${PATIENT_COLUMNS} FROM dbo.patients WHERE ${whereSql} ORDER BY created_at DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
  );

  return {
    data: (rows.recordset as Record<string, unknown>[]).map(mapPatient),
    total: Number((count.recordset[0] as { total: number }).total ?? 0),
  };
}

/** Authorized directory summary metrics for Staff Desk Patients (same id scope as list). */
export async function getDirectoryStats(ids?: number[]): Promise<{
  totalPatients: number;
  registeredThisMonth: number;
  withResults: number;
}> {
  if (ids && ids.length === 0) {
    return { totalPatients: 0, registeredThisMonth: 0, withResults: 0 };
  }
  await getPool();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const req = request().input("monthStart", sql.DateTimeOffset, monthStart);
  const idSql =
    ids && ids.length > 0 ? `AND p.id IN (${bindInInts(req, "pid", ids)})` : "";

  // SQL Server error 130 forbids aggregates over subquery predicates.
  // Join distinct non-archived result patients instead of a correlated EXISTS.
  const result = await req.query(`
    SELECT
      COUNT(*) AS totalPatients,
      SUM(CASE WHEN p.created_at >= @monthStart THEN 1 ELSE 0 END) AS registeredThisMonth,
      SUM(CASE WHEN wr.patient_id IS NOT NULL THEN 1 ELSE 0 END) AS withResults
    FROM dbo.patients p
    LEFT JOIN (
      SELECT DISTINCT patient_id
      FROM dbo.results
      WHERE status <> N'archived'
    ) wr ON wr.patient_id = p.id
    WHERE 1 = 1
      ${idSql}
  `);
  const row = result.recordset[0] as {
    totalPatients: number;
    registeredThisMonth: number;
    withResults: number;
  };
  return {
    totalPatients: Number(row.totalPatients ?? 0),
    registeredThisMonth: Number(row.registeredThisMonth ?? 0),
    withResults: Number(row.withResults ?? 0),
  };
}

export type PortalAccountPatientRow = Patient & {
  /** Linked portal user exists with role=patient; mirrors users.is_active. */
  portalUserActive: boolean;
};

/**
 * Admin Patient Accounts: hospital patients linked to a real patient-role portal user.
 * Excludes hospital-only records (portal_user_id NULL) and invalid/non-patient links.
 */
export async function listPortalAccountPatients(filters: {
  search?: string;
  page: number;
  limit: number;
}): Promise<{ data: PortalAccountPatientRow[]; total: number }> {
  await getPool();
  const where: string[] = [
    "p.portal_user_id IS NOT NULL",
    "u.id IS NOT NULL",
    "u.role = N'patient'",
  ];
  const bind = (req: ReturnType<typeof request>) => {
    if (filters.search) {
      req.input("search", sql.NVarChar(200), likeContains(filters.search));
    }
    req.input("offset", sql.Int, (filters.page - 1) * filters.limit);
    req.input("limit", sql.Int, filters.limit);
  };
  if (filters.search) {
    where.push(
      "(p.patient_his_id LIKE @search ESCAPE '\\' OR p.last_name LIKE @search ESCAPE '\\' OR p.first_name LIKE @search ESCAPE '\\')",
    );
  }
  const whereSql = where.join(" AND ");
  const fromSql = `
    FROM dbo.patients p
    INNER JOIN dbo.users u ON u.id = p.portal_user_id
    WHERE ${whereSql}
  `;

  const countReq = request();
  bind(countReq);
  const count = await countReq.query(`SELECT COUNT(*) AS total ${fromSql}`);

  const listReq = request();
  bind(listReq);
  const rows = await listReq.query(`
    SELECT
      p.id, p.patient_his_id, p.last_name, p.first_name, p.middle_name, p.date_of_birth,
      p.mobile_number, p.email, p.access_code_hash, p.created_by_id, p.portal_user_id,
      p.access_code_requested_at, p.created_at, p.updated_at,
      u.is_active AS portal_user_active
    ${fromSql}
    ORDER BY p.created_at DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
  `);

  return {
    data: (rows.recordset as Record<string, unknown>[]).map((row) => ({
      ...mapPatient(row),
      portalUserActive: asBool(row.portal_user_active),
    })),
    total: Number((count.recordset[0] as { total: number }).total ?? 0),
  };
}

export async function countPortalAccountPatients(): Promise<number> {
  await getPool();
  const result = await request().query(`
    SELECT COUNT(*) AS total
    FROM dbo.patients p
    INNER JOIN dbo.users u ON u.id = p.portal_user_id
    WHERE p.portal_user_id IS NOT NULL AND u.role = N'patient'
  `);
  return Number((result.recordset[0] as { total: number }).total ?? 0);
}

export async function searchPatientsByTerm(term: string, assignedToPhysicianId?: number, limit = 20): Promise<Patient[]> {
  await getPool();
  const req = request();
  req.input("search", sql.NVarChar(200), likeContains(term));
  req.input("limit", sql.Int, limit);
  if (assignedToPhysicianId) {
    req.input("physicianId", sql.Int, assignedToPhysicianId);
    const result = await req.query(`
      SELECT TOP (@limit)
             p.id, p.patient_his_id, p.last_name, p.first_name, p.middle_name, p.date_of_birth,
             p.mobile_number, p.email, p.access_code_hash, p.created_by_id, p.portal_user_id,
             p.created_at, p.updated_at
      FROM dbo.patients p
      INNER JOIN dbo.patient_physicians pp
        ON pp.patient_id = p.id AND pp.physician_id = @physicianId
      WHERE p.patient_his_id LIKE @search ESCAPE '\\' OR p.last_name LIKE @search ESCAPE '\\'
    `);
    return (result.recordset as Record<string, unknown>[]).map(mapPatient);
  }
  const result = await req.query(`
    SELECT TOP (@limit) ${PATIENT_COLUMNS}
    FROM dbo.patients
    WHERE patient_his_id LIKE @search ESCAPE '\\' OR last_name LIKE @search ESCAPE '\\'
  `);
  return (result.recordset as Record<string, unknown>[]).map(mapPatient);
}

export async function insertPatient(
  input: {
    patientHisId: string;
    lastName: string;
    firstName: string;
    middleName: string | null;
    dateOfBirth: string;
    mobileNumber: string | null;
    email: string | null;
    accessCodeHash: string | null;
    createdById: number | null;
    portalUserId?: number | null;
  },
  tx?: Transaction,
): Promise<Patient> {
  if (!tx) await getPool();
  const result = await request(tx)
    .input("patientHisId", sql.NVarChar(64), input.patientHisId)
    .input("lastName", sql.NVarChar(100), input.lastName)
    .input("firstName", sql.NVarChar(100), input.firstName)
    .input("middleName", sql.NVarChar(100), input.middleName)
    .input("dateOfBirth", sql.Date, input.dateOfBirth)
    .input("mobileNumber", sql.NVarChar(32), input.mobileNumber)
    .input("email", sql.NVarChar(255), input.email)
    .input("accessCodeHash", sql.NVarChar(255), input.accessCodeHash)
    .input("createdById", sql.Int, input.createdById)
    .input("portalUserId", sql.Int, input.portalUserId ?? null)
    .query(
      `INSERT INTO dbo.patients (
         patient_his_id, last_name, first_name, middle_name, date_of_birth,
         mobile_number, email, access_code_hash, created_by_id, portal_user_id
       )
       OUTPUT ${PATIENT_OUTPUT}
       VALUES (
         @patientHisId, @lastName, @firstName, @middleName, @dateOfBirth,
         @mobileNumber, @email, @accessCodeHash, @createdById, @portalUserId
       )`,
    );
  return mapPatient(result.recordset[0] as Record<string, unknown>);
}

export async function updatePatient(
  id: number,
  patch: {
    lastName?: string;
    firstName?: string;
    middleName?: string | null;
    dateOfBirth?: string;
    mobileNumber?: string | null;
    email?: string | null;
  },
): Promise<Patient | undefined> {
  const existing = await findPatientById(id);
  if (!existing) return undefined;
  await getPool();
  const result = await request()
    .input("id", sql.Int, id)
    .input("lastName", sql.NVarChar(100), patch.lastName ?? existing.lastName)
    .input("firstName", sql.NVarChar(100), patch.firstName ?? existing.firstName)
    .input("middleName", sql.NVarChar(100), patch.middleName !== undefined ? patch.middleName : existing.middleName)
    .input("dateOfBirth", sql.Date, patch.dateOfBirth ?? existing.dateOfBirth)
    .input("mobileNumber", sql.NVarChar(32), patch.mobileNumber !== undefined ? patch.mobileNumber : existing.mobileNumber)
    .input("email", sql.NVarChar(255), patch.email !== undefined ? patch.email : existing.email)
    .query(
      `UPDATE dbo.patients
       SET last_name = @lastName, first_name = @firstName, middle_name = @middleName,
           date_of_birth = @dateOfBirth, mobile_number = @mobileNumber, email = @email,
           updated_at = SYSDATETIMEOFFSET()
       OUTPUT ${PATIENT_OUTPUT}
       WHERE id = @id`,
    );
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapPatient(row) : undefined;
}

/** Bump updated_at so department-linked existing patients rise in the Staff Patients list. */
export async function touchUpdatedAt(id: number, tx?: Transaction): Promise<void> {
  if (!tx) await getPool();
  await request(tx)
    .input("id", sql.Int, id)
    .query(`UPDATE dbo.patients SET updated_at = SYSDATETIMEOFFSET() WHERE id = @id`);
}

export async function updateAccessCodeHash(id: number, accessCodeHash: string): Promise<Patient | undefined> {
  await getPool();
  const result = await request()
    .input("id", sql.Int, id)
    .input("accessCodeHash", sql.NVarChar(255), accessCodeHash)
    .query(
      `UPDATE dbo.patients
       SET access_code_hash = @accessCodeHash,
           access_code_requested_at = NULL,
           updated_at = SYSDATETIMEOFFSET()
       OUTPUT ${PATIENT_OUTPUT}
       WHERE id = @id`,
    );
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapPatient(row) : undefined;
}

/**
 * Optimistic concurrent-safe hash replace: only succeeds when the current hash still matches.
 */
export async function updateAccessCodeHashIfMatch(
  id: number,
  accessCodeHash: string,
  expectedCurrentHash: string,
): Promise<Patient | undefined> {
  await getPool();
  const result = await request()
    .input("id", sql.Int, id)
    .input("accessCodeHash", sql.NVarChar(255), accessCodeHash)
    .input("expectedHash", sql.NVarChar(255), expectedCurrentHash)
    .query(
      `UPDATE dbo.patients
       SET access_code_hash = @accessCodeHash,
           access_code_requested_at = NULL,
           updated_at = SYSDATETIMEOFFSET()
       OUTPUT ${PATIENT_OUTPUT}
       WHERE id = @id AND access_code_hash = @expectedHash`,
    );
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapPatient(row) : undefined;
}

export async function setAccessCodeRequestedAt(
  id: number,
  requestedAt: Date | null = new Date(),
): Promise<Patient | undefined> {
  await getPool();
  const result = await request()
    .input("id", sql.Int, id)
    .input("requestedAt", sql.DateTimeOffset, requestedAt)
    .query(
      `UPDATE dbo.patients
       SET access_code_requested_at = @requestedAt, updated_at = SYSDATETIMEOFFSET()
       OUTPUT ${PATIENT_OUTPUT}
       WHERE id = @id`,
    );
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapPatient(row) : undefined;
}

export async function clearAccessCodeRequestedAt(id: number): Promise<Patient | undefined> {
  return setAccessCodeRequestedAt(id, null);
}

export async function updatePortalUserId(id: number, portalUserId: number, tx?: Transaction): Promise<Patient | undefined> {
  if (!tx) await getPool();
  const result = await request(tx)
    .input("id", sql.Int, id)
    .input("portalUserId", sql.Int, portalUserId)
    .query(
      `UPDATE dbo.patients
       SET portal_user_id = @portalUserId, updated_at = SYSDATETIMEOFFSET()
       OUTPUT ${PATIENT_OUTPUT}
       WHERE id = @id`,
    );
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapPatient(row) : undefined;
}

export async function deletePatient(id: number, tx?: Transaction): Promise<Patient | undefined> {
  if (!tx) await getPool();
  const result = await request(tx)
    .input("id", sql.Int, id)
    .query(
      `DELETE FROM dbo.patients
       OUTPUT ${PATIENT_DELETED_OUTPUT}
       WHERE id = @id`,
    );
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapPatient(row) : undefined;
}

export async function countPatients(): Promise<number> {
  await getPool();
  const result = await request().query("SELECT COUNT(*) AS total FROM dbo.patients");
  return Number((result.recordset[0] as { total: number }).total ?? 0);
}

export async function listAssignedPhysicians(patientId: number) {
  await getPool();
  const result = await request()
    .input("patientId", sql.Int, patientId)
    .query(`
      SELECT u.id, u.first_name, u.last_name, u.username, pp.assigned_at, pp.patient_id
      FROM dbo.patient_physicians pp
      INNER JOIN dbo.users u ON u.id = pp.physician_id
      WHERE pp.patient_id = @patientId
      ORDER BY pp.assigned_at
    `);
  return (result.recordset as Record<string, unknown>[]).map(mapAssignedPhysician);
}

/** Batch load assigned physicians for a page of patients (list enrichment). */
export async function listAssignedPhysiciansForPatients(
  patientIds: number[],
): Promise<Map<number, ReturnType<typeof mapAssignedPhysician>[]>> {
  const map = new Map<number, ReturnType<typeof mapAssignedPhysician>[]>();
  if (patientIds.length === 0) return map;
  await getPool();
  const req = request();
  const list = bindInInts(req, "pid", patientIds);
  const result = await req.query(`
    SELECT u.id, u.first_name, u.last_name, u.username, pp.assigned_at, pp.patient_id
    FROM dbo.patient_physicians pp
    INNER JOIN dbo.users u ON u.id = pp.physician_id
    WHERE pp.patient_id IN (${list})
    ORDER BY pp.assigned_at
  `);
  for (const row of result.recordset as Record<string, unknown>[]) {
    const patientId = Number(row.patient_id);
    const physician = mapAssignedPhysician(row);
    const existing = map.get(patientId) ?? [];
    existing.push(physician);
    map.set(patientId, existing);
  }
  return map;
}

export async function findPatientsByIds(ids: number[]): Promise<Patient[]> {
  if (ids.length === 0) return [];
  await getPool();
  const req = request();
  const list = bindInInts(req, "pid", ids);
  const result = await req.query(`SELECT ${PATIENT_COLUMNS} FROM dbo.patients WHERE id IN (${list})`);
  return (result.recordset as Record<string, unknown>[]).map(mapPatient);
}

export async function searchPatientIdsByName(search: string): Promise<number[]> {
  await getPool();
  const result = await request()
    .input("search", sql.NVarChar(200), likeContains(search))
    .query(`
      SELECT id FROM dbo.patients
      WHERE patient_his_id LIKE @search ESCAPE '\\'
         OR last_name LIKE @search ESCAPE '\\'
         OR first_name LIKE @search ESCAPE '\\'
    `);
  return (result.recordset as Array<{ id: number }>).map((row) => Number(row.id));
}
